/**
 * Locate helpers — structure via /locate; biomes via findClosestBiome (2.9+) then /locate fallback.
 */

/** @type {Record<string, string[]>} */
const STRUCTURE_LOCATE_IDS = {
	village: ["village"],
	stronghold: ["stronghold"],
	mansion: ["mansion", "woodland_mansion"],
	monument: ["monument"],
	shipwreck: ["shipwreck"],
	mineshaft: ["mineshaft"],
	ancient_city: ["ancient_city", "ancientcity"],
	bastion_remnant: ["bastion_remnant", "bastionremnant"],
	pillager_outpost: ["pillager_outpost", "pillageroutpost"],
	ruined_portal: ["ruined_portal", "ruinedportal"],
	buried_treasure: ["buried_treasure", "buriedtreasure"],
	end_city: ["end_city", "endcity"],
	fortress: ["fortress", "nether_fortress"],
	temple: ["desert_pyramid", "jungle_pyramid"],
	desert_pyramid: ["desert_pyramid"],
	jungle_pyramid: ["jungle_pyramid"],
	trail_ruins: ["trail_ruins", "trailruins"],
	trial_chambers: ["trial_chambers", "trialchambers"],
	swamp_hut: ["swamp_hut", "witch_hut"],
	igloo: ["igloo"],
	ocean_ruin: ["ocean_ruin_cold", "ocean_ruin_warm"],
	nether_fossil: ["nether_fossil", "netherfossil"],
};

/** @type {Record<string, string[]>} */
const BIOME_LOCATE_IDS = {
	desert: ["desert", "minecraft:desert"],
	jungle: ["jungle", "minecraft:jungle"],
	roofed_forest: ["roofed_forest", "dark_forest", "minecraft:roofed_forest"],
	swamp: ["swamp", "minecraft:swamp"],
	mangrove_swamp: ["mangrove_swamp", "minecraft:mangrove_swamp"],
	taiga: ["taiga", "minecraft:taiga"],
	cold_taiga: ["cold_taiga", "snowy_taiga", "minecraft:cold_taiga"],
	savanna: ["savanna", "minecraft:savanna"],
	mesa: ["mesa", "badlands", "minecraft:mesa"],
	cherry_grove: ["cherry_grove", "minecraft:cherry_grove"],
	plains: ["plains", "minecraft:plains"],
	forest: ["forest", "minecraft:forest"],
	flower_forest: ["flower_forest", "minecraft:flower_forest"],
	birch_forest: ["birch_forest", "minecraft:birch_forest"],
	old_growth_birch_forest: ["old_growth_birch_forest", "minecraft:old_growth_birch_forest"],
	ice_plains: ["ice_plains", "snowy_plains", "minecraft:ice_plains"],
	deep_dark: ["deep_dark", "minecraft:deep_dark"],
	mushroom_island: ["mushroom_island", "mooshroom_island", "minecraft:mushroom_island"],
	ocean: ["ocean", "minecraft:ocean"],
	warm_ocean: ["warm_ocean", "minecraft:warm_ocean"],
	deep_ocean: ["deep_ocean", "minecraft:deep_ocean"],
};

/**
 * @param {string} raw
 * @returns {{ x: number, z: number } | null}
 */
export function parseLocateCoords(raw) {
	if (!raw || typeof raw !== "string") return null;

	const patterns = [
		/\[\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*\]/,
		/at\s+block\s+(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)/i,
		/located\s+[\w\s]+\s+at\s+(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)/i,
		/nearest\s+[\w\s]+\s+at\s+block\s+(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)/i,
		/(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)/,
		/(-?\d+)\s+(-?\d+)\s+(-?\d+)/,
	];

	for (const pattern of patterns) {
		const match = raw.match(pattern);
		if (!match) continue;
		const x = Number(match[1]);
		const z = Number(match[3]);
		if (!Number.isNaN(x) && !Number.isNaN(z)) return { x, z };
	}

	const nums = raw.match(/-?\d+/g);
	if (nums && nums.length >= 3) {
		const x = Number(nums[0]);
		const z = Number(nums[2]);
		if (!Number.isNaN(x) && !Number.isNaN(z)) return { x, z };
	}
	if (nums && nums.length >= 2) {
		const x = Number(nums[0]);
		const z = Number(nums[nums.length - 1]);
		if (!Number.isNaN(x) && !Number.isNaN(z)) return { x, z };
	}
	return null;
}

/**
 * @param {import("@minecraft/server").Player} player
 * @param {string} command
 * @returns {string}
 */
