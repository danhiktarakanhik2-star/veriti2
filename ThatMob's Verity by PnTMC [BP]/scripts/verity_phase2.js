import { Player, system, world } from "@minecraft/server";
import { animateContextTalk, animateTalkPulse } from "./verity_anim.js";
import { playVerityVoice, playVerityVoiceAt, VOICE } from "./verity_voices.js";
import { getSoundDurationTicks } from "./verity_sound_durations.js";
import {
	isMusicPlaying,
	playBallMusic,
	playBallSoundAt,
	playSoundAtLoc,
	stopBallMusic,
} from "./verity_music.js";
import {
	applyBallFace,
	applyContextIdleFace,
	applyPhaseFaces,
	enterVerityPhase,
	FACE_ABNORMAL_OPEN,
	FACE_ABNORMAL_SHUT,
	FACE_BORED_P2,
	FACE_CREEPY_SMILE,
	FACE_DAY2_OPEN,
	FACE_DAY2_SHUT,
	FACE_SMILE,
	getVerityPhase,
	isHorrorArcPhase,
	PHASE,
} from "./verity_phases.js";
import { FACE_BORED, FACE_GRIN, randomCreepySmileHoldTicks } from "./verity_faces.js";
import {
	expandMessage,
	looksLikeQuestion,
	normalizeQuestion,
	wantsSoundRequest,
} from "./verity_intent.js";
import {
	playerHoldingVerity,
	syncHeldVerityItem,
	VERITY_INVENTORY_IDS,
} from "./verity_items.js";

function sendVerityChat(text) {
	world.sendMessage(`<§eVerity§r> ${text}`);
}

const VERITYBALL_ID = "pntmc:verityball";
const TICKS_PER_DAY = 24000;
const PHASE2_DELAY_TICKS = 15000;
const COUNTDOWN_DAYS = 3;

const SOUND_SOMETHING_COMING = "pntmc.verity.somethingiscoming";
const SOUND_LOUD = "pntmc.verity.loudsound";
const SOUND_MOBBBBB = "pntmc.verity.mobbbbb";
const MYGAL_SOUND = "pntmc.verity.mygal_normal";

const PHASE2_SCHEDULE_PROP = "pntmc:phase2_schedule_tick";
const PHASE2_ENTER_PROP = "pntmc:phase2_enter_time";
const PHASE2_STATE_PROP = "pntmc:phase2_state";
const PHASE2_DAYS_BEFORE_HINT = 2;
const STORY_P2_STEP_PROP = "pntmc:verity_story_phase2";
const STORY_P2_DONE = 3;
const COUNTDOWN_START_PROP = "pntmc:countdown_start_time";
const COUNTDOWN_CHAT_DONE_PROP = "pntmc:countdown_chat_done";
const POST_DENIAL_CHATS_PROP = "pntmc:questions_after_denial";
const DENIAL_GIVEN_PROP = "pntmc:denial_given";
const LOUD_DONE_PROP = "pntmc:phase2_loud_done";
const TRAPPED_DONE_PROP = "pntmc:trapped_seq_done";
const WORLD_BOOT_PROP = "pntmc:verity_world_boot";

const VERITY_ITEM_IDS = VERITY_INVENTORY_IDS;

const INVENTORY_BALL_SKIP_DIST = 48;
const HIDE_CHECK_MAX_DIST = 28;
const HIDE_CHECK_MIN_DIST = 2.5;
const HIDE_FLEE_DIST = 36;
const CAGE_BREAK_RADIUS = 2;

const UNBREAKABLE_BLOCKS = new Set([
	"minecraft:bedrock",
	"minecraft:barrier",
	"minecraft:command_block",
	"minecraft:chain_command_block",
	"minecraft:repeating_command_block",
	"minecraft:structure_block",
	"minecraft:jigsaw",
]);

export const P2_STATE = {
	NONE: 0,
	BORED: 1,
	SMILING: 2,
	COUNTDOWN: 3,
	COUNTDOWN_DAY2: 4,
	POST_LOUD: 5,
	ABNORMAL: 6,
};

/** @type {Map<string, number>} */
const faceLoops = new Map();

/** @type {Map<string, number>} */
const inventoryFaceLoops = new Map();

/** @type {Set<string>} */
const sleptThisCycle = new Set();

/** @type {number | undefined} */
let dawnHandledAt = undefined;

const BORED_AUTO_SMILE_MIN_TICKS = 100;
const BORED_AUTO_SMILE_MAX_TICKS = 120;

/** @type {number | undefined} */
let boredAutoSmileTimer = undefined;

/** @type {Map<string, number>} */
const creepySmileTimers = new Map();

function clearBoredAutoSmileTimer() {
	if (boredAutoSmileTimer === undefined) return;
	system.clearRun(boredAutoSmileTimer);
	boredAutoSmileTimer = undefined;
}

function advanceToSmilingSilent() {
	if (getPhase2State() !== P2_STATE.BORED) return;
	clearBoredAutoSmileTimer();
	setPhase2State(P2_STATE.SMILING);
	applyPhase2ToAll();
	scheduleCreepySmileRelease();
	console.warn("verity phase2: auto smile (silent)");
}

function scheduleBoredAutoSmile() {
	clearBoredAutoSmileTimer();
	const delay =
		BORED_AUTO_SMILE_MIN_TICKS +
		Math.floor(
			Math.random() * (BORED_AUTO_SMILE_MAX_TICKS - BORED_AUTO_SMILE_MIN_TICKS + 1),
		);
	boredAutoSmileTimer = system.runTimeout(() => {
		boredAutoSmileTimer = undefined;
		advanceToSmilingSilent();
	}, delay);
	console.warn(`verity phase2: bored auto-smile in ${delay} ticks`);
}

/**
 * @param {string} key
 */
function clearCreepySmileTimer(key = "global") {
	const runId = creepySmileTimers.get(key);
	if (runId === undefined) return;
	system.clearRun(runId);
	creepySmileTimers.delete(key);
}

function scheduleCreepySmileRelease() {
	clearCreepySmileTimer();
	const hold = randomCreepySmileHoldTicks();
	const runId = system.runTimeout(() => {
		creepySmileTimers.delete("global");
		if (getPhase2State() !== P2_STATE.SMILING) return;
		setPhase2State(P2_STATE.ABNORMAL);
		applyPhase2ToAll();
		console.warn(`verity phase2: creepysmile held ${hold} ticks — abnormal faces`);
	}, hold);
	creepySmileTimers.set("global", runId);
	console.warn(`verity phase2: creepysmile hold ${hold} ticks`);
}

