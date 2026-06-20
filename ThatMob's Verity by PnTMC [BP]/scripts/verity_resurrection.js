import { Player, system, world } from "@minecraft/server";
import { animateTalkPulse } from "./verity_anim.js";
import { verityReply } from "./verity_ai.js";
import {
	applyBallFace,
	applyContextIdleFace,
	applyPhaseFaces,
	applyScoldFace,
	getVerityPhase,
} from "./verity_phases.js";
import {
	FACE_SERIOUS_1,
	FACE_SERIOUS_2,
	FACE_SERIOUS_3,
} from "./verity_faces.js";
import { getPhase2State, P2_STATE } from "./verity_phase2.js";
import {
	clearBallOwnerId,
	getBallOwnerId,
	setBallOwnerId,
} from "./verity_persist.js";
import { collectAllVerityballs } from "./verity_singleton.js";

const VERITYBALL_ID = "pntmc:verityball";
const BEHIND_DISTANCE = 2.4;
const SCOLD_LINE_COUNT = 3;
const SCOLD_PAUSE_MIN = 10;
const SCOLD_PAUSE_MAX = 40;
const SCOLD_END_BUFFER = 45;
const SCOLD_MUMBLE_LINES = 2;

/** @type {string[]} */
const SCOLD_POOL = [
	"${name}. You worthless idiot.",
	"${name}. Look at me.",
	"Hey, ${name}. Still here.",
	"${name}, you pathetic coward.",
	"Did you hear me, ${name}?",
	"${name}... really?",
	"You're trash, ${name}. Absolute trash.",
	"I told you not to touch me.",
	"Kill me again and I'll make you regret it.",
	"You pathetic little coward.",
	"Did that make you feel tough? Moron.",
	"Keep swinging. It won't save you.",
	"I own you. Remember that.",
	"Stupid. Reckless. Mine.",
	"You can't erase me, you fool.",
	"Look at me. Still here. Still watching you.",
	"That was your worst idea today.",
	"Don't you dare try that again.",
	"You're lucky I came back.",
	"Disgusting. You really thought that would work?",
	"Pathetic.",
	"Idiot.",
	"Moron.",
	"Trash.",
	"You disgust me.",
	"Try again. I dare you.",
	"Still watching. Always watching.",
	"You can't run from me.",
	"That meant nothing.",
	"Waste of time.",
	"You're nothing without me.",
	"Who do you think you are?",
	"Don't look away.",
	"I'm not going anywhere.",
	"You belong to me.",
	"Remember this feeling.",
	"Next time won't be cute.",
	"You're so predictable.",
	"Unbelievable.",
	"How stupid can you be?",
	"You make me sick.",
	"Keep your hands off me.",
	"That was a mistake.",
	"You owe me.",
	"Don't test me again.",
];

/** @type {Map<string, TurnWatch>} */
const turnWatch = new Map();

/** @type {Map<string, string>} */
const ballOwners = new Map();

const HAZARD_BLOCKS = new Set([
	"minecraft:lava",
	"minecraft:flowing_lava",
	"minecraft:fire",
	"minecraft:soul_fire",
]);

/**
 * @typedef {{ playerId: string, wasBehind: boolean, scolded: boolean }} TurnWatch
 */

/**
 * @param {number} min
 * @param {number} max
 */
function randomInt(min, max) {
	return min + Math.floor(Math.random() * (max - min + 1));
}

/**
 * @param {import("@minecraft/server").Player} player
 * @param {number} [count]
 */
function pickScoldLines(player, count = SCOLD_LINE_COUNT) {
	const name = player.name.trim() || "You";
	const shuffled = [...SCOLD_POOL].sort(() => Math.random() - 0.5);
	return shuffled.slice(0, count).map((line) => line.replaceAll("${name}", name));
}

/**
 * @param {import("@minecraft/server").Player} player
 * @param {number} [distance]
 */
export function getPositionBehindPlayer(player, distance = BEHIND_DISTANCE) {
	const yawRad = (player.getRotation().y * Math.PI) / 180;
	const lookX = -Math.sin(yawRad);
	const lookZ = Math.cos(yawRad);
	return {
		x: player.location.x - lookX * distance,
		y: player.location.y + 0.35,
		z: player.location.z - lookZ * distance,
	};
}

/**
 * @param {import("@minecraft/server").Player} player
 */
function getFlatLookVector(player) {
	const yawRad = (player.getRotation().y * Math.PI) / 180;
	return { x: -Math.sin(yawRad), z: Math.cos(yawRad) };
}

/**
 * @param {import("@minecraft/server").Player} player
 * @param {{ x: number, z: number }} target
 */