function runLocateCommand(player, command) {
	const runners = [
		() => player.runCommand(command),
		() => player.dimension.runCommand(command),
		() =>
			player.runCommand(`execute as @s at @s run ${command}`),
	];

	for (const run of runners) {
		try {
			const result = run();
			if (result?.statusMessage) return result.statusMessage;
			if (result?.successCount !== undefined && result.successCount > 0 && result.statusMessage) {
				return result.statusMessage;
			}
		} catch (err) {
			console.warn(`verity locate cmd "${command}": ${err}`);
		}
	}
	return "";
}

/**
 * @param {string} structureId
 * @returns {string[]}
 */
function structureLocateCommands(structureId) {
	const bare = structureId.replace(/^minecraft:/, "");
	const ids = new Set([bare, bare.replace(/_/g, "")]);
	/** @type {string[]} */
	const commands = [];
	for (const id of ids) {
		commands.push(`locate structure ${id}`);
		commands.push(`locate structure minecraft:${id}`);
	}
	return commands;
}

/**
 * @param {string} biomeId
 * @returns {string[]}
 */
function biomeLocateCommands(biomeId) {
	const bare = biomeId.replace(/^minecraft:/, "");
	return [`locate biome ${bare}`, `locate biome minecraft:${bare}`];
}

/**
 * @param {import("@minecraft/server").Vector3} origin
 * @param {{ x: number, z: number }} coords
 */
function distanceSqXZ(origin, coords) {
	const dx = origin.x - coords.x;
	const dz = origin.z - coords.z;
	return dx * dx + dz * dz;
}

/**
 * @param {import("@minecraft/server").Player} player
 * @param {string[]} commands
 * @returns {{ x: number, z: number, raw: string } | null}
 */
function tryLocateCommands(player, commands) {
	/** @type {{ x: number, z: number, raw: string, dist: number } | null} */
	let best = null;

	for (const command of commands) {
		const raw = runLocateCommand(player, command);
		if (!raw) continue;

		if (/\b(couldn't|could not|unable|not find|no structure|no biome|invalid)\b/i.test(raw)) {
			continue;
		}

		const coords = parseLocateCoords(raw);
		if (!coords) {
			console.warn(`verity locate unparsed (${command}): ${raw}`);
			continue;
		}

		const dist = distanceSqXZ(player.location, coords);
		console.warn(`verity locate ok (${command}): ${raw}`);
		if (!best || dist < best.dist) {
			best = { ...coords, raw, dist };
		}
	}

	return best ? { x: best.x, z: best.z, raw: best.raw } : null;
}

/**
 * @param {import("@minecraft/server").Player} player
 * @param {string} biomeId
 * @returns {{ x: number, z: number, raw: string } | null}
 */
function locateBiomeNative(player, biomeId) {
	const dim = player.dimension;
	if (typeof dim.findClosestBiome !== "function") return null;

	const candidates = BIOME_LOCATE_IDS[biomeId] ?? [biomeId, `minecraft:${biomeId}`];
	const seen = new Set();

	for (const candidate of candidates) {
		const key = candidate.replace(/^minecraft:/, "");
		if (seen.has(key)) continue;
		seen.add(key);

		try {
			const pos = dim.findClosestBiome(player.location, candidate);
			if (!pos) continue;
			const x = Math.floor(pos.x);
			const z = Math.floor(pos.z);
			console.warn(`verity locate biome api (${candidate}): ${x} ${pos.y} ${z}`);
			return { x, z, raw: `api:${candidate} ${x} ${pos.y} ${z}` };
		} catch (err) {
			console.warn(`verity locate biome api ${candidate}: ${err}`);
		}
	}
	return null;
}

/**
 * @param {import("@minecraft/server").Player} player
 * @param {"structure"|"biome"} kind
 * @param {string} id
 * @returns {{ x: number, z: number, raw: string } | null}
 */
export function locateNearest(player, kind, id) {
	const base = id.replace(/^minecraft:/, "");

	if (kind === "biome") {
		const native = locateBiomeNative(player, base);
		if (native) return native;

		const biomeCandidates = BIOME_LOCATE_IDS[base] ?? [base];
		/** @type {string[]} */
		const commands = [];
		const seenCmd = new Set();
		for (const biome of biomeCandidates) {
			for (const cmd of biomeLocateCommands(biome)) {
				if (seenCmd.has(cmd)) continue;
				seenCmd.add(cmd);
				commands.push(cmd);
			}
		}
		return tryLocateCommands(player, commands);
	}

	const structureIds = STRUCTURE_LOCATE_IDS[base] ?? [base];
	/** @type {string[]} */
	const commands = [];
	const seenCmd = new Set();
	for (const structureId of structureIds) {
		for (const cmd of structureLocateCommands(structureId)) {
			if (seenCmd.has(cmd)) continue;
			seenCmd.add(cmd);
			commands.push(cmd);
		}
	}
	return tryLocateCommands(player, commands);
}