/**
 * @param {string} ballId
 */
function stopFaceLoop(ballId) {
	const runId = faceLoops.get(ballId);
	if (runId === undefined) return;
	system.clearRun(runId);
	faceLoops.delete(ballId);
}

/**
 * @param {import("@minecraft/server").Entity} ball
 * @param {number[]} faces
 * @param {number} interval
 */
function startFaceLoop(ball, faces, interval = 40) {
	if (!ball.isValid) return;
	stopFaceLoop(ball.id);
	let idx = 0;
	applyBallFace(ball, faces[idx], false);
	const runId = system.runInterval(() => {
		if (!ball.isValid || !isHorrorArcPhase()) {
			stopFaceLoop(ball.id);
			return;
		}
		try {
			if (ball.getProperty("pntmc:talking") === true) return;
		} catch {
			/* ignore */
		}
		idx = (idx + 1) % faces.length;
		applyBallFace(ball, faces[idx], false);
	}, interval);
	faceLoops.set(ball.id, runId);
}

/**
 * @param {string} playerId
 */
function stopInventoryFaceLoop(playerId) {
	const runId = inventoryFaceLoops.get(playerId);
	if (runId === undefined) return;
	system.clearRun(runId);
	inventoryFaceLoops.delete(playerId);
}

/**
 * @param {import("@minecraft/server").Player} player
 * @param {number[]} faces
 * @param {number} interval
 */
function startInventoryFaceLoop(player, faces, interval = 40) {
	if (!player.isValid) return;
	stopInventoryFaceLoop(player.id);
	let idx = 0;
	syncHeldVerityItem(player, faces[idx]);
	const runId = system.runInterval(() => {
		if (!player.isValid || !isHorrorArcPhase() || !playerHoldingVerity(player)) {
			stopInventoryFaceLoop(player.id);
			return;
		}
		if (findNearestBall(player, INVENTORY_BALL_SKIP_DIST)) {
			stopInventoryFaceLoop(player.id);
			return;
		}
		idx = (idx + 1) % faces.length;
		syncHeldVerityItem(player, faces[idx]);
	}, interval);
	inventoryFaceLoops.set(player.id, runId);
}

/**
 * Đồng bộ mặt item Verity trên tay khi player chưa đặt ball ra.
 * @param {import("@minecraft/server").Player} player
 * @param {boolean} [force]
 */
function applyPhase2PlayerInventory(player, force = false) {
	if (!playerHoldingVerity(player)) {
		stopInventoryFaceLoop(player.id);
		return;
	}
	if (findNearestBall(player, INVENTORY_BALL_SKIP_DIST)) {
		stopInventoryFaceLoop(player.id);
		return;
	}

	const state = getPhase2State();

	switch (state) {
		case P2_STATE.BORED:
			stopInventoryFaceLoop(player.id);
			syncHeldVerityItem(player, FACE_BORED_P2);
			break;
		case P2_STATE.SMILING:
			stopInventoryFaceLoop(player.id);
			syncHeldVerityItem(player, FACE_CREEPY_SMILE);
			break;
		case P2_STATE.ABNORMAL:
		case P2_STATE.COUNTDOWN:
			if (force) stopInventoryFaceLoop(player.id);
			if (force || !inventoryFaceLoops.has(player.id)) {
				startInventoryFaceLoop(player, [FACE_ABNORMAL_SHUT, FACE_ABNORMAL_OPEN]);
			}
			break;
		case P2_STATE.COUNTDOWN_DAY2:
		case P2_STATE.POST_LOUD:
			if (force) stopInventoryFaceLoop(player.id);
			if (force || !inventoryFaceLoops.has(player.id)) {
				startInventoryFaceLoop(player, [FACE_DAY2_SHUT, FACE_DAY2_OPEN]);
			}
			break;
		default:
			stopInventoryFaceLoop(player.id);
			syncHeldVerityItem(player, FACE_BORED_P2);
	}
}

/**
 * @returns {number}
 */
export function getPhase2State() {
	const state = world.getDynamicProperty(PHASE2_STATE_PROP);
	return typeof state === "number" ? state : P2_STATE.NONE;
}

/**
 * @param {number} state
 */
function setPhase2State(state) {
	world.setDynamicProperty(PHASE2_STATE_PROP, state);
	console.warn(`verity phase2: state ${state}`);
}

/**
 * @param {import("@minecraft/server").Entity} ball
 */
function isBallFaceless(ball) {
	try {
		return ball.getProperty("pntmc:faceless") === true;
	} catch {
		return false;
	}
}

/**
 * @param {import("@minecraft/server").Entity} ball
 */
export function applyPhase2BallFaces(ball) {
	if (!ball.isValid) return;
	if (isBallFaceless(ball)) return;
	const state = getPhase2State();
	stopFaceLoop(ball.id);

	switch (state) {
		case P2_STATE.BORED:
			applyBallFace(ball, FACE_BORED_P2, false);
			break;
		case P2_STATE.SMILING:
			applyBallFace(ball, FACE_CREEPY_SMILE, false);
			break;
		case P2_STATE.ABNORMAL:
		case P2_STATE.COUNTDOWN:
			startFaceLoop(ball, [FACE_ABNORMAL_SHUT, FACE_ABNORMAL_OPEN]);
			break;
		case P2_STATE.COUNTDOWN_DAY2:
		case P2_STATE.POST_LOUD:
			startFaceLoop(ball, [FACE_DAY2_SHUT, FACE_DAY2_OPEN]);
			break;
		default:
			applyBallFace(ball, FACE_BORED_P2, false);
	}
}

function applyPhase2ToAllBalls() {
	const seen = new Set();
	for (const player of world.getPlayers()) {
		for (const ball of player.dimension.getEntities({ type: VERITYBALL_ID })) {
			if (!ball.isValid || seen.has(ball.id)) continue;
			seen.add(ball.id);
			applyPhase2BallFaces(ball);
		}
	}
}

function applyPhase2ToAll() {
	applyPhase2ToAllBalls();
	for (const player of world.getPlayers()) {
		try {
			applyPhase2PlayerInventory(player, true);
		} catch (err) {
			console.warn(`verity phase2 inventory faces ${player.name}: ${err}`);
		}
	}
}