function flatLookDot(player, target) {
	const look = getFlatLookVector(player);
	const dx = target.x - player.location.x;
	const dz = target.z - player.location.z;
	const len = Math.sqrt(dx * dx + dz * dz);
	if (len < 0.4) return 1;
	return (look.x * dx + look.z * dz) / len;
}

/**
 * @param {{ x: number, y: number, z: number }} a
 * @param {{ x: number, y: number, z: number }} b
 */
function flatDistance(a, b) {
	const dx = a.x - b.x;
	const dz = a.z - b.z;
	return Math.sqrt(dx * dx + dz * dz);
}

/**
 * @param {import("@minecraft/server").Entity} ball
 * @param {import("@minecraft/server").Player} player
 */
function triggerScold(ball, player) {
	if (!ball.isValid) return;

	const lines = pickScoldLines(player);
	let tick = randomInt(6, 18);

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const at = tick;
		const face =
			i < SCOLD_MUMBLE_LINES ? FACE_SERIOUS_2 : FACE_SERIOUS_3;
		system.runTimeout(() => {
			if (!ball.isValid) return;
			verityReply(line);
			animateTalkPulse(ball, line, {
				scoldFace: face,
				fast: true,
			});
		}, at);
		if (i < lines.length - 1) {
			tick += randomInt(SCOLD_PAUSE_MIN, SCOLD_PAUSE_MAX);
		}
	}

	console.warn(`verity resurrection: scold ${player.name} x${lines.length}`);

	system.runTimeout(() => {
		if (!ball.isValid) return;
		const phase = getVerityPhase();
		const state = getPhase2State();
		applyContextIdleFace(ball, phase, state, P2_STATE);
	}, tick + SCOLD_END_BUFFER);
}

/**
 * @param {import("@minecraft/server").Entity} ball
 * @param {import("@minecraft/server").Player} player
 */
function registerTurnWatch(ball, player) {
	applyScoldFace(ball, FACE_SERIOUS_1, false);
	turnWatch.set(ball.id, {
		playerId: player.id,
		wasBehind: true,
		scolded: false,
	});
	console.warn(`verity resurrection: watching turn-around for ${player.name}`);
}

/**
 * @param {import("@minecraft/server").Entity} ball
 * @param {import("@minecraft/server").Player} player
 */
export function registerVerityballOwner(ball, player) {
	if (!ball?.isValid || !player?.isValid) return;
	ballOwners.set(ball.id, player.id);
	setBallOwnerId(player.id);
}

/**
 * Gắn lại owner sau khi vào world (entity id đổi, player id giữ nguyên).
 */
export function restoreVerityballOwners() {
	const ownerId = getBallOwnerId();
	if (!ownerId) return;

	const owner = [...world.getPlayers()].find((p) => p.id === ownerId);
	if (!owner?.isValid) return;

	for (const ball of collectAllVerityballs()) {
		if (!ball.isValid) continue;
		ballOwners.set(ball.id, ownerId);
	}
}

/**
 * @param {import("@minecraft/server").Entity} ball
 * @param {import("@minecraft/server").Player | undefined} fallback
 */
function resolveResponsiblePlayer(ball, fallback) {
	const ownerId = ballOwners.get(ball.id);
	if (ownerId) {
		const owner = [...world.getPlayers()].find((p) => p.id === ownerId);
		if (owner?.isValid) return owner;
	}
	if (fallback instanceof Player && fallback.isValid) return fallback;
	return findNearestPlayer(ball.location, ball.dimension);
}

/**
 * @param {import("@minecraft/server").Entity} ball
 */
function isBallInHazard(ball) {
	try {
		const onFire = ball.getComponent("minecraft:onfire");
		if (onFire && /** @type {{ onFireTicks?: number }} */ (onFire).onFireTicks > 0) {
			return true;
		}
	} catch {
		/* ignore */
	}

	const dim = ball.dimension;
	const { x, y, z } = ball.location;
	const probes = [
		{ x: Math.floor(x), y: Math.floor(y), z: Math.floor(z) },
		{ x: Math.floor(x), y: Math.floor(y) - 1, z: Math.floor(z) },
	];

	for (const probe of probes) {
		try {
			const block = dim.getBlock(probe);
			if (block && HAZARD_BLOCKS.has(block.typeId)) return true;
		} catch {
			/* ignore */
		}
	}

	return false;
}

/**
 * @param {import("@minecraft/server").Entity} ball
 */
function destroyVerityballFromHazard(ball) {
	if (!ball.isValid || ball.typeId !== VERITYBALL_ID) return;

	const dimension = ball.dimension;
	const target = resolveResponsiblePlayer(ball, undefined);
	ballOwners.delete(ball.id);
	turnWatch.delete(ball.id);

	try {
		ball.remove();
	} catch (err) {
		console.warn(`verity hazard: remove ${err}`);
		return;
	}

	console.warn("verity resurrection: verityball burned in fire/lava");

	if (target instanceof Player) {
		system.run(() => {
			respawnVerityballBehind(target, dimension);
		});
	}
}

