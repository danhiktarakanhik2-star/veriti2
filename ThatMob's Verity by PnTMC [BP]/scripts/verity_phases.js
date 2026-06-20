import { system, world } from "@minecraft/server";
import {
	FACE_ABNORMAL_OPEN,
	FACE_ABNORMAL_SHUT,
	FACE_BORED_P2,
	FACE_CREEPY_SMILE,
	FACE_DAY2_OPEN,
	FACE_DAY2_SHUT,
	FACE_SERIOUS_1,
	FACE_SERIOUS_2,
	FACE_SERIOUS_3,
	FACE_SMILE,
	FACE_SPEAK,
	getIdleFaceFor,
	getTalkFacePairFor,
} from "./verity_faces.js";

export const PHASE = {
	ONE: 1,
	TWO: 2,
	THREE: 3,
	FOUR: 4,
};

export {
	FACE_ABNORMAL_OPEN,
	FACE_ABNORMAL_SHUT,
	FACE_BORED,
	FACE_BORED_P2,
	FACE_CREEPY,
	FACE_CREEPY_SMILE,
	FACE_DAY2_OPEN,
	FACE_DAY2_SHUT,
	FACE_GRIN,
	FACE_HURT,
	FACE_HUNGRY_OPEN,
	FACE_HUNGRY_SHUT,
	FACE_SERIOUS_1,
	FACE_SERIOUS_2,
	FACE_SERIOUS_3,
	FACE_SMILE,
	FACE_SPEAK,
	FACE_WINK,
} from "./verity_faces.js";

const PHASE_PROP = "pntmc:verity_phase";

/**
 * @returns {number}
 */
export function getVerityPhase() {
	const phase = world.getDynamicProperty(PHASE_PROP);
	if (
		phase === PHASE.ONE ||
		phase === PHASE.TWO ||
		phase === PHASE.THREE ||
		phase === PHASE.FOUR
	) {
		return phase;
	}
	return PHASE.ONE;
}

/**
 * @param {number} phase
 */
export function setVerityPhase(phase) {
	world.setDynamicProperty(PHASE_PROP, phase);
}

/** Phase 2–4: horror arc (ball faces + phase2 runtime). */
export function isHorrorArcPhase() {
	const phase = getVerityPhase();
	return phase >= PHASE.TWO && phase <= PHASE.FOUR;
}

/**
 * @param {import("@minecraft/server").Entity} ball
 * @param {number} faceIndex
 * @param {boolean} talking
 */
export function applyBallFace(ball, faceIndex, talking = false) {
	if (!ball.isValid) return;
	try {
		ball.setProperty("pntmc:face_index", faceIndex);
		ball.setProperty("pntmc:talking", talking);
		ball.setProperty("pntmc:scolding", false);
	} catch (err) {
		console.warn(`verity phase face ${faceIndex}: ${err}`);
	}
}

/**
 * @param {import("@minecraft/server").Entity} ball
 * @param {number} faceIndex
 * @param {boolean} [talking]
 */
export function applyScoldFace(ball, faceIndex, talking = false) {
	if (!ball.isValid) return;
	try {
		ball.setProperty("pntmc:face_index", faceIndex);
		ball.setProperty("pntmc:talking", talking);
		ball.setProperty("pntmc:scolding", true);
	} catch (err) {
		console.warn(`verity scold face ${faceIndex}: ${err}`);
	}
}

/**
 * @param {number} phase
 * @param {number} p2State
 * @param {object} P2
 * @returns {[number, number]}
 */
export function getTalkFacePair(phase, p2State, P2) {
	return getTalkFacePairFor(phase, p2State, P2);
}

/**
 * @param {import("@minecraft/server").Entity} ball
 * @param {number} phase
 * @param {number} p2State
 * @param {object} P2
 */
export function applyContextIdleFace(ball, phase, p2State, P2) {
	applyBallFace(ball, getIdleFaceFor(phase, p2State, P2), false);
}

/**
 * @param {import("@minecraft/server").Entity} ball
 */
export function applyPhaseFaces(ball) {
	if (!ball.isValid) return;
	const phase = getVerityPhase();
	switch (phase) {
		case PHASE.ONE:
			applyBallFace(ball, FACE_SMILE, false);
			break;
		case PHASE.TWO:
			applyBallFace(ball, FACE_BORED_P2, false);
			break;
		case PHASE.THREE:
			applyBallFace(ball, FACE_ABNORMAL_SHUT, false);
			break;
		case PHASE.FOUR:
			applyBallFace(ball, FACE_ABNORMAL_SHUT, false);
			break;
		default:
			applyBallFace(ball, FACE_SMILE, false);
	}
}

/**
 * @param {import("@minecraft/server").Entity} ball
 * @param {string} text
 * @param {[number, number]} talkPair
 */
export function animateGroundSpeech(ball, text, talkPair = [FACE_SMILE, FACE_SPEAK]) {
	if (!ball.isValid || getVerityPhase() !== PHASE.ONE) return;

	const trimmed = text.trim();
	if (!trimmed) return;

	const [shut, open] = talkPair;
	const units = Math.min(trimmed.length, 80);
	const holdTicks = units * 4 + 12;

	applyBallFace(ball, open, true);
	system.runTimeout(() => {
		if (!ball.isValid || getVerityPhase() !== PHASE.ONE) return;
		applyBallFace(ball, shut, false);
	}, holdTicks);
}

/**
 * @param {import("@minecraft/server").Entity} ball
 * @param {[number, number]} talkPair
 */
export function pulsePhaseTalkFace(ball, talkPair) {
	if (!ball.isValid) return;
	const [shut, open] = talkPair;
	applyBallFace(ball, open, true);
	system.runTimeout(() => {
		if (!ball.isValid) return;
		applyBallFace(ball, shut, false);
	}, 50);
}

/**
 * @param {number} phase
 */
export function enterVerityPhase(phase) {
	setVerityPhase(phase);
}