/**
 * @returns {boolean}
 */
function isHauntedStoryComplete() {
	const step = world.getDynamicProperty(STORY_P2_STEP_PROP);
	return typeof step === "number" && step >= STORY_P2_DONE;
}

function resetToPhaseOne(clearSchedule = true) {
	enterVerityPhase(PHASE.ONE);
	setPhase2State(P2_STATE.NONE);
	clearCreepySmileTimer();
	clearBoredAutoSmileTimer();
	world.setDynamicProperty(PHASE2_ENTER_PROP, undefined);
	if (clearSchedule) {
		world.setDynamicProperty(PHASE2_SCHEDULE_PROP, undefined);
	}
}

/**
 * Reset all Verity progression (testing / fresh start on same world).
 */
export function resetVerityProgress() {
	world.setDynamicProperty(PHASE2_SCHEDULE_PROP, undefined);
	world.setDynamicProperty(STORY_P2_STEP_PROP, undefined);
	world.setDynamicProperty(COUNTDOWN_START_PROP, undefined);
	world.setDynamicProperty(COUNTDOWN_CHAT_DONE_PROP, undefined);
	world.setDynamicProperty(POST_DENIAL_CHATS_PROP, 0);
	world.setDynamicProperty(DENIAL_GIVEN_PROP, false);
	world.setDynamicProperty(LOUD_DONE_PROP, false);
	world.setDynamicProperty(TRAPPED_DONE_PROP, false);
	resetToPhaseOne(true);
	syncAllBallFaces();
	console.warn("verity phase2: progress reset to phase 1");
}

/**
 * Baseline khi Verity mới xuất hiện từ hộp (playthrough mới).
 */
export function ensureNewGamePhaseOne() {
	enterVerityPhase(PHASE.ONE);
	setPhase2State(P2_STATE.NONE);
	world.setDynamicProperty(PHASE2_SCHEDULE_PROP, undefined);
	world.setDynamicProperty(COUNTDOWN_START_PROP, undefined);
	world.setDynamicProperty(COUNTDOWN_CHAT_DONE_PROP, undefined);
	world.setDynamicProperty(POST_DENIAL_CHATS_PROP, 0);
	world.setDynamicProperty(DENIAL_GIVEN_PROP, false);
	world.setDynamicProperty(LOUD_DONE_PROP, false);
	world.setDynamicProperty(TRAPPED_DONE_PROP, false);
	console.warn("verity: new game baseline — phase 1");
}

/**
 * Log saved world progression (dynamic properties persist per world save).
 */
export function logVerityProgressStatus() {
	const phase = getVerityPhase();
	const storyP2 = world.getDynamicProperty(STORY_P2_STEP_PROP);
	const enterAt = world.getDynamicProperty(PHASE2_SCHEDULE_PROP);
	const now = world.getAbsoluteTime();
	console.warn(
		`verity progress: phase=${phase} p2state=${getPhase2State()} storyP2=${typeof storyP2 === "number" ? storyP2 : 0} hauntedDone=${isHauntedStoryComplete()} scheduleIn=${typeof enterAt === "number" ? Math.max(0, enterAt - now) : "none"} ticks`,
	);
}

function bootstrapWorldOnce() {
	if (world.getDynamicProperty(WORLD_BOOT_PROP) === true) return;
	world.setDynamicProperty(WORLD_BOOT_PROP, true);

	const savedPhase = world.getDynamicProperty("pntmc:verity_phase");
	const storyP2 = world.getDynamicProperty(STORY_P2_STEP_PROP);
	const p2state = world.getDynamicProperty(PHASE2_STATE_PROP);
	const hauntedDone = typeof storyP2 === "number" && storyP2 >= STORY_P2_DONE;
	const hasSaveData =
		(typeof savedPhase === "number" && savedPhase > PHASE.ONE) ||
		hauntedDone ||
		(typeof p2state === "number" &&
			p2state > P2_STATE.NONE &&
			typeof savedPhase === "number" &&
			savedPhase >= PHASE.TWO);

	if (!hasSaveData) {
		world.setDynamicProperty("pntmc:verity_phase", undefined);
		world.setDynamicProperty(STORY_P2_STEP_PROP, undefined);
		world.setDynamicProperty(PHASE2_STATE_PROP, undefined);
		world.setDynamicProperty(PHASE2_SCHEDULE_PROP, undefined);
		enterVerityPhase(PHASE.ONE);
		setPhase2State(P2_STATE.NONE);
		console.warn("verity: fresh world — baseline phase 1");
	} else {
		console.warn(
			`verity: world boot — kept save phase ${getVerityPhase()} p2state ${getPhase2State()}`,
		);
	}
}

/**
 * Chạy mỗi lần load world / reload script — chặn phase nhảy sớm.
 */
export function enforceProgressionIntegrity() {
	const rawPhase = world.getDynamicProperty("pntmc:verity_phase");
	if (rawPhase !== undefined && typeof rawPhase !== "number") {
		enterVerityPhase(PHASE.ONE);
		setPhase2State(P2_STATE.NONE);
		console.warn(`verity: fixed invalid phase property (${rawPhase})`);
	}

	const phase = getVerityPhase();
	const hauntedDone = isHauntedStoryComplete();
	const p2state = getPhase2State();

	if (phase === PHASE.ONE && p2state !== P2_STATE.NONE) {
		setPhase2State(P2_STATE.NONE);
		world.setDynamicProperty(PHASE2_SCHEDULE_PROP, undefined);
		console.warn("verity: cleared orphan p2state on phase 1");
	}

	if (phase >= PHASE.TWO && !hauntedDone) {
		console.warn(`verity: reset — phase ${phase} without haunted story`);
		resetToPhaseOne(true);
		world.setDynamicProperty(STORY_P2_STEP_PROP, undefined);
		syncAllBallFaces();
		return;
	}

	if (
		(phase === PHASE.THREE || phase === PHASE.FOUR) &&
		p2state < P2_STATE.COUNTDOWN
	) {
		console.warn(`verity: reset — phase ${phase} without countdown`);
		enterVerityPhase(PHASE.TWO);
		setPhase2State(P2_STATE.BORED);
		syncAllBallFaces();
	}

	if (
		phase >= PHASE.TWO &&
		typeof world.getDynamicProperty(PHASE2_ENTER_PROP) !== "number"
	) {
		world.setDynamicProperty(
			PHASE2_ENTER_PROP,
			world.getAbsoluteTime() - TICKS_PER_DAY * PHASE2_DAYS_BEFORE_HINT,
		);
		console.warn("verity: backfilled phase 2 enter time for save");
	}

	migrateLegacyPhaseNumbers();
}

