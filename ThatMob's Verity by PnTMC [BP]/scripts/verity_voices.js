import { holdMouthFace, playBallSoundAt, playSoundAtLoc } from "./verity_music.js";
import { getSoundDurationTicks } from "./verity_sound_durations.js";
import { FACE_SPEAK } from "./verity_phases.js";
import { getShutFaceForOpen } from "./verity_faces.js";

export const VOICE = {
	YES_SOUTH: "pntmc.verity.yes_south",
	VILLAGERS_GONE: "pntmc.verity.villagers_gone",
	GONE: "pntmc.verity.gone",
	SOMETHING_PASSED: "pntmc.verity.something_passed",
	NO: "pntmc.verity.no2",
	SOMETHING_HUNGRY: "pntmc.verity.something_hungry",
	IM_SMILING: "pntmc.verity.im_smiling_now",
	ALWAYS_LOOKED: "pntmc.verity.always_looked_like_this",
	ITS_ALREADY_OVER: "pntmc.verity.its_already_over",
	YOU_ARE_MINE: "pntmc.verity.you_are_mine",
	KNOW_EVERYTHING: "pntmc.verity.know_everything",
};

export const FALLBACK_CHAT =
	"You can ask me anything. I know everything.";

/**
 * @param {import("@minecraft/server").Entity | undefined} ball
 * @param {string} soundId
 */
export function playVerityVoice(ball, soundId) {
	if (!ball?.isValid || !soundId) return;
	const duration = getSoundDurationTicks(soundId);
	const played = playBallSoundAt(
		ball,
		soundId,
		FACE_SPEAK,
		duration,
		getShutFaceForOpen(FACE_SPEAK),
	);
	if (played !== false) {
		console.warn(`verity voice ball: ${soundId}`);
	}
}

/**
 * Voice at the ball when it exists; otherwise at the player.
 * @param {import("@minecraft/server").Player} player
 * @param {string} soundId
 * @param {import("@minecraft/server").Entity | undefined} ball
 * @param {number} [mouthFace]
 */
export function playVerityVoiceAt(player, soundId, ball, mouthFace = FACE_SPEAK) {
	if (!soundId || !player?.isValid) return;

	const duration = getSoundDurationTicks(soundId);
	const releaseFace = getShutFaceForOpen(mouthFace);

	if (ball?.isValid) {
		const played = playBallSoundAt(ball, soundId, mouthFace, duration, releaseFace);
		if (played !== false) {
			console.warn(`verity voice at ball: ${soundId}`);
		}
		return;
	}

	const played = playSoundAtLoc(player, player.location, soundId);
	if (played) {
		console.warn(`verity voice at player: ${soundId}`);
	}
}
