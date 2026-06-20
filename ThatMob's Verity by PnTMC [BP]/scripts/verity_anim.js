import { system } from "@minecraft/server";
import { applyBallFace, applyScoldFace } from "./verity_phases.js";
import { FACE_SPEAK, getTalkFacePairFor } from "./verity_faces.js";
import { holdMouthFace } from "./verity_music.js";

/**
 * @param {string} text
 * @param {boolean} [fast]
 */
function talkHoldTicks(text, fast = false) {
	const trimmed = text.trim();
	if (!trimmed) return 0;
	const units = Math.min(trimmed.length, fast ? 48 : 72);
	const step = fast ? 2 : 4;
	return units * step + 12;
}

/**
 * @param {import("@minecraft/server").Entity | undefined} ball
 * @param {string} text
 * @param {{ faces?: [number, number], fast?: boolean, scoldFace?: number }} [options]
 */
export function animateTalkPulse(ball, text, options = {}) {
	if (!ball?.isValid) return;
	const trimmed = text.trim();
	if (!trimmed) return;

	const holdTicks = talkHoldTicks(trimmed, options.fast);
	if (holdTicks <= 0) return;

	if (options.scoldFace !== undefined) {
		applyScoldFace(ball, options.scoldFace, true);
		system.runTimeout(() => {
			if (!ball.isValid) return;
			applyScoldFace(ball, options.scoldFace, false);
		}, holdTicks);
		return;
	}

	const [mouthShut, mouthOpen] = options.faces ?? [FACE_SPEAK, FACE_SPEAK];
	holdMouthFace(ball, mouthOpen, holdTicks, undefined, mouthShut);
}

/**
 * @param {number} phase
 * @param {number} p2State
 * @param {object} P2
 * @param {import("@minecraft/server").Entity | undefined} ball
 * @param {string} text
 * @param {boolean} [fast]
 */
export function animateContextTalk(ball, text, phase, p2State, P2, fast = false) {
	if (!ball?.isValid) return;
	const pair = getTalkFacePairFor(phase, p2State, P2);
	animateTalkPulse(ball, text, { faces: pair, fast });
}

/**
 * @param {import("@minecraft/server").Entity | undefined} ball
 * @param {number} faceIndex
 * @param {number} [holdTicks]
 * @param {number} [releaseFace]
 */
export function flashMouthFace(
	ball,
	faceIndex = FACE_SPEAK,
	holdTicks = 20,
	releaseFace = faceIndex,
) {
	if (!ball?.isValid) return;
	holdMouthFace(ball, faceIndex, holdTicks, undefined, releaseFace);
}