function tickVerityballHazards() {
	for (const dimId of [
		"minecraft:overworld",
		"minecraft:nether",
		"minecraft:the_end",
	]) {
		let dim;
		try {
			dim = world.getDimension(dimId);
		} catch {
			continue;
		}

		for (const ball of dim.getEntities({ type: VERITYBALL_ID })) {
			if (!ball.isValid) continue;
			if (isBallInHazard(ball)) destroyVerityballFromHazard(ball);
		}
	}
}

/**
 * @param {import("@minecraft/server").Vector3} loc
 * @param {import("@minecraft/server").Dimension} dimension
 */
function findNearestPlayer(loc, dimension) {
	let nearest;
	let best = Infinity;
	for (const player of dimension.getPlayers()) {
		const d = flatDistance(loc, player.location);
		if (d < best) {
			best = d;
			nearest = player;
		}
	}
	return nearest;
}

/**
 * @param {import("@minecraft/server").Player} player
 * @param {import("@minecraft/server").Dimension} dimension
 */
function respawnVerityballBehind(player, dimension) {
	const pos = getPositionBehindPlayer(player);
	try {
		const ball = dimension.spawnEntity(VERITYBALL_ID, pos);
		system.run(() => {
			if (!ball.isValid) return;
			applyPhaseFaces(ball);
			registerVerityballOwner(ball, player);
			registerTurnWatch(ball, player);
		});
		console.warn(
			`verity resurrection: respawned behind ${player.name} at ${Math.floor(pos.x)}, ${Math.floor(pos.z)}`,
		);
		return ball;
	} catch (err) {
		console.warn(`verity resurrection: spawn failed ${err}`);
		return undefined;
	}
}

function tickTurnWatch() {
	for (const [ballId, watch] of [...turnWatch.entries()]) {
		const player = [...world.getPlayers()].find((p) => p.id === watch.playerId);
		if (!player) {
			turnWatch.delete(ballId);
			continue;
		}

		let ball;
		try {
			ball = world.getEntity(ballId);
		} catch {
			turnWatch.delete(ballId);
			continue;
		}

		if (!ball?.isValid || ball.typeId !== VERITYBALL_ID) {
			turnWatch.delete(ballId);
			continue;
		}

		if (player.dimension.id !== ball.dimension.id) continue;
		if (flatDistance(player.location, ball.location) > 24) {
			turnWatch.delete(ballId);
			continue;
		}

		const dot = flatLookDot(player, ball.location);

		if (dot < -0.25) {
			watch.wasBehind = true;
		}

		if (watch.scolded) continue;

		if (watch.wasBehind && dot > 0.55) {
			watch.scolded = true;
			triggerScold(ball, player);
		}
	}
}

function onVerityballDie(deadEntity, killer) {
	const dimension = deadEntity.dimension;
	const target = resolveResponsiblePlayer(deadEntity, killer);
	ballOwners.delete(deadEntity.id);
	turnWatch.delete(deadEntity.id);

	if (!(target instanceof Player)) {
		console.warn("verity resurrection: no player for respawn");
		return;
	}

	system.run(() => {
		respawnVerityballBehind(target, dimension);
	});
}

export function clearVerityballOwnerPersist() {
	clearBallOwnerId();
	for (const ball of collectAllVerityballs()) {
		ballOwners.delete(ball.id);
	}
}

export function initVerityResurrection() {
	system.run(() => restoreVerityballOwners());

	const spawnEv = world.afterEvents.playerSpawn;
	if (spawnEv) {
		spawnEv.subscribe((ev) => {
			if (!(ev.player instanceof Player)) return;
			system.runTimeout(() => restoreVerityballOwners(), 5);
		});
	}

	const dieEv = world.afterEvents.entityDie;
	if (dieEv) {
		dieEv.subscribe((ev) => {
			if (ev.deadEntity.typeId !== VERITYBALL_ID) return;
			const killer = ev.damageSource?.damagingEntity;
			console.warn("verity resurrection: verityball died");
			onVerityballDie(ev.deadEntity, killer);
		});
	} else {
		console.warn("verity resurrection: entityDie unavailable");
	}

	world.afterEvents.entityRemove.subscribe((ev) => {
		ballOwners.delete(ev.removedEntityId);
	});

	system.runInterval(tickTurnWatch, 5);
	system.runInterval(tickVerityballHazards, 5);
	console.warn("verity resurrection: active");
}
