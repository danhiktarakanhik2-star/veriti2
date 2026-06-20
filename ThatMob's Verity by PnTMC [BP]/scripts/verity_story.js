import { system, world } from "@minecraft/server";
import { getVerityPhase, PHASE } from "./verity_phases.js";
import { schedulePhase2Entry } from "./verity_phase2.js";
import { VOICE } from "./verity_voices.js";
import {
	expandMessage,
	looksLikeQuestion,
	normalizeQuestion,
} from "./verity_intent.js";
import { locateNearest } from "./verity_locate.js";

const VERITYBALL_ID = "pntmc:verityball";

const STORY_STEP_PROP = "pntmc:verity_story_village";
const STORY_P2_STEP_PROP = "pntmc:verity_story_phase2";
const STORY_EAST_WATCH_PROP = "pntmc:story_east_watch_tick";
const STORY_EAST_START_X_PROP = "pntmc:story_east_start_x";
const STORY_EAST_ARRIVED_PROP = "pntmc:story_east_arrived_tick";
const HAUNTED_X_PROP = "pntmc:haunted_village_x";
const HAUNTED_Z_PROP = "pntmc:haunted_village_z";

/** Chưa đi đủ đông — auto-complete sau khoảng này */
const STORY_EAST_TIMEOUT_TICKS = 10000;
/** Đã đi đông rồi mà không hỏi tiếp — auto-complete sau khoảng này */
const STORY_EAST_QUIET_TIMEOUT_TICKS = 10000;
const STORY_EAST_MIN_TRAVEL = 64;

const STORY_WAIT_WHY = 1;
const STORY_WAIT_GONE = 2;
const STORY_PHASE1_DONE = 3;

const P2_WAIT_PILLAGER = 1;
const P2_WAIT_THEN_WHAT = 2;
const P2_DONE = 3;

const HAUNTED_VILLAGE_RADIUS = 120;
const HAUNTED_PURGED_PROP = "pntmc:haunted_village_purged";

const HAUNTED_CLEAR_TYPES = new Set([
	"minecraft:villager",
	"minecraft:villager_v2",
	"minecraft:iron_golem",
	"minecraft:wandering_trader",
	"minecraft:cat",
	"minecraft:cow",
	"minecraft:sheep",
	"minecraft:pig",
	"minecraft:chicken",
	"minecraft:horse",
	"minecraft:donkey",
	"minecraft:mule",
	"minecraft:llama",
	"minecraft:trader_llama",
	"minecraft:rabbit",
]);

/**
 * @returns {number}
 */
function getStoryStep() {
	const step = world.getDynamicProperty(STORY_STEP_PROP);
	return typeof step === "number" ? step : 0;
}

/**
 * @param {number} step
 */
function setStoryStep(step) {
	world.setDynamicProperty(STORY_STEP_PROP, step);
	console.warn(`verity story: phase1 step ${step}`);
}

/**
 * @returns {number}
 */
function getPhase2StoryStep() {
	const step = world.getDynamicProperty(STORY_P2_STEP_PROP);
	return typeof step === "number" ? step : 0;
}

/**
 * @param {number} step
 */
function setPhase2StoryStep(step) {
	world.setDynamicProperty(STORY_P2_STEP_PROP, step);
	console.warn(`verity story: phase2 step ${step}`);
}

/**
 * @param {{ x: number, z: number }} a
 * @param {{ x: number, z: number }} b
 */
function flatDistance(a, b) {
	const dx = a.x - b.x;
	const dz = a.z - b.z;
	return Math.sqrt(dx * dx + dz * dz);
}

/**
 * @returns {{ x: number, z: number } | null}
 */
function getHauntedAnchor() {
	const x = world.getDynamicProperty(HAUNTED_X_PROP);
	const z = world.getDynamicProperty(HAUNTED_Z_PROP);
	if (typeof x !== "number" || typeof z !== "number") return null;
	return { x, z };
}

/**
 * @param {import("@minecraft/server").Player} player
 */
function isAtHauntedVillage(player) {
	const anchor = getHauntedAnchor();
	if (!anchor) return false;
	return flatDistance(player.location, anchor) <= HAUNTED_VILLAGE_RADIUS;
}