function syncAllBallFaces() {
	const seen = new Set();
	for (const player of world.getPlayers()) {
		for (const ball of player.dimension.getEntities({ type: VERITYBALL_ID })) {
			if (!ball.isValid || seen.has(ball.id)) continue;
			seen.add(ball.id);
			if (isHorrorArcPhase()) {
				applyPhase2BallFaces(ball);
			} else {
				applyPhaseFaces(ball);
			}
		}
	}
	if (isHorrorArcPhase()) {
		for (const player of world.getPlayers()) {
			try {
				applyPhase2PlayerInventory(player, true);
			} catch (err) {
				console.warn(`verity sync inventory faces ${player.name}: ${err}`);
			}
		}
	} else {
		for (const player of world.getPlayers()) {
			stopInventoryFaceLoop(player.id);
			syncHeldVerityItem(player, FACE_SMILE);
		}
	}
}

/**
 * Fix stale saves: phase 2 only after haunted village story + ~25 min delay.
 */
export function validatePhaseProgression() {
	enforceProgressionIntegrity();

	const phase = getVerityPhase();
	const hauntedDone = isHauntedStoryComplete();
	const enterAt = world.getDynamicProperty(PHASE2_SCHEDULE_PROP);
	const now = world.getAbsoluteTime();

	if (phase >= PHASE.TWO && hauntedDone) {
		if (typeof enterAt === "number" && now < enterAt) {
			console.warn("verity: waiting for phase 2 schedule");
			return;
		}
	}

	if (!hauntedDone) {
		world.setDynamicProperty(PHASE2_SCHEDULE_PROP, undefined);
		return;
	}

	if (phase < PHASE.TWO && typeof enterAt !== "number") {
		schedulePhase2Entry();
	}
}

/** Save cũ: countdown chạy trong phase 2 → phase 3. */
function migrateLegacyPhaseNumbers() {
	const phase = getVerityPhase();
	const state = getPhase2State();
	if (phase === PHASE.TWO && state >= P2_STATE.COUNTDOWN) {
		enterVerityPhase(PHASE.THREE);
		console.warn("verity phase2: migrated save to phase 3 (countdown)");
	}
}

export function enterPhase2Bored() {
	if (getVerityPhase() >= PHASE.TWO) return;
	if (!isHauntedStoryComplete()) {
		console.warn("verity phase2: blocked — haunted story not done");
		return;
	}
	enterVerityPhase(PHASE.TWO);
	setPhase2State(P2_STATE.BORED);
	world.setDynamicProperty(PHASE2_ENTER_PROP, world.getAbsoluteTime());
	system.run(() => applyPhase2ToAll());
	scheduleBoredAutoSmile();
	console.warn("verity phase2: entered with bored face (6)");
}

export function schedulePhase2Entry() {
	if (getVerityPhase() >= PHASE.TWO) return;
	if (!isHauntedStoryComplete()) {
		console.warn("verity phase2: schedule blocked — story incomplete");
		return;
	}
	const enterAt = world.getAbsoluteTime() + PHASE2_DELAY_TICKS;
	world.setDynamicProperty(PHASE2_SCHEDULE_PROP, enterAt);
	console.warn(
		`verity phase2: scheduled at world time ${enterAt} (+${PHASE2_DELAY_TICKS} ticks)`,
	);
}

function tickPhase2Scheduler() {
	if (getVerityPhase() >= PHASE.TWO) return;
	if (!isHauntedStoryComplete()) {
		world.setDynamicProperty(PHASE2_SCHEDULE_PROP, undefined);
		return;
	}
	const enterAt = world.getDynamicProperty(PHASE2_SCHEDULE_PROP);
	if (typeof enterAt !== "number") return;
	if (world.getAbsoluteTime() < enterAt) return;
	world.setDynamicProperty(PHASE2_SCHEDULE_PROP, undefined);
	enterPhase2Bored();
}

/**
 * @returns {number}
 */
function getCountdownDay() {
	const start = world.getDynamicProperty(COUNTDOWN_START_PROP);
	if (typeof start !== "number") return 0;
	return Math.floor((world.getAbsoluteTime() - start) / TICKS_PER_DAY) + 1;
}

function tickCountdownDays() {
	const state = getPhase2State();
	if (state !== P2_STATE.COUNTDOWN && state !== P2_STATE.COUNTDOWN_DAY2) return;

	const day = getCountdownDay();
	if (day >= 2 && state === P2_STATE.COUNTDOWN) {
		setPhase2State(P2_STATE.COUNTDOWN_DAY2);
		applyPhase2ToAll();
		console.warn("verity phase2: countdown day 2 faces");
	}
}

/**
 * @returns {boolean}
 */
function hasTwoPhase2DaysElapsed() {
	const entered = world.getDynamicProperty(PHASE2_ENTER_PROP);
	if (typeof entered !== "number") return false;
	return (
		world.getAbsoluteTime() - entered >=
		TICKS_PER_DAY * PHASE2_DAYS_BEFORE_HINT
	);
}

/**
 * @param {string} message
 */
function isSomethingToKnowTodayQuestion(message) {
	const n = expandMessage(normalizeQuestion(message));
	const knowHint =
		/\b(need to know|should know|have to know|must know|ought to know|need to hear|should hear|warn me|heads up)\b/.test(
			n,
		) ||
		(/\b(anything|something|what)\b/.test(n) &&
			/\b(worry|worried|coming|happen|wrong|important|prepare|ready|afraid|scared)\b/.test(
				n,
			));
	if (!knowHint) return false;
	return (
		/\b(today|this day|tonight|right now|now)\b/.test(n) ||
		/\b(should i|do i need|am i safe)\b/.test(n) ||
		(/\b(coming|happen|wrong|important)\b/.test(n) && looksLikeQuestion(message))
	);
}

function sendCountdownAnnouncementOnce() {
	if (world.getDynamicProperty(COUNTDOWN_CHAT_DONE_PROP) === true) return;
	world.setDynamicProperty(COUNTDOWN_CHAT_DONE_PROP, true);
	sendVerityChat("Something is coming in 3 days.");
}

