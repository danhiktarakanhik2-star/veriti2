/** Face 1 — phase 1 idle */
export const FACE_SMILE = 0;
/** Face 2 — open mouth */
export const FACE_SPEAK = 1;
/** Face 3 — hurt (fall only) */
export const FACE_HURT = 2;
/** @deprecated use FACE_HURT */
export const FACE_WINK = FACE_HURT;
/** Face 4 — abnormal shut */
export const FACE_ABNORMAL_SHUT = 3;
/** Face 5 — abnormal open */
export const FACE_ABNORMAL_OPEN = 4;
/** @deprecated */
export const FACE_CREEPY = FACE_ABNORMAL_SHUT;
/** @deprecated */
export const FACE_GRIN = FACE_ABNORMAL_OPEN;
/** Face 6 — bored (phase 2) */
export const FACE_BORED_P2 = 5;
/** @deprecated */
export const FACE_BORED = FACE_BORED_P2;
/** Face 7 — countdown day 2 shut */
export const FACE_DAY2_SHUT = 6;
/** Face 8 — countdown day 2 open */
export const FACE_DAY2_OPEN = 7;
/** @deprecated */
export const FACE_HUNGRY_SHUT = FACE_DAY2_SHUT;
/** @deprecated */
export const FACE_HUNGRY_OPEN = FACE_DAY2_OPEN;
/** creepysmile */
export const FACE_CREEPY_SMILE = 8;
/** scold shut */
export const FACE_SERIOUS_1 = 9;
/** scold mumble */
export const FACE_SERIOUS_2 = 10;
/** scold angry */
export const FACE_SERIOUS_3 = 11;

export const CREEPY_SMILE_HOLD_MIN = 3000;
export const CREEPY_SMILE_HOLD_MAX = 4000;

/**
 * @param {number} phase
 * @param {number} p2State
 * @param {{ ABNORMAL: number, SMILING: number, COUNTDOWN: number, COUNTDOWN_DAY2: number, POST_LOUD: number }} P2
 * @returns {[number, number]}
 */
export function getTalkFacePairFor(phase, p2State, P2) {
	if (phase === 1) {
		return [FACE_SMILE, FACE_SPEAK];
	}

	if (phase === 2) {
		if (
			p2State === P2.ABNORMAL ||
			p2State === P2.SMILING ||
			p2State === P2.COUNTDOWN
		) {
			return [FACE_ABNORMAL_SHUT, FACE_ABNORMAL_OPEN];
		}
		return [FACE_SMILE, FACE_SPEAK];
	}

	if (phase === 3) {
		if (p2State === P2.COUNTDOWN_DAY2 || p2State === P2.POST_LOUD) {
			return [FACE_DAY2_SHUT, FACE_DAY2_OPEN];
		}
		return [FACE_ABNORMAL_SHUT, FACE_ABNORMAL_OPEN];
	}

	return [FACE_SMILE, FACE_SPEAK];
}

/**
 * @param {number} phase
 * @param {number} p2State
 * @param {{ SMILING: number, ABNORMAL: number, COUNTDOWN: number, COUNTDOWN_DAY2: number, POST_LOUD: number }} P2
 * @returns {number}
 */
export function getIdleFaceFor(phase, p2State, P2) {
	if (phase === 1) return FACE_SMILE;
	if (phase === 2) {
		if (p2State === P2.SMILING) return FACE_CREEPY_SMILE;
		if (p2State === P2.ABNORMAL || p2State === P2.COUNTDOWN) {
			return FACE_ABNORMAL_SHUT;
		}
		return FACE_BORED_P2;
	}
	if (phase === 3) {
		if (p2State === P2.COUNTDOWN_DAY2 || p2State === P2.POST_LOUD) {
			return FACE_DAY2_SHUT;
		}
		return FACE_ABNORMAL_SHUT;
	}
	if (phase === 4) return FACE_ABNORMAL_SHUT;
	return FACE_SMILE;
}

/** @type {Record<number, number>} */
const OPEN_TO_SHUT_FACE = {
	[FACE_SPEAK]: FACE_SMILE,
	[FACE_ABNORMAL_OPEN]: FACE_ABNORMAL_SHUT,
	[FACE_DAY2_OPEN]: FACE_DAY2_SHUT,
	[FACE_CREEPY_SMILE]: FACE_CREEPY_SMILE,
	[FACE_SERIOUS_2]: FACE_SERIOUS_2,
	[FACE_SERIOUS_3]: FACE_SERIOUS_3,
};

/**
 * @param {number} openFace
 * @returns {number}
 */
export function getShutFaceForOpen(openFace) {
	return OPEN_TO_SHUT_FACE[openFace] ?? FACE_SMILE;
}

/**
 * @returns {number}
 */
export function randomCreepySmileHoldTicks() {
	return (
		CREEPY_SMILE_HOLD_MIN +
		Math.floor(Math.random() * (CREEPY_SMILE_HOLD_MAX - CREEPY_SMILE_HOLD_MIN + 1))
	);
}