/**
 * @param {import("@minecraft/server").Dimension} dimension
 */
function purgeHauntedVillage(dimension) {
	if (world.getDynamicProperty(HAUNTED_PURGED_PROP) === true) return;

	const anchor = getHauntedAnchor();
	if (!anchor) return;

	let removed = 0;
	const r2 = HAUNTED_VILLAGE_RADIUS * HAUNTED_VILLAGE_RADIUS;

	try {
		for (const ent of dimension.getEntities()) {
			if (!ent.isValid) continue;
			if (!HAUNTED_CLEAR_TYPES.has(ent.typeId)) continue;
			const dx = ent.location.x - anchor.x;
			const dz = ent.location.z - anchor.z;
			if (dx * dx + dz * dz > r2) continue;
			try {
				ent.remove();
				removed++;
			} catch {
				/* ignore */
			}
		}
	} catch (err) {
		console.warn(`verity story: purge haunted village ${err}`);
		return;
	}

	world.setDynamicProperty(HAUNTED_PURGED_PROP, true);
	console.warn(
		`verity story: purged ${removed} village mobs near ${anchor.x}, ${anchor.z}`,
	);
}

/**
 * Reset story-related world props (!verityreset).
 */
export function resetStoryWorldProps() {
	world.setDynamicProperty(STORY_STEP_PROP, undefined);
	world.setDynamicProperty(STORY_P2_STEP_PROP, undefined);
	world.setDynamicProperty(STORY_EAST_WATCH_PROP, undefined);
	world.setDynamicProperty(STORY_EAST_START_X_PROP, undefined);
	world.setDynamicProperty(STORY_EAST_ARRIVED_PROP, undefined);
	world.setDynamicProperty(HAUNTED_X_PROP, undefined);
	world.setDynamicProperty(HAUNTED_Z_PROP, undefined);
	world.setDynamicProperty(HAUNTED_PURGED_PROP, undefined);
}

/**
 * @param {import("@minecraft/server").Player} player
 */
function hasGoneEast(player) {
	if (isAtHauntedVillage(player)) return true;
	const startX = world.getDynamicProperty(STORY_EAST_START_X_PROP);
	if (typeof startX === "number" && player.location.x >= startX + STORY_EAST_MIN_TRAVEL) {
		return true;
	}
	const anchor = getHauntedAnchor();
	if (anchor && player.location.x >= anchor.x - STORY_EAST_MIN_TRAVEL) {
		return true;
	}
	return false;
}

function clearStoryEastWatch() {
	world.setDynamicProperty(STORY_EAST_WATCH_PROP, undefined);
	world.setDynamicProperty(STORY_EAST_ARRIVED_PROP, undefined);
}

/**
 * @param {import("@minecraft/server").Player} player
 */
function startStoryEastWatch(player) {
	world.setDynamicProperty(STORY_EAST_WATCH_PROP, world.getAbsoluteTime());
	world.setDynamicProperty(STORY_EAST_START_X_PROP, player.location.x);
}

function forceHauntedStoryComplete(reason = "east timeout") {
	for (const player of world.getPlayers()) {
		if (isAtHauntedVillage(player)) {
			purgeHauntedVillage(player.dimension);
		}
	}
	setStoryStep(STORY_PHASE1_DONE);
	setPhase2StoryStep(P2_DONE);
	clearStoryEastWatch();
	onHauntedStoryComplete();
	console.warn(`verity story: haunted arc auto-completed (${reason})`);
}

/**
 * @param {import("@minecraft/server").Player} player
 */
