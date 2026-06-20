/** Custom voice lines — seconds measured from WAV/OGG in RP. */
const VOICE_SECONDS = {
	"pntmc.verity.yes_south": 3.2,
	"pntmc.verity.villagers_gone": 1.37,
	"pntmc.verity.gone": 0.52,
	"pntmc.verity.something_passed": 1.99,
	"pntmc.verity.no2": 0.76,
	"pntmc.verity.something_hungry": 1.62,
	"pntmc.verity.im_smiling_now": 1.58,
	"pntmc.verity.always_looked_like_this": 2.75,
	"pntmc.verity.its_already_over": 2.13,
	"pntmc.verity.you_are_mine": 1.71,
		"pntmc.verity.know_everything": 1.8,
		"pntmc.verity.mobbbbb": 4.0,
		"pntmc.verity.somethingiscoming": 1.6,
	"pntmc.verity.somethingiscomingin3days": 1.6,
	"pntmc.verity.loudsound": 2.5,
	"pntmc.verity.loudmusic": 2.5,
};

/** Vanilla / short mob SFX defaults. */
const MOB_SECONDS = {
	"mob.villager.haggle": 1.0,
	"mob.villager.idle": 1.2,
	"mob.cow.hurt": 0.9,
	"mob.cow.say": 1.0,
	"mob.pig.say": 0.8,
	"mob.sheep.say": 0.9,
	"mob.chicken.say": 0.7,
	"mob.wolf.bark": 0.8,
	"mob.cat.meow": 0.9,
	"random.door_open": 0.6,
	"random.door_close": 0.6,
};

const DEFAULT_SECONDS = 1.5;
const MIN_TICKS = 12;

/**
 * @param {string} soundId
 * @returns {number}
 */
export function getSoundDurationTicks(soundId) {
	const sec =
		VOICE_SECONDS[soundId] ??
		MOB_SECONDS[soundId] ??
		DEFAULT_SECONDS;
	return Math.max(MIN_TICKS, Math.ceil(sec * 20));
}
