import { system } from "@minecraft/server";
import { MYGAL_NORMAL_SOUND } from "./verity_intent.js";
import { getSoundDurationTicks } from "./verity_sound_durations.js";
import { applyBallFace, FACE_SMILE, FACE_SPEAK } from "./verity_phases.js";

/** 02:14 */
export const MYGAL_DURATION_TICKS = 134 * 20;

/** @type {Map<string, number>} ballId -> clearRun id */
const musicTimers = new Map();

/** @type {Map<string, number>} ballId -> mouth release timer */
const mouthTimers = new Map();

/** @type {Set<string>} */
const musicPlaying = new Set();

/** @type {Map<string, { soundId: string, releaseFace: number }>} */
const musicSessions = new Map();

/**
 * @param {string | undefined} ballId
 */
export function isMusicPlaying(ballId) {
	if (!ballId) return musicPlaying.size > 0;
	return musicPlaying.has(ballId);
}

/**
 * @param {import("@minecraft/server").Entity} ball
 * @param {string} soundId
 */
function stopSoundForAll(ball, soundId) {
	if (!ball?.isValid) return;
	for (const player of ball.dimension.getPlayers()) {
		try {
			player.runCommand(`stopsound @s ${soundId}`);
		} catch (err) {
			console.warn(`verity stopsound ${soundId}: ${err}`);
		}
	}
}

/**
 * @param {string} ballId
 */
function clearMouthTimer(ballId) {
	const timer = mouthTimers.get(ballId);
	if (timer === undefined) return;
	system.clearRun(timer);
	mouthTimers.delete(ballId);
}

/**
 * @param {import("@minecraft/server").Entity} ball
 * @param {number} mouthFace
 * @param {number} holdTicks
 * @param {() => void} [onRelease]
 * @param {number} [releaseFace] closed-mouth face when hold ends
 */
export function holdMouthFace(ball, mouthFace, holdTicks, onRelease, releaseFace) {
	if (!ball?.isValid) return;
	clearMouthTimer(ball.id);
	applyBallFace(ball, mouthFace, true);
	const timer = system.runTimeout(() => {
		mouthTimers.delete(ball.id);
		if (!ball.isValid) return;
		applyBallFace(ball, releaseFace ?? mouthFace, false);
		onRelease?.();
	}, holdTicks);
	mouthTimers.set(ball.id, timer);
}

/**
 * @param {import("@minecraft/server").Entity | string} ballOrId
 */
export function stopBallMusic(ballOrId) {
	const ballId = typeof ballOrId === "string" ? ballOrId : ballOrId?.id;
	if (!ballId) return;

	const ball = typeof ballOrId === "object" ? ballOrId : undefined;
	const session = musicSessions.get(ballId);

	const timer = musicTimers.get(ballId);
	if (timer !== undefined) {
		system.clearRun(timer);
		musicTimers.delete(ballId);
	}
	musicPlaying.delete(ballId);
	musicSessions.delete(ballId);

	if (!ball?.isValid) return;

	if (session) {
		stopSoundForAll(ball, session.soundId);
	}
	clearMouthTimer(ballId);
	applyBallFace(ball, session?.releaseFace ?? FACE_SMILE, false);
}

/**
 * @param {import("@minecraft/server").Entity} ball
 * @param {string} [soundId]
 * @param {number} [faceWhilePlaying]
 * @returns {boolean}
 */
export function playBallMusic(
	ball,
	soundId = MYGAL_NORMAL_SOUND,
	faceWhilePlaying = FACE_SPEAK,
	releaseFace = FACE_SMILE,
) {
	if (!ball?.isValid) return false;

	stopBallMusic(ball);
	stopSoundForAll(ball, soundId);

	const loc = ball.location;
	let played = false;

	try {
		for (const player of ball.dimension.getPlayers()) {
			player.playSound(soundId, { location: loc, volume: 1, pitch: 1 });
		}
		played = true;
	} catch (err) {
		console.warn(`verity music ${soundId}: ${err}`);
	}

	if (!played) {
		try {
			const { x, y, z } = loc;
			ball.runCommand(
				`playsound ${soundId} @a ${x.toFixed(2)} ${y.toFixed(2)} ${z.toFixed(2)} 1 1`,
			);
			played = true;
		} catch (cmdErr) {
			console.warn(`verity playsound ${soundId}: ${cmdErr}`);
		}
	}

	if (!played) return false;

	musicPlaying.add(ball.id);
	musicSessions.set(ball.id, { soundId, releaseFace });
	holdMouthFace(ball, faceWhilePlaying, MYGAL_DURATION_TICKS, () => {
		musicSessions.delete(ball.id);
	}, releaseFace);

	const timer = system.runTimeout(() => {
		musicTimers.delete(ball.id);
		musicPlaying.delete(ball.id);
		musicSessions.delete(ball.id);
	}, MYGAL_DURATION_TICKS);
	musicTimers.set(ball.id, timer);
	return true;
}

/**
 * @param {import("@minecraft/server").Entity} ball
 * @param {string} soundId
 * @param {number} [mouthFace]
 * @param {number} [durationTicks]
 */
export function playBallSoundAt(
	ball,
	soundId,
	mouthFace = FACE_SPEAK,
	durationTicks = getSoundDurationTicks(soundId),
	releaseFace = FACE_SMILE,
) {
	if (!ball?.isValid) return false;
	const loc = ball.location;
	let played = false;

	try {
		for (const player of ball.dimension.getPlayers()) {
			player.playSound(soundId, { location: loc, volume: 1, pitch: 1 });
		}
		played = true;
	} catch (err) {
		console.warn(`verity sound ${soundId}: ${err}`);
	}

	if (!played) {
		try {
			const { x, y, z } = loc;
			ball.runCommand(
				`playsound ${soundId} @a ${x.toFixed(2)} ${y.toFixed(2)} ${z.toFixed(2)} 1 1`,
			);
			played = true;
		} catch (cmdErr) {
			console.warn(`verity playsound ${soundId}: ${cmdErr}`);
		}
	}

	if (played) {
		holdMouthFace(ball, mouthFace, durationTicks, undefined, releaseFace);
	}
	return played;
}

/**
 * @param {import("@minecraft/server").Player} player
 * @param {import("@minecraft/server").Vector3} loc
 * @param {string} soundId
 */
export function playSoundAtLoc(player, loc, soundId) {
	try {
		for (const p of player.dimension.getPlayers()) {
			p.playSound(soundId, { location: loc, volume: 1, pitch: 1 });
		}
		return true;
	} catch (err) {
		console.warn(`verity sound ${soundId}: ${err}`);
		try {
			const { x, y, z } = loc;
			player.runCommand(
				`playsound ${soundId} @a ${x.toFixed(2)} ${y.toFixed(2)} ${z.toFixed(2)} 1 1`,
			);
			return true;
		} catch (cmdErr) {
			console.warn(`verity playsound ${soundId}: ${cmdErr}`);
			return false;
		}
	}
}
