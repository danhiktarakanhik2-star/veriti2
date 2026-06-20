import { system } from "@minecraft/server";
import { PHASE } from "./verity_phases.js";
import { expandMessage, normalizeQuestion } from "./verity_intent.js";

const ENCHANT_LIST = {
	sharpness: { maxLevel: 5, enchantId: "sharpness" },
	smite: { maxLevel: 5, enchantId: "smite" },
	protection: { maxLevel: 4, enchantId: "protection" },
	fire_protection: { maxLevel: 4, enchantId: "fire_protection" },
	unbreaking: { maxLevel: 3, enchantId: "unbreaking" },
	mending: { maxLevel: 1, enchantId: "mending" },
	fortune: { maxLevel: 3, enchantId: "fortune" },
	silk_touch: { maxLevel: 1, enchantId: "silk_touch" },
	looting: { maxLevel: 3, enchantId: "looting" },
	efficiency: { maxLevel: 5, enchantId: "efficiency" },
	feather_falling: { maxLevel: 4, enchantId: "feather_falling" },
	power: { maxLevel: 5, enchantId: "power" },
	flame: { maxLevel: 1, enchantId: "flame" },
	infinity: { maxLevel: 1, enchantId: "infinity" },
	respiration: { maxLevel: 3, enchantId: "respiration" },
	aqua_affinity: { maxLevel: 1, enchantId: "aqua_affinity" },
	thorns: { maxLevel: 3, enchantId: "thorns" },
	depth_strider: { maxLevel: 3, enchantId: "depth_strider" },
	frost_walker: { maxLevel: 2, enchantId: "frost_walker" },
	swift_sneak: { maxLevel: 3, enchantId: "swift_sneak" },
	soul_speed: { maxLevel: 3, enchantId: "soul_speed" },
	sweeping: { maxLevel: 3, enchantId: "sweeping" },
	knockback: { maxLevel: 2, enchantId: "knockback" },
	fire_aspect: { maxLevel: 2, enchantId: "fire_aspect" },
	bane_of_arthropods: { maxLevel: 5, enchantId: "bane_of_arthropods" },
	punch: { maxLevel: 2, enchantId: "punch" },
};

const ENCHANT_LEVEL_COST = {
	mending: 30,
	fortune: 30,
	silk_touch: 30,
	sharpness: 20,
	smite: 20,
	protection: 15,
	fire_protection: 15,
	unbreaking: 15,
	looting: 20,
	efficiency: 15,
	feather_falling: 10,
	power: 20,
	flame: 15,
	infinity: 30,
	respiration: 15,
	aqua_affinity: 10,
	thorns: 20,
	depth_strider: 15,
	frost_walker: 20,
	swift_sneak: 30,
	soul_speed: 20,
	sweeping: 15,
	knockback: 10,
	fire_aspect: 15,
	bane_of_arthropods: 10,
	punch: 15,
};

const ENCHANT_ALIASES = {
	sharp: "sharpness",
	prot: "protection",
	unbr: "unbreaking",
	unbreak: "unbreaking",
	eff: "efficiency",
	ff: "feather_falling",
	feather: "feather_falling",
	fire_prot: "fire_protection",
	boa: "bane_of_arthropods",
	bane: "bane_of_arthropods",
	silk: "silk_touch",
};

const COME_HERE_REGEX =
	/\b(come here|come over here|get over here|come to me|over here)\b/i;
const COME_HERE_TIMEOUT = 600;
const ARRIVAL_DIST_SQ = 4;

/**
 * @param {string} message
 */
export function wantsComeHere(message) {
	return COME_HERE_REGEX.test(message);
}

/**
 * @param {string} message
 */
export function wantsEnchantBooks(message) {
	const msg = message.toLowerCase();
	if (parseEnchants(message).length > 0) return true;
	return (
		(/\b(give me|i want|i need|can i get)\b/.test(msg) &&
			/\b(enchant|enchantment|book)s?\b/.test(msg)) ||
		/\bgive.*(enchant|book)\b/.test(msg) ||
		/\b(enchant|book).*give\b/.test(msg)
	);
}

/**
 * @param {string} message
 */
function wantsEnchantContext(message) {
	return wantsEnchantBooks(message);
}

/**
 * @param {import("@minecraft/server").Player} player
 */
export function healthLine(player) {
	try {
		const hp = player.getComponent("minecraft:health");
		if (!hp) return null;
		return `${Math.ceil(hp.currentValue / 2)} out of ${Math.ceil(hp.effectiveMax / 2)} hearts.`;
	} catch {
		return null;
	}
}

/**
 * @param {import("@minecraft/server").Player} player
 */
export function hungerLine(player) {
	try {
		const hunger = player.getComponent("minecraft:player.hunger");
		if (hunger) {
			const level = Math.floor(hunger.currentValue ?? hunger.value ?? 20);
			if (level <= 6) {
				return `${level} out of 20 hunger. You're starving. Eat something.`;
			}
			if (level <= 12) {
				return `${level} out of 20 hunger. Getting low. Grab food soon.`;
			}
			return `${level} out of 20 hunger. You're fine for now.`;
		}
	} catch {
		/* ignore */
	}
	return null;
}

/**
 * @param {import("@minecraft/server").Player} player
 */
function getPlayerXpLevel(player) {
	try {
		if (typeof player.level === "number") return player.level;
		const xp = player.getComponent("minecraft:experience");
		if (xp && typeof xp.level === "number") return xp.level;
		if (xp && typeof xp.currentValue === "number") return Math.floor(xp.currentValue);
	} catch {
		/* ignore */
	}
	return 0;
}

/**
 * @param {string} raw
 */