/**
 * @param {import("@minecraft/server").Player} player
 * @param {import("@minecraft/server").Entity | undefined} ball
 * @param {{ skipChat?: boolean, markChatDone?: boolean }} [options]
 */
function announceSomethingComing(player, ball, options = {}) {
	clearCreepySmileTimer();
	clearBoredAutoSmileTimer();
	enterVerityPhase(PHASE.THREE);
	setPhase2State(P2_STATE.COUNTDOWN);
	world.setDynamicProperty(COUNTDOWN_START_PROP, world.getAbsoluteTime());
	world.setDynamicProperty(POST_DENIAL_CHATS_PROP, 0);
	world.setDynamicProperty(DENIAL_GIVEN_PROP, false);
	world.setDynamicProperty(LOUD_DONE_PROP, false);
	world.setDynamicProperty(TRAPPED_DONE_PROP, false);
	resetFacelessOnAllBalls();

	if (ball?.isValid) {
		playBallSoundAt(ball, SOUND_SOMETHING_COMING, FACE_ABNORMAL_OPEN);
	}
	if (options.markChatDone) {
		world.setDynamicProperty(COUNTDOWN_CHAT_DONE_PROP, true);
	} else if (!options.skipChat) {
		sendCountdownAnnouncementOnce();
	}
	applyPhase2ToAll();
	console.warn("verity phase2: phase 3 — countdown started");
}

/**
 * @param {import("@minecraft/server").Player} player
 */
function onPlayerFinishedSleep(player) {
	const state = getPhase2State();
	if (
		state === P2_STATE.BORED ||
		state === P2_STATE.SMILING ||
		state === P2_STATE.ABNORMAL
	) {
		clearCreepySmileTimer();
		const ball = findNearestBall(player);
		announceSomethingComing(player, ball, { skipChat: true });
	}
}

/**
 * @param {string} message
 */
function asksAboutFace(message) {
	const n = expandMessage(normalizeQuestion(message));
	return (
		/\b(what s wrong|whats wrong|what happened to your face|why that face)\b/.test(
			n,
		) ||
		(/\b(face|look|expression)\b/.test(n) &&
			/\b(wrong|weird|off|sad|bored|blank|strange|problem|matter|why|happened)\b/.test(
				n,
			)) ||
		/\b(are you okay|are you ok|you alright|something wrong with you)\b/.test(n)
	);
}

/**
 * @param {string} message
 */
function isLookDifferentQuestion(message) {
	const n = expandMessage(normalizeQuestion(message));
	return (
		/\b(you look different|look different|changed|not the same|something off)\b/.test(
			n,
		) ||
		(/\b(different|weird|strange)\b/.test(n) &&
			/\b(face|look|you)\b/.test(n))
	);
}

/**
 * @param {string} message
 */
function isDenialChallenge(message) {
	const n = expandMessage(normalizeQuestion(message));
	return (
		/\b(don t think|dont think|not true|that s not true|you re lying|sure about that)\b/.test(
			n,
		) ||
		/\b(i don t believe|same thing again|say that again|keep saying)\b/.test(n)
	);
}

/**
 * @param {string} message
 */
function wantsDoorSound(message) {
	const n = expandMessage(normalizeQuestion(message));
	return wantsSoundRequest(message) && /\b(door|doors)\b/.test(n);
}

/**
 * @param {string} message
 */
function detectPhase2Social(message) {
	const n = expandMessage(normalizeQuestion(message));
	if (/\b(how old are you|your age|when were you born)\b/.test(n)) {
		return "how_old";
	}
	if (/\b(how are you|how re you|how have you been|you good)\b/.test(n)) {
		return "how_are_you";
	}
	if (
		/\b(hi|hello|hey|good morning|good evening|sup|yo)\b/.test(n) &&
		message.trim().length < 48
	) {
		return "greet";
	}
	if (/\b(thanks|thank you|ty)\b/.test(n)) return "thanks";
	return null;
}

/**
 * @param {string} key
 */
function pickLine(key) {
	/** @type {Record<string, string[]>} */
	const lines = {
		how_old: [
			"I'm older than this game.",
			"Older than this game. That's all I'll say.",
		],
		how_are_you: [
			"Fine. You?",
			"Still here. Still watching.",
			"Could be worse. Could be you.",
		],
		greet: ["Hey.", "Hello.", "Hi. I'm still here."],
		thanks: ["Sure.", "Anytime.", "Don't mention it."],
		mumble: ["Still here.", "Keep talking.", "I hear you.", "Mhm."],
		ignore: [
			"...",
			"I didn't hear you.",
			"Ask again. Or don't.",
		],
	};
	const pool = lines[key] ?? lines.ignore;
	return pool[Math.floor(Math.random() * pool.length)];
}

/**
 * @param {string} name
 */
function stretchName(name) {
	const safe = (name || "You").trim();
	if (safe.length <= 1) return safe.repeat(8);
	const last = safe.slice(-1);
	return safe.slice(0, -1) + last.repeat(10 + Math.floor(Math.random() * 6));
}

/**
 * @param {{ x: number, y: number, z: number }} a
 * @param {{ x: number, z: number }} b
 */
function flatDistance(a, b) {
	const dx = a.x - b.x;
	const dz = a.z - b.z;
	return Math.sqrt(dx * dx + dz * dz);
}

/**
 * @param {import("@minecraft/server").Player} player
 * @param {number} [radius]
 */
function findNearestBall(player, radius = 32) {
	let nearest;
	let best = radius;
	for (const ball of player.dimension.getEntities({ type: VERITYBALL_ID })) {
		if (!ball.isValid) continue;
		const d = flatDistance(player.location, ball.location);
		if (d < best) {
			best = d;
			nearest = ball;
		}
	}
	return nearest;
}

const DOOR_IDS = new Set([
	"minecraft:wooden_door",
	"minecraft:spruce_door",
	"minecraft:birch_door",
	"minecraft:jungle_door",
	"minecraft:acacia_door",
	"minecraft:dark_oak_door",
	"minecraft:mangrove_door",
	"minecraft:cherry_door",
	"minecraft:bamboo_door",
	"minecraft:crimson_door",
	"minecraft:warped_door",
	"minecraft:iron_door",
]);

/**
 * @param {import("@minecraft/server").Entity} ball
 * @param {number} radius
 */