function tickStoryEastWatch(player) {
	if (getPhase2StoryStep() >= P2_DONE) {
		clearStoryEastWatch();
		return;
	}
	const step = getStoryStep();
	if (step < STORY_WAIT_WHY) return;

	const watchStart = world.getDynamicProperty(STORY_EAST_WATCH_PROP);
	if (typeof watchStart !== "number") return;

	const now = world.getAbsoluteTime();

	if (hasGoneEast(player)) {
		let arrivedAt = world.getDynamicProperty(STORY_EAST_ARRIVED_PROP);
		if (typeof arrivedAt !== "number") {
			world.setDynamicProperty(STORY_EAST_ARRIVED_PROP, now);
			arrivedAt = now;
			console.warn(
				`verity story: ${player.name} went east — quiet auto-complete timer started`,
			);
		}
		if (now - arrivedAt >= STORY_EAST_QUIET_TIMEOUT_TICKS) {
			forceHauntedStoryComplete("east traveled, no follow-up");
		}
		return;
	}

	if (now - watchStart >= STORY_EAST_TIMEOUT_TICKS) {
		forceHauntedStoryComplete("east watch timeout");
	}
}

/**
 * @param {{ x: number, z: number }} from
 * @param {{ x: number, z: number }} to
 */
function isMostlyEast(from, to) {
	return to.x - from.x > Math.abs(to.z - from.z) * 0.5;
}

/**
 * @param {import("@minecraft/server").Player} player
 */
async function cacheHauntedVillageAnchor(player) {
	if (typeof world.getDynamicProperty(HAUNTED_X_PROP) === "number") return;

	let anchorX = Math.floor(player.location.x + 400);
	let anchorZ = Math.floor(player.location.z);

	const located = locateNearest(player, "structure", "village");
	if (located && isMostlyEast(player.location, located)) {
		anchorX = Math.floor(located.x);
		anchorZ = Math.floor(located.z);
	}

	world.setDynamicProperty(HAUNTED_X_PROP, anchorX);
	world.setDynamicProperty(HAUNTED_Z_PROP, anchorZ);
	console.warn(`verity story: haunted village anchor ${anchorX}, ${anchorZ}`);
}

function onHauntedStoryComplete() {
	schedulePhase2Entry();
	console.warn("verity story: haunted arc done, phase 2 scheduled");
}

/**
 * Chỉ bắt arc haunted khi player muốn làng *khác* (another / other), không phải lần hỏi làng đầu.
 * @param {string} message
 */
function wantsPhase1VillageStory(message) {
	const n = expandMessage(normalizeQuestion(message));
	const anotherHint =
		/\b(another|other|different|second|next|more|elsewhere|somewhere else)\b/.test(
			n,
		);
	if (!anotherHint) return false;
	const villageHint =
		/\b(village|villages|town|settlement|hamlet)\b/.test(n) ||
		/\b(trade|trades|trading|emerald)\b/.test(n);
	return villageHint;
}

/**
 * @param {string} message
 */
function isWhyQuestion(message) {
	const n = normalizeQuestion(message).trim();
	return n === "why" || n === "why?" || /^\s*why\b/.test(n);
}

/**
 * @param {string} message
 */
function isGoneLikeQuestion(message) {
	const n = expandMessage(normalizeQuestion(message));
	return (
		/\b(gone|despawn|despawned|disappeared|vanished|missing|left)\b/.test(
			n,
		) &&
		(/\b(like|mean|despawn)\b/.test(n) || looksLikeQuestion(message))
	);
}

/**
 * @param {string} message
 */
function isWhatHappenedHere(message) {
	const n = expandMessage(normalizeQuestion(message));
	return (
		/\bwhat happened\b/.test(n) ||
		/\bwhat s wrong\b/.test(n) ||
		(/\bwhat\b/.test(n) && /\b(here|this place|this village|this town)\b/.test(n))
	);
}

/**
 * @param {string} message
 * @param {import("@minecraft/server").Player} player
 */
function isHauntedStoryQuestion(message, player) {
	const n = expandMessage(normalizeQuestion(message));

	if (isWhatHappenedHere(message)) {
		return isAtHauntedVillage(player);
	}

	const placeHint =
		/\b(there|that place|that village|the village|the town|that town|the east|to the east|over there|east village|haunted|empty village|abandoned)\b/.test(
			n,
		);
	const eventHint =
		/\bwhat happened\b/.test(n) ||
		/\bwhat s wrong\b/.test(n) ||
		/\bwhats wrong\b/.test(n) ||
		/\bwhat (is|was) (going on|wrong|that)\b/.test(n) ||
		/\bwhat caused\b/.test(n) ||
		/\bwhy (is|are) (they|everyone|the villagers) (gone|missing|dead)\b/.test(n);

	return placeHint && eventHint;
}