function parseEnchants(raw) {
	/** @type {{ id: string, level: number }[]} */
	const results = [];
	const used = new Set();
	const lower = raw.toLowerCase();

	for (const [alias, target] of Object.entries(ENCHANT_ALIASES)) {
		const re = new RegExp(`\\b${alias}(?:[ _]?(\\d+))?\\b`, "i");
		const match = lower.match(re);
		if (!match || used.has(target)) continue;
		used.add(target);
		const maxLvl = ENCHANT_LIST[target].maxLevel;
		const levelRaw = match[1] ? parseInt(match[1], 10) : null;
		const level = levelRaw ? Math.min(levelRaw, maxLvl) : maxLvl;
		results.push({ id: target, level });
	}

	const names = Object.keys(ENCHANT_LIST).sort((a, b) => b.length - a.length);
	for (const name of names) {
		if (used.has(name)) continue;
		const pattern = name.replace(/_/g, "[ _]");
		const re = new RegExp(`\\b${pattern}(?:[ _]?(\\d+))?\\b`, "i");
		const match = lower.match(re);
		if (!match) continue;
		used.add(name);
		const maxLvl = ENCHANT_LIST[name].maxLevel;
		const levelRaw = match[1] ? parseInt(match[1], 10) : null;
		const level = levelRaw ? Math.min(levelRaw, maxLvl) : maxLvl;
		results.push({ id: name, level });
	}

	return results;
}

/**
 * @param {import("@minecraft/server").Player} player
 * @param {{ id: string, level: number }[]} enchants
 */
function giveEnchantBooks(player, enchants) {
	for (const { id, level } of enchants) {
		player.runCommand(
			`give @s enchanted_book 1 0 {"minecraft:stored_enchantments":{"enchantments":[{"id":"${id}","lvl":${level}}]}}`,
		);
	}
}

/**
 * @param {import("@minecraft/server").Player} player
 * @param {string} rawMsg
 */
export function tryEnchantFlow(player, rawMsg) {
	if (!wantsEnchantContext(rawMsg)) {
		return { handled: false };
	}

	const parsed = parseEnchants(rawMsg);
	if (parsed.length === 0) {
		return {
			handled: true,
			response:
				"Name the enchant you want in the same message. Example: give me mending, or sharpness 5 and unbreaking.",
		};
	}

	const xpLevel = getPlayerXpLevel(player);
	const missing = parsed.filter((e) => xpLevel < (ENCHANT_LEVEL_COST[e.id] ?? 10));
	if (missing.length > 0) {
		const needed = Math.max(...missing.map((e) => ENCHANT_LEVEL_COST[e.id] ?? 10));
		const missingNames = missing.map((e) => e.id.replace(/_/g, " ")).join(", ");
		return {
			handled: true,
			response: `You don't have enough levels for ${missingNames}. You need at least ${needed} levels. Come back when you've earned them.`,
		};
	}

	system.run(() => {
		giveEnchantBooks(player, parsed);
	});
	const bookList = parsed.map((e) => `${e.id.replace(/_/g, " ")} ${e.level}`).join(", ");
	return { handled: true, response: `Here. ${bookList}. Use them wisely.` };
}

/**
 * @param {import("@minecraft/server").Entity} ball
 * @param {boolean} moving
 */
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
 * @param {import("@minecraft/server").Entity} ball
 */
export function callVerityComeHere(player, ball) {
	if (!ball?.isValid || !player.isValid) return;

	let ticks = 0;
	const runId = system.runInterval(() => {
		ticks++;
		if (!ball.isValid || !player.isValid) {
			if (ball.isValid) setBallMoving(ball, false);
			system.clearRun(runId);
			return;
		}
		if (ticks > COME_HERE_TIMEOUT) {
			setBallMoving(ball, false);
			system.clearRun(runId);
			return;
		}

		const pl = player.location;
		const bl = ball.location;
		const dx = pl.x - bl.x;
		const dy = pl.y - bl.y;
		const dz = pl.z - bl.z;
		if (dx * dx + dy * dy + dz * dz <= ARRIVAL_DIST_SQ) {
			setBallMoving(ball, false);
			system.clearRun(runId);
			return;
		}

		moveBallToward(ball, { x: pl.x, y: pl.y, z: pl.z });
	}, 2);
}

function pickLine(lines) {
	return lines[Math.floor(Math.random() * lines.length)];
}

/**
 * @param {import("@minecraft/server").Player} player
 * @param {string} message
 * @param {import("@minecraft/server").Entity | undefined} ball
 * @param {number} phase
 * @returns {{ text: string, intent: string, moveBall?: boolean } | null}
 */
export function tryVerityUtilityActions(player, message, ball, phase) {
	const n = expandMessage(normalizeQuestion(message));

	if (phase === PHASE.ONE) {
		const enchant = tryEnchantFlow(player, message);
		if (enchant.handled) {
			return { text: enchant.response, intent: "enchant" };
		}
	}

	if (wantsComeHere(message)) {
		if (!ball?.isValid) {
			return {
				text: pickLine([
					"Put me on the ground first.",
					"I need to be out of your inventory for that.",
					"Drop me down. Then ask again.",
				]),
				intent: "come_here",
			};
		}
		return {
			text: pickLine(["Coming.", "On my way.", "Be right there."]),
			intent: "come_here",
			moveBall: true,
		};
	}

	if (/\b(health|hearts|hp|how much health|am i hurt)\b/.test(n)) {
		const hp = healthLine(player);
		if (hp) {
			const suffix =
				phase >= PHASE.TWO ? " Keep it up. You'll need it." : " Be careful.";
			return { text: hp + suffix, intent: "health" };
		}
	}

	if (/\b(hunger|food|starving|hungry|how hungry|đói)\b/.test(n)) {
		const food = hungerLine(player);
		if (food) {
			return { text: food, intent: "hunger" };
		}
	}

	return null;
}