function toggleNearbyDoors(ball, radius = 18) {
	const dim = ball.dimension;
	const center = ball.location;
	let toggled = 0;

	for (let dx = -radius; dx <= radius; dx++) {
		for (let dy = -4; dy <= 4; dy++) {
			for (let dz = -radius; dz <= radius; dz++) {
				const block = dim.getBlock({
					x: Math.floor(center.x + dx),
					y: Math.floor(center.y + dy),
					z: Math.floor(center.z + dz),
				});
				if (!block || !DOOR_IDS.has(block.typeId)) continue;

				try {
					const perm = block.permutation;
					const openBit = perm.getState("open_bit");
					const isOpen = openBit === true || openBit === 1;
					block.setPermutation(perm.withState("open_bit", !isOpen));
					playBallSoundAt(
						ball,
						isOpen ? "random.door_close" : "random.door_open",
						FACE_DAY2_OPEN,
					);
					toggled++;
				} catch {
					/* ignore single door */
				}
			}
		}
	}

	return toggled;
}

/**
 * @param {import("@minecraft/server").Entity} ball
 * @param {import("@minecraft/server").Player} player
 */
function isBallHiddenFromPlayer(ball, player) {
	const dist = flatDistance(player.location, ball.location);
	if (dist > HIDE_CHECK_MAX_DIST || dist < HIDE_CHECK_MIN_DIST) return false;

	try {
		const head = player.getHeadLocation();
		const target = ball.location;
		const dx = target.x - head.x;
		const dy = target.y - head.y;
		const dz = target.z - head.z;
		const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
		const hit = player.dimension.getBlockFromRay(
			head,
			{ x: dx / len, y: dy / len, z: dz / len },
			{ maxDistance: HIDE_CHECK_MAX_DIST, includeLiquidBlocks: false, includePassableBlocks: false },
		);
		if (!hit?.block) return false;
		const hx = hit.block.location.x + 0.5;
		const hz = hit.block.location.z + 0.5;
		const hitDist = Math.sqrt(
			(hx - head.x) ** 2 + (hit.block.location.y - head.y) ** 2 + (hz - head.z) ** 2,
		);
		return hitDist < len - 1.2;
	} catch {
		return false;
	}
}

/**
 * @param {import("@minecraft/server").Entity} ball
 */
function isBallEntombed(ball) {
	const dim = ball.dimension;
	const loc = ball.location;
	const checks = [
		[1, 0, 0],
		[-1, 0, 0],
		[0, 1, 0],
		[0, -1, 0],
		[0, 0, 1],
		[0, 0, -1],
	];
	let solid = 0;
	for (const [dx, dy, dz] of checks) {
		const block = dim.getBlock({
			x: Math.floor(loc.x + dx),
			y: Math.floor(loc.y + dy),
			z: Math.floor(loc.z + dz),
		});
		if (block && block.typeId !== "minecraft:air") solid++;
	}
	return solid >= 5;
}

/**
 * @param {import("@minecraft/server").Player} player
 */
function playerHasVerityStashed(player) {
	const container = player.getComponent("minecraft:inventory")?.container;
	if (!container) return false;
	for (let slot = 0; slot < container.size; slot++) {
		const stack = container.getItem(slot);
		if (stack && VERITY_ITEM_IDS.has(stack.typeId)) return true;
	}
	return false;
}

/**
 * @param {import("@minecraft/server").Player} player
 */
function removeVerityFromInventory(player) {
	const container = player.getComponent("minecraft:inventory")?.container;
	if (!container) return false;
	for (let slot = 0; slot < container.size; slot++) {
		const stack = container.getItem(slot);
		if (!stack || !VERITY_ITEM_IDS.has(stack.typeId)) continue;
		if (stack.amount <= 1) {
			container.setItem(slot);
		} else {
			stack.amount -= 1;
			container.setItem(slot, stack);
		}
		return true;
	}
	return false;
}

/**
 * @param {import("@minecraft/server").Entity | undefined} ball
 * @param {import("@minecraft/server").Player} player
 * @param {string} soundId
 */
function playTrappedSound(ball, player, soundId) {
	if (ball?.isValid) {
		playBallSoundAt(
			ball,
			soundId,
			FACE_DAY2_OPEN,
			getSoundDurationTicks(soundId),
		);
		return;
	}
	playSoundAtLoc(player, player.location, soundId);
}

/**
 * @param {import("@minecraft/server").Entity | undefined} ball
 * @param {import("@minecraft/server").Player} player
 * @param {string} soundId
 */
function playTrappedVoice(ball, player, soundId) {
	if (ball?.isValid) {
		playVerityVoice(ball, soundId);
		return;
	}
	playSoundAtLoc(player, player.location, soundId);
}

/**
 * @param {import("@minecraft/server").Entity} ball
 */
function stripVerityFace(ball) {
	if (!ball?.isValid) return;
	stopFaceLoop(ball.id);
	try {
		ball.setProperty("pntmc:faceless", true);
		ball.setProperty("pntmc:talking", false);
	} catch (err) {
		console.warn(`verity phase2: strip face ${err}`);
	}
}

function resetFacelessOnAllBalls() {
	for (const player of world.getPlayers()) {
		for (const ball of player.dimension.getEntities({ type: VERITYBALL_ID })) {
			if (!ball.isValid || !isBallFaceless(ball)) continue;
			try {
				ball.setProperty("pntmc:faceless", false);
			} catch {
				/* ignore */
			}
		}
	}
}

/**
 * @param {import("@minecraft/server").Entity} ball
 */
function shatterCageAroundBall(ball) {
	if (!ball.isValid) return 0;

	const dim = ball.dimension;
	const cx = Math.floor(ball.location.x);
	const cy = Math.floor(ball.location.y);
	const cz = Math.floor(ball.location.z);
	let broke = 0;

	for (let dx = -CAGE_BREAK_RADIUS; dx <= CAGE_BREAK_RADIUS; dx++) {
		for (let dy = -CAGE_BREAK_RADIUS; dy <= CAGE_BREAK_RADIUS; dy++) {
			for (let dz = -CAGE_BREAK_RADIUS; dz <= CAGE_BREAK_RADIUS; dz++) {
				if (dx === 0 && dy === 0 && dz === 0) continue;
				const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
				if (dist > CAGE_BREAK_RADIUS + 0.5) continue;

				const block = dim.getBlock({ x: cx + dx, y: cy + dy, z: cz + dz });
				if (!block || block.typeId === "minecraft:air") continue;
				if (UNBREAKABLE_BLOCKS.has(block.typeId)) continue;

				try {
					block.setType("minecraft:air");
					broke++;
				} catch {
					/* ignore single block */
				}
			}
		}
	}

	if (broke > 0) {
		try {
			playBallSoundAt(ball, "random.explode", FACE_DAY2_OPEN);
		} catch {
			const listener = dim.getPlayers()[0];
			if (listener) {
				playSoundAtLoc(listener, ball.location, "random.explode");
			}
		}
	}

	return broke;
}

