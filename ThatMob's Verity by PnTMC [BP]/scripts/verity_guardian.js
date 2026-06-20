import {
	BlockComponentTypes,
	BlockPermutation,
	Player,
	SignSide,
	system,
	world,
} from "@minecraft/server";
import { transferPlayer } from "@minecraft/server-admin";

const SOLO_LOCK_TICKS = 48000;
const TARGET_ID_PROP = "pntmc:verity_owner_id";
const TARGET_NAME_PROP = "pntmc:verity_owner_name";
const SOLO_LOCKED_PROP = "pntmc:verity_solo_locked";
const PEAK_PLAYERS_PROP = "pntmc:verity_peak_players";
const VERITYBALL_ID = "pntmc:verityball";
const FACE_CREEPY = 3;

const VOID_HOST = "127.0.0.1";
const VOID_PORT = 65534;
const INTRUDER_GRACE_TICKS = 60;
const TICKS_PER_DAY = 24000;
/** Intruder must be in-world ~1–2 MC days before guardian acts. */
const INTRUDER_MIN_PLAY_TICKS = TICKS_PER_DAY;
const INTRUDER_MAX_PLAY_TICKS = TICKS_PER_DAY * 2;
const RITUAL_APPROACH_RANGE = 3.5;
const RITUAL_FACE_DELAY = 30;
const RITUAL_KILL_DELAY = 50;

/** @type {Map<string, number>} */
const intruderSince = new Map();

/** @type {Map<string, number>} playerId -> world tick when guardian may act */
const intruderActivateAt = new Map();

/** @type {Set<string>} */
const ritualRunning = new Set();

/**
 * @param {{ x: number, y: number, z: number }} a
 * @param {{ x: number, y: number, z: number }} b
 */