/**
 * @param {string} message
 */
function isPillagerRaidQuestion(message) {
	const n = expandMessage(normalizeQuestion(message));
	return /\b(pillager|pillagers|raid|raiders?|illager)\b/.test(n);
}

/**
 * @param {string} message
 */
function isThenWhatQuestion(message) {
	const n = normalizeQuestion(message).trim();
	return (
		/\b(then what|so what|what then|what was it|what caused it)\b/.test(n) ||
		n === "what" ||
		n === "what?"
	);
}

/**
 * @typedef {{ text: string, intent?: string, voice?: string, afterReply?: () => void }} StoryReply
 */

/**
 * @param {import("@minecraft/server").Player} player
 * @param {string} message
 * @param {import("@minecraft/server").Entity | undefined} ball
 * @param {number} phase
 * @returns {Promise<StoryReply | null>}
 */
export async function tryStoryChat(player, message, ball, phase) {
	void ball;

	if (phase === PHASE.ONE) {
		const step = getStoryStep();

		if (step < STORY_PHASE1_DONE) {
			if (step === 0 && wantsPhase1VillageStory(message)) {
				await cacheHauntedVillageAnchor(player);
				startStoryEastWatch(player);
				setStoryStep(STORY_WAIT_WHY);
				return {
					text: "Yes, south. But I would avoid the ones to the east.",
					intent: "story",
					voice: VOICE.YES_SOUTH,
				};
			}

			if (step === STORY_WAIT_WHY && isWhyQuestion(message)) {
				setStoryStep(STORY_WAIT_GONE);
				return {
					text: "Uh, the villagers are gone.",
					intent: "story",
					voice: VOICE.VILLAGERS_GONE,
					afterReply: () => purgeHauntedVillage(player.dimension),
				};
			}

			if (step === STORY_WAIT_GONE && isGoneLikeQuestion(message)) {
				setStoryStep(STORY_PHASE1_DONE);
				return {
					text: "Gone.",
					intent: "story",
					voice: VOICE.GONE,
				};
			}

			return null;
		}

		const p2 = getPhase2StoryStep();
		if (p2 >= P2_DONE) return null;

		if (p2 === 0 && isHauntedStoryQuestion(message, player)) {
			if (isAtHauntedVillage(player)) {
				purgeHauntedVillage(player.dimension);
			}
			setPhase2StoryStep(P2_WAIT_PILLAGER);
			return {
				text: "Something passed through..",
				intent: "story",
				voice: VOICE.SOMETHING_PASSED,
			};
		}

		if (p2 === P2_WAIT_PILLAGER && isPillagerRaidQuestion(message)) {
			setPhase2StoryStep(P2_WAIT_THEN_WHAT);
			return { text: "No.", intent: "story", voice: VOICE.NO };
		}

		if (p2 === P2_WAIT_THEN_WHAT && isThenWhatQuestion(message)) {
			setPhase2StoryStep(P2_DONE);
			clearStoryEastWatch();
			return {
				text: "Something that was hungry.",
				intent: "story",
				voice: VOICE.SOMETHING_HUNGRY,
				afterReply: onHauntedStoryComplete,
			};
		}
	}

	return null;
}

/**
 * Dọn làng haunted khi player lần đầu vào vùng (backup nếu purge sớm bị miss).
 * @param {import("@minecraft/server").Player} player
 */
export function tickHauntedVillagePurge(player) {
	if (getStoryStep() < STORY_WAIT_GONE) return;
	if (world.getDynamicProperty(HAUNTED_PURGED_PROP) === true) return;
	if (!isAtHauntedVillage(player)) return;
	purgeHauntedVillage(player.dimension);
}

/** @returns {void} */
export function initHauntedVillagePurge() {
	system.runInterval(() => {
		for (const player of world.getPlayers()) {
			try {
				tickStoryEastWatch(player);
				tickHauntedVillagePurge(player);
			} catch (err) {
				console.warn(`verity story: haunted purge tick ${err}`);
			}
		}
	}, 40);
}