/**
 * @param {import("@minecraft/server").Player} player
 * @param {import("@minecraft/server").Entity | undefined} ball
 * @param {"entombed"|"hidden"|"stashed"|"fled"} reason
 * @returns {import("@minecraft/server").Entity | undefined}
 */
function resolveTrappedVerity(player, ball, reason) {
	let resolved = ball;

	if (reason === "stashed") {
		removeVerityFromInventory(player);
		if (!resolved?.isValid) {
			try {
				resolved = player.dimension.spawnEntity(VERITYBALL_ID, {
					x: player.location.x,
					y: player.location.y + 0.35,
					z: player.location.z,
				});
			} catch (err) {
				console.warn(`verity phase2: stashed spawn ${err}`);
				return undefined;
			}
		}
	}

	if (!resolved?.isValid) return undefined;

	if (reason === "entombed" || isBallEntombed(resolved)) {
		const broke = shatterCageAroundBall(resolved);
		console.warn(`verity phase2: shattered ${broke} cage blocks`);
	}

	stripVerityFace(resolved);
	console.warn(`verity phase2: faceless at cage (${reason})`);
	return resolved;
}

/**
 * @param {import("@minecraft/server").Player} player
 * @param {import("@minecraft/server").Entity | undefined} ball
 * @param {"entombed"|"hidden"|"stashed"|"fled"} reason
 */
function runTrappedSequence(player, ball, reason) {
	if (world.getDynamicProperty(TRAPPED_DONE_PROP) === true) return;
	world.setDynamicProperty(TRAPPED_DONE_PROP, true);

	console.warn(`verity phase2: trapped sequence (${reason})`);

	playTrappedVoice(ball, player, VOICE.ITS_ALREADY_OVER);
	sendVerityChat("It's already over.");

	system.runTimeout(() => {
		playTrappedVoice(ball, player, VOICE.YOU_ARE_MINE);
		sendVerityChat("You are mine.");
	}, 50);

	const stretchAt = 100;
	system.runTimeout(() => {
		playTrappedSound(ball, player, SOUND_MOBBBBB);
		sendVerityChat(stretchName(player.name));
	}, stretchAt);

	const freeAt = stretchAt + getSoundDurationTicks(SOUND_MOBBBBB) + 12;
	system.runTimeout(() => {
		resolveTrappedVerity(player, ball, reason);
		sendVerityChat("You can't hide from me.");
	}, freeAt);
}

/**
 * @param {import("@minecraft/server").Player} player
 */
function tickTrappedCheck(player) {
	const state = getPhase2State();
	if (
		state !== P2_STATE.COUNTDOWN &&
		state !== P2_STATE.COUNTDOWN_DAY2
	) {
		return;
	}
	if (world.getDynamicProperty(TRAPPED_DONE_PROP) === true) return;

	if (playerHasVerityStashed(player)) {
		runTrappedSequence(player, undefined, "stashed");
		return;
	}

	const ball = findNearestBall(player, 64);
	if (!ball) return;

	if (flatDistance(player.location, ball.location) > HIDE_FLEE_DIST) {
		runTrappedSequence(player, ball, "fled");
		return;
	}

	if (isBallEntombed(ball)) {
		runTrappedSequence(player, ball, "entombed");
		return;
	}

	if (isBallHiddenFromPlayer(ball, player)) {
		runTrappedSequence(player, ball, "hidden");
	}
}

/**
 * @returns {boolean}
 */
export function shouldBlockSleep() {
	const state = getPhase2State();
	if (state !== P2_STATE.COUNTDOWN_DAY2 && state !== P2_STATE.COUNTDOWN) {
		return false;
	}
	const day = getCountdownDay();
	if (day < COUNTDOWN_DAYS) return false;
	const time = world.getTimeOfDay();
	return time >= 12000 && time <= 23000;
}

/**
 * @returns {boolean}
 */
function shouldDisobey() {
	if (world.getDynamicProperty(LOUD_DONE_PROP) !== true) return false;
	const day = getCountdownDay();
	const chance = Math.min(0.75, 0.15 + day * 0.18);
	return Math.random() < chance;
}

/**
 * @typedef {{ text?: string, intent?: string, animate?: boolean, voice?: string, voiceMouthFace?: number, delivered?: boolean }} Phase2Reply
 */

/**
 * @param {import("@minecraft/server").Player} player
 * @param {string} message
 * @param {import("@minecraft/server").Entity | undefined} ball
 * @returns {Phase2Reply | null}
 */
