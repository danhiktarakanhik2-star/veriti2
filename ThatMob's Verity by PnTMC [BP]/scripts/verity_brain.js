import { tryBrainKnowledge } from "./verity_knowledge.js";

/**
 * @param {import("@minecraft/server").Player} _player
 * @param {string} message
 * @param {number} [_phase]
 * @returns {Promise<string | null>}
 */
export async function tryBrainAnswer(_player, message, _phase = 1) {
	return tryBrainKnowledge(message);
}