function distance(a, b) {
	const dx = a.x - b.x;
	const dy = a.y - b.y;
	const dz = a.z - b.z;
	return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * @param {import("@minecraft/server").Player} player
 */
function tryTransferAway(player) {
	system.run(() => {
		try {
			transferPlayer(player, { hostname: VOID_HOST, port: VOID_PORT });
			return;
		} catch (err) {
			console.warn(`verity transferPlayer: ${err}`);
		}

		try {
			player.kill();
		} catch {
			/* ignore */
		}

		try {
			player.runCommand(`kick "${player.name}" Verity only allows the original player.`);
		} catch (err) {
			console.warn(`verity kick: ${err}`);
		}
	});
}

/**
 * @returns {boolean}
 */
function isSoloLocked() {
	return world.getDynamicProperty(SOLO_LOCKED_PROP) === true;
}

/**
 * @returns {string | undefined}
 */
function getTargetId() {
	const id = world.getDynamicProperty(TARGET_ID_PROP);
	return typeof id === "string" ? id : undefined;
}

/**
 * @returns {string}
 */
function getTargetName() {
	const name = world.getDynamicProperty(TARGET_NAME_PROP);
	return typeof name === "string" ? name : "My player";
}

/**
 * Người mở hộp = target duy nhất Verity thích.
 * @param {import("@minecraft/server").Player} player
 */
export function setVerityTarget(player) {
	if (getTargetId()) return;
	world.setDynamicProperty(TARGET_ID_PROP, player.id);
	world.setDynamicProperty(TARGET_NAME_PROP, player.name);
	world.setDynamicProperty(
		PEAK_PLAYERS_PROP,
		[...world.getPlayers()].length,
	);
	console.warn(`verity guardian: target set to ${player.name}`);
}

/**
 * @param {import("@minecraft/server").Player} player
 */
function trackPeakPlayers() {
	if (isSoloLocked() || !getTargetId()) return;

	const online = [...world.getPlayers()].length;
	const peak = world.getDynamicProperty(PEAK_PLAYERS_PROP);
	const prevPeak = typeof peak === "number" ? peak : 1;
	if (online > prevPeak) {
		world.setDynamicProperty(PEAK_PLAYERS_PROP, online);
	}

	if (world.getAbsoluteTime() >= SOLO_LOCK_TICKS) {
		const finalPeak = world.getDynamicProperty(PEAK_PLAYERS_PROP);
		const peakCount = typeof finalPeak === "number" ? finalPeak : online;
		if (peakCount <= 1) {
			world.setDynamicProperty(SOLO_LOCKED_PROP, true);
			console.warn("verity guardian: solo world locked after 2 days");
		}
	}
}

/**
 * @returns {boolean}
 */
function hasVerityBallInWorld() {
	for (const player of world.getPlayers()) {
		for (const ball of player.dimension.getEntities({ type: VERITYBALL_ID })) {
			if (ball.isValid) return true;
		}
	}
	return false;
}

/**
 * @param {import("@minecraft/server").Player} player
 * @returns {import("@minecraft/server").Entity | undefined}
 */
function findNearestBall(player) {
	let nearest;
	let best = Infinity;

	for (const ball of player.dimension.getEntities({ type: VERITYBALL_ID })) {
		if (!ball.isValid) continue;
		const d = distance(ball.location, player.location);
		if (d < best) {
			best = d;
			nearest = ball;
		}
	}

	return nearest;
}

function setBallMoving(ball, moving) {
	try {
		ball.setProperty("pntmc:moving", moving);
	} catch {
		/* ignore */
	}
}

/**
 * @param {import("@minecraft/server").Entity} ball
 * @param {{ x: number, y: number, z: number }} targetLoc
 */
function moveBallToward(ball, targetLoc) {
	const loc = ball.location;
	const dx = targetLoc.x - loc.x;
	const dy = targetLoc.y - loc.y;
	const dz = targetLoc.z - loc.z;
	const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
	const step = Math.min(0.75, len);

	setBallMoving(ball, true);
	ball.teleport({
		x: loc.x + (dx / len) * step,
		y: loc.y + (dy / len) * step,
		z: loc.z + (dz / len) * step,
	});
}

/**
 * @param {import("@minecraft/server").Player} player
 * @param {{ x: number, y: number, z: number }} lookAt
 */
function facePlayerAt(player, lookAt) {
	const loc = player.location;
	player.teleport(
		{ x: loc.x, y: loc.y, z: loc.z },
		{ facingLocation: lookAt, checkForBlocks: false },
	);
}

/**
 * @param {import("@minecraft/server").Entity} ball
 * @param {import("@minecraft/server").Player} intruder
 */
function getSignPos(ball, intruder) {
	const bx = Math.floor(ball.location.x);
	const by = Math.floor(ball.location.y) - 1;
	const bz = Math.floor(ball.location.z);
	const dx = intruder.location.x - ball.location.x;
	const dz = intruder.location.z - ball.location.z;

	let ox = 0;
	let oz = 0;
	if (Math.abs(dx) >= Math.abs(dz)) {
		ox = dx >= 0 ? 1 : -1;
	} else {
		oz = dz >= 0 ? 1 : -1;
	}

	return { x: bx + ox, y: by + 1, z: bz + oz };
}

/**
 * @param {import("@minecraft/server").Entity} ball
 * @param {import("@minecraft/server").Player} intruder
 */
function getSignDirection(ball, intruder) {
	const angle =
		(Math.atan2(
			intruder.location.x - ball.location.x,
			intruder.location.z - ball.location.z,
		) *
			180) /
		Math.PI;
	return Math.floor((((angle + 180) % 360) / 22.5) + 0.5) % 16;
}

const SIGN_BLOCK_IDS = [
	"minecraft:oak_standing_sign",
	"minecraft:standing_sign",
	"minecraft:oak_sign",
];

/**
 * @param {import("@minecraft/server").Block | undefined} block
 */
function isAirBlock(block) {
	if (!block) return false;
	const id = block.typeId;
	return id === "minecraft:air" || id === "minecraft:cave_air" || id === "minecraft:void_air";
}

/**
 * @param {import("@minecraft/server").Block} block
 * @param {string} front
 * @param {string} back
 */
function setClaimSignText(block, front, back) {
	let sign = block.getComponent(BlockComponentTypes.Sign);
	if (!sign) {
		try {
			sign = block.getComponent("minecraft:sign");
		} catch {
			return false;
		}
	}
	if (!sign) return false;

	try {
		sign.setText(front);
		sign.setText(back, SignSide.Back);
		sign.setWaxed(true);
		return true;
	} catch {
		return false;
	}
}

/**
 * @param {import("@minecraft/server").Dimension} dim
 * @param {{ x: number, y: number, z: number }} pos
 * @param {string} targetName
 * @param {number} direction
 */
function placeClaimSign(dim, pos, targetName, direction) {
	const support = dim.getBlock({ x: pos.x, y: pos.y - 1, z: pos.z });
	if (!support || support.typeId === "minecraft:air") return false;

	let block = dim.getBlock(pos);
	if (!block || !isAirBlock(block)) return false;

	const dir = ((direction % 16) + 16) % 16;
	const front = `${targetName} are mine.\nYou do not belong here.`;
	const back = `${targetName} is my only one.`;

	for (const typeId of SIGN_BLOCK_IDS) {
		try {
			block.setPermutation(
				BlockPermutation.resolve(typeId, {
					ground_sign_direction: dir,
				}),
			);
			block = dim.getBlock(pos);
			if (block && setClaimSignText(block, front, back)) return true;
		} catch {
			/* try next type */
		}
	}

	try {
		dim.runCommand(
			`setblock ${pos.x} ${pos.y} ${pos.z} oak_standing_sign ["ground_sign_direction"=${dir}] replace`,
		);
		block = dim.getBlock(pos);
		if (block && setClaimSignText(block, front, back)) return true;
	} catch (err) {
		console.warn(`verity sign setblock: ${err}`);
	}

	return false;
}

/**
 * @param {string} playerId
 */
function finishIntruder(playerId) {
	intruderSince.delete(playerId);
	intruderActivateAt.delete(playerId);
	ritualRunning.delete(playerId);
}

/**
 * @param {import("@minecraft/server").Player} player
 * @returns {boolean}
 */
function isIntruderPlaytimeReady(player) {
	let activateAt = intruderActivateAt.get(player.id);
	if (activateAt === undefined) {
		const span =
			INTRUDER_MIN_PLAY_TICKS +
			Math.floor(
				Math.random() *
					(INTRUDER_MAX_PLAY_TICKS - INTRUDER_MIN_PLAY_TICKS + 1),
			);
		activateAt = world.getAbsoluteTime() + span;
		intruderActivateAt.set(player.id, activateAt);
		const days = (span / TICKS_PER_DAY).toFixed(1);
		console.warn(
			`verity guardian: ${player.name} guardian starts in ~${days} MC day(s)`,
		);
	}

	if (world.getAbsoluteTime() < activateAt) return false;
	return true;
}

/**
 * @param {import("@minecraft/server").Player} player
 */
function runIntruderRitual(player) {
	const ball = findNearestBall(player);
	if (!ball?.isValid) {
		console.warn(`verity guardian: no ball, skipping ${player.name}`);
		finishIntruder(player.id);
		return;
	}

	try {
		ball.setProperty("pntmc:face_index", FACE_CREEPY);
	} catch {
		/* ignore */
	}

	/** @type {number | undefined} */
	let approachTimer;
	approachTimer = system.runInterval(() => {
		if (!player.isValid) {
			system.clearRun(approachTimer);
			finishIntruder(player.id);
			return;
		}

		if (!ball.isValid) {
			system.clearRun(approachTimer);
			console.warn(`verity guardian: ball gone, stopping ritual for ${player.name}`);
			finishIntruder(player.id);
			return;
		}

		const dist = distance(ball.location, player.location);
		if (dist > RITUAL_APPROACH_RANGE) {
			moveBallToward(ball, {
				x: player.location.x,
				y: player.location.y + 1.5,
				z: player.location.z,
			});
			return;
		}

		setBallMoving(ball, false);
		system.clearRun(approachTimer);
		facePlayerAt(player, ball.location);

		system.runTimeout(() => {
			if (!player.isValid) {
				finishIntruder(player.id);
				return;
			}

			const targetName = getTargetName();
			const signPos = getSignPos(ball, player);
			const direction = getSignDirection(ball, player);
			placeClaimSign(player.dimension, signPos, targetName, direction);

			system.runTimeout(() => {
				if (!player.isValid) {
					finishIntruder(player.id);
					return;
				}
				console.warn(`verity guardian: removing intruder ${player.name}`);
				tryTransferAway(player);
				finishIntruder(player.id);
			}, RITUAL_KILL_DELAY);
		}, RITUAL_FACE_DELAY);
	}, 4);
}

/**
 * @param {import("@minecraft/server").Player} player
 */
function handleIntruder(player) {
	const targetId = getTargetId();
	if (!targetId || player.id === targetId) return;

	if (!hasVerityBallInWorld()) {
		finishIntruder(player.id);
		return;
	}

	if (!isIntruderPlaytimeReady(player)) return;

	if (!intruderSince.has(player.id)) {
		intruderSince.set(player.id, system.currentTick);
		console.warn(`verity guardian: intruder ${player.name} flagged`);
		return;
	}

	if (ritualRunning.has(player.id)) return;

	const waited = system.currentTick - intruderSince.get(player.id);
	if (waited < INTRUDER_GRACE_TICKS) return;

	ritualRunning.add(player.id);
	runIntruderRitual(player);
}

/**
 * @param {import("@minecraft/server").Player} player
 */
function onPlayerActive(player) {
	if (!(player instanceof Player)) return;

	trackPeakPlayers();

	if (!isSoloLocked()) return;

	const targetId = getTargetId();
	if (!targetId || player.id === targetId) return;

	handleIntruder(player);
}

export function initVerityGuardian() {
	system.runInterval(() => {
		for (const player of world.getPlayers()) {
			onPlayerActive(player);
		}
	}, 20);

	const spawn = world.afterEvents.playerSpawn;
	if (spawn) {
		spawn.subscribe((ev) => {
			if (!ev.initialSpawn) return;
			system.run(() => onPlayerActive(ev.player));
		});
	}

	console.warn("verity guardian: active");
}