export function tryPhase2Chat(player, message, ball) {
	const phase = getVerityPhase();
	if (phase !== PHASE.TWO && phase !== PHASE.THREE) return null;

	const resolvedBall = ball?.isValid ? ball : findNearestBall(player);
	if (resolvedBall && isMusicPlaying(resolvedBall.id)) {
		stopBallMusic(resolvedBall);
	}

	const state = getPhase2State();

	if (
		phase === PHASE.TWO &&
		(state === P2_STATE.BORED ||
			state === P2_STATE.SMILING ||
			state === P2_STATE.ABNORMAL) &&
		hasTwoPhase2DaysElapsed() &&
		isSomethingToKnowTodayQuestion(message)
	) {
		announceSomethingComing(player, resolvedBall, {
			skipChat: true,
			markChatDone: true,
		});
		return {
			text: "Something is coming in 3 days.",
			intent: "story",
			animate: true,
		};
	}

	if (state === P2_STATE.BORED && phase === PHASE.TWO && asksAboutFace(message)) {
		clearBoredAutoSmileTimer();
		setPhase2State(P2_STATE.SMILING);
		applyPhase2ToAll();
		scheduleCreepySmileRelease();
		playVerityVoiceAt(
			player,
			VOICE.IM_SMILING,
			resolvedBall,
			FACE_CREEPY_SMILE,
		);
		sendVerityChat("I'm smiling now.");
		return { delivered: true, intent: "story" };
	}

	if (
		(state === P2_STATE.COUNTDOWN || state === P2_STATE.COUNTDOWN_DAY2) &&
		(isLookDifferentQuestion(message) || isDenialChallenge(message))
	) {
		world.setDynamicProperty(DENIAL_GIVEN_PROP, true);
		return {
			text: "I've always looked like this.",
			intent: "story",
			animate: true,
			voice: VOICE.ALWAYS_LOOKED,
		};
	}

	if (
		(state === P2_STATE.COUNTDOWN || state === P2_STATE.COUNTDOWN_DAY2) &&
		world.getDynamicProperty(DENIAL_GIVEN_PROP) === true &&
		world.getDynamicProperty(LOUD_DONE_PROP) !== true &&
		looksLikeQuestion(message) &&
		!isLookDifferentQuestion(message) &&
		!isDenialChallenge(message)
	) {
		const chats =
			(typeof world.getDynamicProperty(POST_DENIAL_CHATS_PROP) === "number"
				? /** @type {number} */ (world.getDynamicProperty(POST_DENIAL_CHATS_PROP))
				: 0) + 1;
		world.setDynamicProperty(POST_DENIAL_CHATS_PROP, chats);

		if (chats >= 2) {
			world.setDynamicProperty(LOUD_DONE_PROP, true);
			setPhase2State(P2_STATE.POST_LOUD);
			if (resolvedBall) {
				playBallSoundAt(resolvedBall, SOUND_LOUD, FACE_DAY2_OPEN);
			}
			system.runTimeout(() => applyPhase2ToAll(), 5);
		}

		return {
			text: pickLine("mumble"),
			intent: "story",
			animate: true,
		};
	}

	if (
		(state === P2_STATE.COUNTDOWN ||
			state === P2_STATE.COUNTDOWN_DAY2 ||
			state === P2_STATE.POST_LOUD) &&
		wantsDoorSound(message)
	) {
		if (shouldDisobey()) {
			return { text: pickLine("ignore"), intent: "story", animate: true };
		}
		if (resolvedBall) {
			const count = toggleNearbyDoors(resolvedBall);
			if (count > 0) {
				const lines = ["Done.", "There.", "All of them."];
				return {
					text: lines[Math.floor(Math.random() * lines.length)],
					intent: "sound",
					animate: false,
				};
			}
		}
		return { text: "No doors around.", intent: "story", animate: true };
	}

	const social = detectPhase2Social(message);
	if (social) {
		if (shouldDisobey() && social !== "greet") {
			return { text: pickLine("ignore"), intent: "social", animate: true };
		}
		return {
			text: pickLine(social),
			intent: "social",
			animate: true,
		};
	}

	if (
		state === P2_STATE.POST_LOUD &&
		looksLikeQuestion(message) &&
		!shouldDisobey()
	) {
		if (resolvedBall && Math.random() < 0.35) {
			playBallMusic(resolvedBall, MYGAL_SOUND, FACE_DAY2_OPEN, FACE_DAY2_SHUT);
		}
		return {
			text: pickLine("mumble"),
			intent: "story",
			animate: true,
		};
	}

	if (shouldDisobey() && looksLikeQuestion(message)) {
		return { text: pickLine("ignore"), intent: "story", animate: true };
	}

	return null;
}

/**
 * @param {import("@minecraft/server").Entity | undefined} ball
 * @param {string} text
 * @param {boolean} [animate]
 */
export function deliverPhase2Speech(ball, text, animate = true) {
	if (animate && ball?.isValid) {
		animateContextTalk(ball, text, getVerityPhase(), getPhase2State(), P2_STATE);
	}
}

function tickCountdownDawnAnnouncement() {
	const state = getPhase2State();
	if (state !== P2_STATE.COUNTDOWN && state !== P2_STATE.COUNTDOWN_DAY2) return;
	if (world.getDynamicProperty(COUNTDOWN_CHAT_DONE_PROP) === true) return;
	if (getCountdownDay() !== 1) return;

	const time = world.getTimeOfDay();
	if (time < 6000 || time > 7000) return;

	sendCountdownAnnouncementOnce();
}

function tickDawnWake() {
	const time = world.getTimeOfDay();
	if (time < 6000 || time > 7000) {
		dawnHandledAt = undefined;
		return;
	}
	const dayKey = Math.floor(world.getAbsoluteTime() / TICKS_PER_DAY);
	if (dawnHandledAt === dayKey) return;
	dawnHandledAt = dayKey;

	tickCountdownDawnAnnouncement();

	for (const player of world.getPlayers()) {
		if (!sleptThisCycle.has(player.id)) continue;
		sleptThisCycle.delete(player.id);
		onPlayerFinishedSleep(player);
	}
}

export function initVerityPhase2() {
	system.run(() => {
		bootstrapWorldOnce();
		validatePhaseProgression();
		syncAllBallFaces();
		logVerityProgressStatus();
		if (getVerityPhase() === PHASE.TWO && getPhase2State() === P2_STATE.BORED) {
			scheduleBoredAutoSmile();
		}
	});

	system.runInterval(() => {
		tickPhase2Scheduler();
		tickCountdownDays();
		tickDawnWake();
		for (const player of world.getPlayers()) {
			tickTrappedCheck(player);
			if (isHorrorArcPhase()) {
				try {
					applyPhase2PlayerInventory(player, false);
				} catch {
					/* ignore */
				}
			}
		}
	}, 20);

	const sleepEv = world.afterEvents.playerSleep;
	if (sleepEv) {
		sleepEv.subscribe((ev) => {
			if (!(ev.player instanceof Player)) return;
			sleptThisCycle.add(ev.player.id);
		});
	}

	const beforeSleep = world.beforeEvents.playerSleep;
	if (beforeSleep) {
		beforeSleep.subscribe((ev) => {
			if (!(ev.player instanceof Player)) return;
			if (!shouldBlockSleep()) return;
			ev.cancel = true;
			sendVerityChat("Verity is nearby. You cannot fall asleep.");
		});
	}

	console.warn(
		`verity progression: ready — phase ${getVerityPhase()} p2state ${getPhase2State()}`,
	);
}
