import { EntityDamageCause, Player, system, world } from "@minecraft/server";
import {
	PLAYER_SAVE,
	clearPlayerJson,
	loadPlayerJson,
	savePlayerJson,
} from "./verity_persist.js";
import { playSoundAtLoc, stopBallMusic } from "./verity_music.js";
import { collectAllVerityballs } from "./verity_singleton.js";
import { shouldBlockSleep } from "./verity_phase2.js";
import { enterVerityPhase, getVerityPhase, PHASE } from "./verity_phases.js";

const VERITY_ID = "pntmc:verity";
const WINDOW_ID = "pntmc:verity_window";

const SOUND_FOREST = "pntmc.verity.mygal_forest";
const SOUND_CHASE = "pntmc.verity.chase";
const SOUND_JUMPSCARE = "pntmc.verity.jumpscare";

/** Music/SFX that can block chase or jumpscare if still playing */
const CHASE_AUDIO_IDS = [
	SOUND_FOREST,
	SOUND_CHASE,
	SOUND_JUMPSCARE,
	"pntmc.verity.mygal_normal",
	"pntmc.verity.loudmusic",
];

const STALK_DIST = 20;
const CHASE_FRONT_DIST = 2;
const CHASE_STEP_DIST = 10;
/** Mỗi 3 giây mới tiến một bước về phía player (interval tick = 10) */
const CHASE_STEP_INTERVAL_TICKS = 60;
const DAMAGE_DIST = 5;
const GLASS_SCAN_RADIUS = 14;
const WINDOW_LOOK_TICKS = 3;
const WINDOW_SPAWN_OUT = 0.65;
/** Glass center Y + this (user: ngang kính, y - 0.5) */
const WINDOW_Y_FROM_GLASS_CENTER = -0.5;
const WINDOW_LOOK_DIST = 14;
/** Chờ sau khi spawn trước khi bắt đầu detect nhìn (~0.8s) */
const WINDOW_SPAWN_GRACE = 8;
const ACTIONBAR = "§4§lYOU JUST CAN HIDE AND RUN";
const EPISODE_END_CHAT = "Thank you for playing Verity Episode 1";

/** 5s stare before chase (interval runs every 10 ticks) */
const STALK_FACE_DELAY_STEPS = 10;
/** ~4s out of Verity sight = found hiding spot */
const HIDE_CONFIRM_STEPS = 8;
const CHASE_VERITY_EYE_Y = 8;
const MAX_BREAK_PER_STEP = 72;

/** @typedef {"stalk"|"chase"|"window"|"done"} ChasePhase */

/** @type {Map<string, {
 *   phase: ChasePhase,
 *   verityId?: string,
 *   windowId?: string,
 *   glassLoc?: { x: number, y: number, z: number },
 *   stalkFaceSteps?: number,
 *   hideSteps?: number,
 *   lookTicks?: number,
 *   windowGraceSteps?: number,
 *   windowTriggered?: boolean,
 *   testMode?: boolean,
 *   damageCooldown?: number,
 *   chaseStepCooldown?: number,
 * }>} */
const sessions = new Map();

/**
 * @param {string} playerId
 * @param {{
 *   phase: ChasePhase,
 *   verityId?: string,
 *   windowId?: string,
 *   glassLoc?: { x: number, y: number, z: number },
 *   stalkFaceSteps?: number,
 *   hideSteps?: number,
 *   lookTicks?: number,
 *   windowGraceSteps?: number,
 *   windowTriggered?: boolean,
 *   testMode?: boolean,
 *   damageCooldown?: number,
 * } | undefined} session
 */
function persistChaseSession(playerId, session) {
	if (!session) {
		clearPlayerJson(playerId, PLAYER_SAVE.CHASE);
		return;
	}
	savePlayerJson(playerId, PLAYER_SAVE.CHASE, {
		phase: session.phase,
		stalkFaceSteps: session.stalkFaceSteps ?? 0,
		hideSteps: session.hideSteps ?? 0,
		lookTicks: session.lookTicks ?? 0,
		windowGraceSteps: session.windowGraceSteps ?? 0,
		windowTriggered: session.windowTriggered ?? false,
		damageCooldown: session.damageCooldown ?? 0,
		glassLoc: session.glassLoc,
		testMode: session.testMode ?? false,
		chaseStepCooldown: session.chaseStepCooldown ?? 0,
	});
}

/**
 * @param {string} playerId
 * @param {{
 *   phase: ChasePhase,
 *   verityId?: string,
 *   windowId?: string,
 *   glassLoc?: { x: number, y: number, z: number },
 *   stalkFaceSteps?: number,
 *   hideSteps?: number,
 *   lookTicks?: number,
 *   windowGraceSteps?: number,
 *   windowTriggered?: boolean,
 *   testMode?: boolean,
 *   damageCooldown?: number,
 * } | undefined} session
 */
function setSession(playerId, session) {
	if (!session) {
		sessions.delete(playerId);
		clearPlayerJson(playerId, PLAYER_SAVE.CHASE);
		return;
	}
	sessions.set(playerId, session);
	persistChaseSession(playerId, session);
}

/**
 * @param {string} playerId
 */
function touchSession(playerId) {
	const session = sessions.get(playerId);
	if (session) persistChaseSession(playerId, session);
}

const PASSABLE = new Set([
	"minecraft:air",
	"minecraft:short_grass",
	"minecraft:tall_grass",
	"minecraft:fern",
	"minecraft:large_fern",
	"minecraft:snow_layer",
	"minecraft:vine",
	"minecraft:water",
	"minecraft:flowing_water",
	"minecraft:seagrass",
	"minecraft:tall_seagrass",
]);

/** Block dưới chân Verity — đất, cát, sỏi, đá… không lá/cây */
const CHASE_GROUND = new Set([
	"minecraft:grass_block",
	"minecraft:dirt",
	"minecraft:coarse_dirt",
	"minecraft:rooted_dirt",
	"minecraft:podzol",
	"minecraft:mycelium",
	"minecraft:mud",
	"minecraft:muddy_mangrove_roots",
	"minecraft:clay",
	"minecraft:sand",
	"minecraft:red_sand",
	"minecraft:suspicious_sand",
	"minecraft:suspicious_gravel",
	"minecraft:gravel",
	"minecraft:stone",
	"minecraft:cobblestone",
	"minecraft:mossy_cobblestone",
	"minecraft:deepslate",
	"minecraft:cobbled_deepslate",
	"minecraft:tuff",
	"minecraft:granite",
	"minecraft:diorite",
	"minecraft:andesite",
	"minecraft:calcite",
	"minecraft:dripstone_block",
	"minecraft:sandstone",
	"minecraft:red_sandstone",
	"minecraft:smooth_sandstone",
	"minecraft:smooth_red_sandstone",
	"minecraft:snow_block",
	"minecraft:packed_mud",
	"minecraft:farmland",
	"minecraft:dirt_path",
]);

/**
 * @param {string} typeId
 */
function isChaseGroundBlock(typeId) {
	if (CHASE_GROUND.has(typeId)) return true;
	if (typeId.includes("leaves")) return false;
	if (typeId.endsWith("_log") || typeId.endsWith("_wood")) return false;
	if (PASSABLE.has(typeId)) return false;
	if (typeId.includes("sapling")) return false;
	if (typeId.includes("flower") || typeId.includes("tulip") || typeId.includes("orchid")) {
		return false;
	}
	if (typeId.includes("mushroom") && !typeId.includes("block")) return false;
	if (typeId.includes("vine") || typeId.includes("coral")) return false;
	if (typeId.includes("fence") || typeId.includes("door") || typeId.includes("trapdoor")) {
		return false;
	}
	if (typeId.endsWith("_ore")) return true;
	if (typeId.includes("deepslate")) return true;
	if (typeId.includes("terracotta") || typeId.includes("concrete")) return true;
	return false;
}

const GLASS_IDS = new Set([
	"minecraft:glass",
	"minecraft:glass_pane",
	"minecraft:tinted_glass",
	"minecraft:white_stained_glass",
	"minecraft:black_stained_glass",
	"minecraft:gray_stained_glass",
	"minecraft:light_gray_stained_glass",
	"minecraft:brown_stained_glass",
	"minecraft:red_stained_glass",
	"minecraft:orange_stained_glass",
	"minecraft:yellow_stained_glass",
	"minecraft:lime_stained_glass",
	"minecraft:green_stained_glass",
	"minecraft:cyan_stained_glass",
	"minecraft:light_blue_stained_glass",
	"minecraft:blue_stained_glass",
	"minecraft:purple_stained_glass",
	"minecraft:magenta_stained_glass",
	"minecraft:pink_stained_glass",
	"minecraft:white_stained_glass_pane",
	"minecraft:black_stained_glass_pane",
	"minecraft:gray_stained_glass_pane",
	"minecraft:light_gray_stained_glass_pane",
	"minecraft:brown_stained_glass_pane",
	"minecraft:red_stained_glass_pane",
	"minecraft:orange_stained_glass_pane",
	"minecraft:yellow_stained_glass_pane",
	"minecraft:lime_stained_glass_pane",
	"minecraft:green_stained_glass_pane",
	"minecraft:cyan_stained_glass_pane",
	"minecraft:light_blue_stained_glass_pane",
	"minecraft:blue_stained_glass_pane",
	"minecraft:purple_stained_glass_pane",
	"minecraft:magenta_stained_glass_pane",
	"minecraft:pink_stained_glass_pane",
]);

const FENCE_IDS = new Set([
	"minecraft:oak_fence",
	"minecraft:spruce_fence",
	"minecraft:birch_fence",
	"minecraft:jungle_fence",
	"minecraft:acacia_fence",
	"minecraft:dark_oak_fence",
	"minecraft:mangrove_fence",
	"minecraft:cherry_fence",
	"minecraft:bamboo_fence",
	"minecraft:crimson_fence",
	"minecraft:warped_fence",
	"minecraft:nether_brick_fence",
	"minecraft:oak_fence_gate",
	"minecraft:spruce_fence_gate",
	"minecraft:birch_fence_gate",
	"minecraft:jungle_fence_gate",
	"minecraft:acacia_fence_gate",
	"minecraft:dark_oak_fence_gate",
	"minecraft:mangrove_fence_gate",
	"minecraft:cherry_fence_gate",
	"minecraft:bamboo_fence_gate",
	"minecraft:crimson_fence_gate",
	"minecraft:warped_fence_gate",
]);

/** Kính + fence đều tính là vật liệu cửa sổ */
const WINDOW_MATERIAL_IDS = new Set([...GLASS_IDS, ...FENCE_IDS]);

/** Hàng xóm ngang cùng tầng (bên cạnh) */
const WINDOW_SIDE_OFFSETS = [
	[1, 0, 0],
	[-1, 0, 0],
	[0, 0, 1],
	[0, 0, -1],
];

/**
 * @param {string} typeId
 */
function isWindowMaterial(typeId) {
	return WINDOW_MATERIAL_IDS.has(typeId);
}

/**
 * Đếm kính/fence bên cạnh (cùng Y, 4 hướng ngang).
 * @param {import("@minecraft/server").Dimension} dim
 * @param {number} x
 * @param {number} y
 * @param {number} z
 */
function countWindowSideNeighbors(dim, x, y, z) {
	let count = 0;
	for (const [dx, dy, dz] of WINDOW_SIDE_OFFSETS) {
		const block = dim.getBlock({ x: x + dx, y: y + dy, z: z + dz });
		if (block && isWindowMaterial(block.typeId)) count++;
	}
	return count;
}

/**
 * Cần ít nhất 1 block kính/fence bên cạnh (ưu tiên 2+ khi chọn).
 * @param {import("@minecraft/server").Dimension} dim
 * @param {number} x
 * @param {number} y
 * @param {number} z
 */
function isValidWindowAnchor(dim, x, y, z) {
	return countWindowSideNeighbors(dim, x, y, z) >= 1;
}

const UNBREAKABLE = new Set([
	"minecraft:bedrock",
	"minecraft:barrier",
	"minecraft:command_block",
	"minecraft:chain_command_block",
	"minecraft:repeating_command_block",
]);

/**
 * @param {import("@minecraft/server").Vector3} origin
 * @param {Player} player
 */
function hasLineOfSightToPlayer(origin, player) {
	try {
		const head = player.getHeadLocation();
		const dx = head.x - origin.x;
		const dy = head.y - origin.y;
		const dz = head.z - origin.z;
		const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
		const hit = player.dimension.getBlockFromRay(
			origin,
			{ x: dx / len, y: dy / len, z: dz / len },
			{
				maxDistance: len,
				includeLiquidBlocks: false,
				includePassableBlocks: false,
			},
		);
		if (!hit?.block) return true;
		const hx = hit.block.location.x + 0.5;
		const hy = hit.block.location.y + 0.5;
		const hz = hit.block.location.z + 0.5;
		const hitDist = Math.sqrt(
			(hx - origin.x) ** 2 + (hy - origin.y) ** 2 + (hz - origin.z) ** 2,
		);
		return hitDist >= len - 1.5;
	} catch {
		return true;
	}
}

/**
 * @param {Player} player
 * @param {import("@minecraft/server").Entity} verity
 */
function isPlayerHidingFromVerity(player, verity) {
	const eye = {
		x: verity.location.x,
		y: verity.location.y + CHASE_VERITY_EYE_Y,
		z: verity.location.z,
	};
	return !hasLineOfSightToPlayer(eye, player);
}

/**
 * @param {import("@minecraft/server").Dimension} dim
 * @param {number} x
 * @param {number} y
 * @param {number} z
 */
function breakBlockAt(dim, x, y, z) {
	try {
		const block = dim.getBlock({ x, y, z });
		if (!block) return false;
		if (PASSABLE.has(block.typeId) || UNBREAKABLE.has(block.typeId)) return false;
		dim.runCommand(`setblock ${x} ${y} ${z} air destroy`);
		return true;
	} catch {
		return false;
	}
}

/**
 * @param {import("@minecraft/server").Dimension} dim
 * @param {{ x: number, y: number, z: number }} from
 * @param {{ x: number, y: number, z: number }} to
 */
function breakBlocksAlongPath(dim, from, to) {
	const steps = Math.max(
		Math.ceil(Math.abs(to.x - from.x)),
		Math.ceil(Math.abs(to.y - from.y)),
		Math.ceil(Math.abs(to.z - from.z)),
		1,
	);
	let broke = 0;
	for (let i = 0; i <= steps; i++) {
		if (broke >= MAX_BREAK_PER_STEP) break;
		const t = i / steps;
		const cx = from.x + (to.x - from.x) * t;
		const cy = from.y + (to.y - from.y) * t;
		const cz = from.z + (to.z - from.z) * t;
		for (let dy = 0; dy <= 11; dy++) {
			for (let dx = -1; dx <= 1; dx++) {
				for (let dz = -1; dz <= 1; dz++) {
					if (broke >= MAX_BREAK_PER_STEP) break;
					const x = Math.floor(cx + dx);
					const y = Math.floor(cy + dy);
					const z = Math.floor(cz + dz);
					if (breakBlockAt(dim, x, y, z)) broke++;
				}
			}
		}
	}
}

/**
 * @param {Player} player
 * @param {import("@minecraft/server").Entity} verity
 */
function advanceVerityTowardPlayer(player, verity) {
	const vl = verity.location;
	const pl = player.location;
	const dx = pl.x - vl.x;
	const dz = pl.z - vl.z;
	const len = Math.hypot(dx, dz) || 1;
	const step = Math.min(CHASE_STEP_DIST, Math.max(0, len - 2));
	if (step < 0.25) return;

	const target = {
		x: vl.x + (dx / len) * step,
		z: vl.z + (dz / len) * step,
	};
	const gy =
		findGroundY(player.dimension, target.x, target.z, pl.y) ?? Math.floor(pl.y);
	const next = { x: target.x, y: gy, z: target.z };

	breakBlocksAlongPath(player.dimension, vl, next);
	verity.teleport(next, { facingLocation: player.location });
}

/**
 * @param {Player} player
 * @param {import("@minecraft/server").Entity} entity
 */
function teleportInFrontWithBreak(player, entity) {
	const view = player.getViewDirection();
	const horiz = Math.sqrt(view.x * view.x + view.z * view.z) || 1;
	const fx = view.x / horiz;
	const fz = view.z / horiz;
	const tx = player.location.x + fx * CHASE_FRONT_DIST;
	const tz = player.location.z + fz * CHASE_FRONT_DIST;
	const gy =
		findGroundY(player.dimension, tx, tz, player.location.y) ??
		Math.floor(player.location.y);
	const next = { x: tx, y: gy, z: tz };

	breakBlocksAlongPath(player.dimension, entity.location, next);
	entity.teleport(next, { facingLocation: player.location });
}

/**
 * @param {import("@minecraft/server").Vector3} a
 * @param {import("@minecraft/server").Vector3} b
 */
function flatDist(a, b) {
	const dx = a.x - b.x;
	const dz = a.z - b.z;
	return Math.sqrt(dx * dx + dz * dz);
}

/**
 * @param {number} x
 * @param {number} z
 */
function hNorm(x, z) {
	const len = Math.hypot(x, z);
	return len < 1e-4 ? { x: 0, z: 1 } : { x: x / len, z: z / len };
}

/**
 * @param {Player} player
 */
function getEye(player) {
	const loc = player.location;
	return { x: loc.x, y: loc.y + 1.62, z: loc.z };
}

/**
 * @param {import("@minecraft/server").Dimension} dim
 * @param {number} x
 * @param {number} z
 * @param {number} refY
 */
function findGroundY(dim, x, z, refY) {
	for (let dy = 4; dy >= -6; dy--) {
		const y = Math.floor(refY) + dy;
		const below = dim.getBlock({ x: Math.floor(x), y: y - 1, z: Math.floor(z) });
		const feet = dim.getBlock({ x: Math.floor(x), y, z: Math.floor(z) });
		const head = dim.getBlock({ x: Math.floor(x), y: y + 1, z: Math.floor(z) });
		if (!below || !feet || !head) continue;
		if (!isChaseGroundBlock(below.typeId)) continue;
		if (!PASSABLE.has(feet.typeId) || !PASSABLE.has(head.typeId)) continue;
		return y;
	}
	return null;
}

/**
 * @param {Player} player
 * @param {{ x: number, y: number, z: number }} target
 */
function hasLineOfSight(player, target) {
	try {
		const head = player.getHeadLocation();
		const dx = target.x - head.x;
		const dy = target.y + 1.4 - head.y;
		const dz = target.z - head.z;
		const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
		const hit = player.dimension.getBlockFromRay(
			head,
			{ x: dx / len, y: dy / len, z: dz / len },
			{
				maxDistance: len,
				includeLiquidBlocks: false,
				includePassableBlocks: false,
			},
		);
		if (!hit?.block) return true;
		const hx = hit.block.location.x + 0.5;
		const hy = hit.block.location.y + 0.5;
		const hz = hit.block.location.z + 0.5;
		const hitDist = Math.sqrt(
			(hx - head.x) ** 2 + (hy - head.y) ** 2 + (hz - head.z) ** 2,
		);
		return hitDist >= len - 1.5;
	} catch {
		return true;
	}
}

/**
 * @param {Player} player
 */
function findStalkSpawn(player) {
	const view = player.getViewDirection();
	const horiz = Math.sqrt(view.x * view.x + view.z * view.z) || 1;
	const fx = view.x / horiz;
	const fz = view.z / horiz;
	const rx = -fz;
	const rz = fx;
	const dim = player.dimension;
	const py = player.location.y;

	for (let lane = -8; lane <= 8; lane++) {
		const sx = player.location.x + fx * STALK_DIST + rx * lane * 1.25;
		const sz = player.location.z + fz * STALK_DIST + rz * lane * 1.25;
		const gy = findGroundY(dim, sx, sz, py);
		if (gy === null) continue;
		const pos = { x: sx, y: gy, z: sz };
		if (!hasLineOfSight(player, pos)) continue;
		return pos;
	}

	const fallbackY = findGroundY(
		dim,
		player.location.x + fx * STALK_DIST,
		player.location.z + fz * STALK_DIST,
		py,
	);
	if (fallbackY === null) return null;
	return {
		x: player.location.x + fx * STALK_DIST,
		y: fallbackY,
		z: player.location.z + fz * STALK_DIST,
	};
}

/**
 * @param {Player} player
 */
function stopChaseAudio(player) {
	for (const p of player.dimension.getPlayers()) {
		for (const soundId of CHASE_AUDIO_IDS) {
			try {
				p.runCommand(`stopsound @s ${soundId}`);
			} catch {
				/* ignore */
			}
		}
	}
	for (const ball of collectAllVerityballs()) {
		if (ball.dimension.id !== player.dimension.id) continue;
		stopBallMusic(ball);
	}
}

/**
 * @param {Player} player
 * @param {string} soundId
 * @param {import("@minecraft/server").Vector3} [loc]
 */
function playChaseAudio(player, soundId, loc) {
	const at = loc ?? player.location;
	stopChaseAudio(player);
	system.runTimeout(() => {
		if (!player.isValid) return;
		const ok = playSoundAtLoc(player, at, soundId);
		if (!ok) {
			console.warn(`verity chase: failed to play ${soundId}`);
		}
	}, 2);
}

/**
 * @param {Player} player
 * @param {string} soundId
 */
function stopChaseSound(player, soundId) {
	for (const p of player.dimension.getPlayers()) {
		try {
			p.runCommand(`stopsound @s ${soundId}`);
		} catch (err) {
			console.warn(`verity chase stopsound ${soundId}: ${err}`);
		}
	}
}

/**
 * @param {Player} player
 * @param {import("@minecraft/server").Entity} entity
 */
function isFacingEntity(player, entity) {
	const view = player.getViewDirection();
	const eye = getEye(player);
	const tx = entity.location.x;
	const ty = entity.location.y + 1.5;
	const tz = entity.location.z;
	const dx = tx - eye.x;
	const dy = ty - eye.y;
	const dz = tz - eye.z;
	const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
	const dot = (view.x * dx + view.y * dy + view.z * dz) / len;
	return dot >= 0.55;
}

/**
 * Tia nhìn thật của player (getViewDirection) có trúng ô kính cửa sổ không.
 * @param {Player} player
 * @param {{ x: number, y: number, z: number }} glassLoc
 */
function viewRayHitsWindowGlass(player, glassLoc) {
	try {
		const head = player.getHeadLocation();
		const view = player.getViewDirection();
		const hit = player.dimension.getBlockFromRay(head, view, {
			maxDistance: WINDOW_LOOK_DIST,
			includeLiquidBlocks: false,
			includePassableBlocks: false,
		});
		if (!hit?.block || !isWindowMaterial(hit.block.typeId)) return false;
		const b = hit.block.location;
		return (
			Math.abs(b.x - glassLoc.x) <= 1 &&
			Math.abs(b.y - glassLoc.y) <= 1 &&
			Math.abs(b.z - glassLoc.z) <= 1
		);
	} catch {
		return false;
	}
}

/**
 * @param {Player} player
 * @param {import("@minecraft/server").Entity} entity
 * @param {{ x: number, y: number, z: number } | undefined} glassLoc
 */
function isAimingAtWindowScare(player, entity, glassLoc) {
	if (!entity.isValid) return false;

	try {
		for (const hit of player.getEntitiesFromViewDirection({ maxDistance: WINDOW_LOOK_DIST })) {
			if (hit.entity?.id === entity.id) return true;
		}
	} catch {
		/* ignore */
	}

	if (!glassLoc) return false;

	if (viewRayHitsWindowGlass(player, glassLoc)) return true;

	return false;
}

/**
 * Eye contact = facing + clear line of sight.
 * @param {Player} player
 * @param {import("@minecraft/server").Entity} entity
 */
function hasEyeContact(player, entity) {
	if (!entity.isValid) return false;
	if (!isFacingEntity(player, entity)) return false;
	return hasLineOfSight(player, entity.location);
}

/**
 * @param {import("@minecraft/server").Entity} entity
 * @param {Player} player
 */
function faceEntityTowardPlayer(entity, player) {
	try {
		entity.teleport(entity.location, { facingLocation: player.location });
	} catch {
		/* ignore */
	}
}

/**
 * @param {string} entityId
 */
function despawnEntity(entityId) {
	try {
		const ent = world.getEntity(entityId);
		if (!ent?.isValid) return;
		ent.triggerEvent("pntmc:despawn");
	} catch {
		/* ignore */
	}
}

/**
 * @param {Player} player
 */
function cleanupSession(player) {
	const session = sessions.get(player.id);
	if (!session) return;
	if (session.verityId) despawnEntity(session.verityId);
	if (session.windowId) despawnEntity(session.windowId);
	stopChaseSound(player, SOUND_FOREST);
	stopChaseSound(player, SOUND_CHASE);
	setSession(player.id, undefined);
}

/**
 * @param {Player} player
 * @param {boolean} [testMode]
 */
export function startChaseSequence(player, testMode = false) {
	cleanupSession(player);

	const spawn = findStalkSpawn(player);
	if (!spawn) {
		console.warn(`verity chase: no spawn for ${player.name}`);
		return false;
	}

	let verity;
	try {
		verity = player.dimension.spawnEntity(VERITY_ID, spawn);
	} catch (err) {
		console.warn(`verity chase spawn: ${err}`);
		return false;
	}

	verity.teleport(spawn, { facingLocation: player.location });
	playChaseAudio(player, SOUND_FOREST);

	if (!testMode && getVerityPhase() < PHASE.FOUR) {
		enterVerityPhase(PHASE.FOUR);
		console.warn(`verity chase: phase 4 — chase begun for ${player.name}`);
	}

	setSession(player.id, {
		phase: "stalk",
		verityId: verity.id,
		stalkFaceSteps: 0,
		hideSteps: 0,
		testMode,
	});
	console.warn(
		`verity chase: stalk spawned for ${player.name} at ${spawn.x.toFixed(1)}, ${spawn.y}, ${spawn.z.toFixed(1)}`,
	);
	return true;
}

/**
 * @param {Player} player
 */
function beginChase(player) {
	const session = sessions.get(player.id);
	if (!session?.verityId || session.phase !== "stalk") return;
	const verity = world.getEntity(session.verityId);
	if (!verity?.isValid) return;

	playChaseAudio(player, SOUND_CHASE);
	teleportInFrontWithBreak(player, verity);
	session.phase = "chase";
	session.stalkFaceSteps = 0;
	session.hideSteps = 0;
	session.chaseStepCooldown = CHASE_STEP_INTERVAL_TICKS;
	touchSession(player.id);
	console.warn(`verity chase: chase started for ${player.name}`);
}

/**
 * @param {Player} player
 */
function beginEscape(player) {
	const session = sessions.get(player.id);
	if (!session || session.phase !== "chase") return;
	if (session.verityId) despawnEntity(session.verityId);
	session.verityId = undefined;
	stopChaseSound(player, SOUND_CHASE);
	session.hideSteps = 0;
	touchSession(player.id);
	console.warn(`verity chase: player hid — window scare for ${player.name}`);
	tryWindowScare(player);
}

/**
 * @param {Player} player
 * @param {{ x: number, y: number, z: number }} glassLoc
 * @param {{ lookTicks?: number, windowGraceSteps?: number, windowTriggered?: boolean } | null} [preserve]
 */
function spawnWindowOutsideGlass(player, glassLoc, preserve = null) {
	const session = sessions.get(player.id);
	if (!session || session.windowId) return;

	const eye = player.getHeadLocation();
	const gx = glassLoc.x + 0.5;
	const gy = glassLoc.y + 0.5;
	const gz = glassLoc.z + 0.5;
	const out = hNorm(gx - eye.x, gz - eye.z);

	const spawn = {
		x: gx + out.x * WINDOW_SPAWN_OUT,
		y: gy + WINDOW_Y_FROM_GLASS_CENTER,
		z: gz + out.z * WINDOW_SPAWN_OUT,
	};

	let windowEnt;
	try {
		windowEnt = player.dimension.spawnEntity(WINDOW_ID, spawn);
	} catch (err) {
		console.warn(`verity chase window spawn: ${err}`);
		session.phase = "done";
		touchSession(player.id);
		return;
	}

	const yaw = (Math.atan2(-(eye.x - spawn.x), eye.z - spawn.z) * 180) / Math.PI;
	try {
		windowEnt.teleport(spawn, {
			dimension: player.dimension,
			rotation: { x: 0, y: yaw },
		});
	} catch {
		windowEnt.teleport(spawn, { facingLocation: player.location });
	}

	session.windowId = windowEnt.id;
	session.glassLoc = { x: glassLoc.x, y: glassLoc.y, z: glassLoc.z };
	session.lookTicks = preserve?.lookTicks ?? 0;
	session.windowGraceSteps = preserve?.windowGraceSteps ?? 0;
	session.windowTriggered = preserve?.windowTriggered ?? false;
	session.phase = "window";
	touchSession(player.id);
	console.warn(
		`verity chase: window scare at glass ${glassLoc.x},${glassLoc.y},${glassLoc.z} spawn y=${spawn.y.toFixed(2)}`,
	);
}

/**
 * @param {Player} player
 * @param {{ x: number, y: number, z: number }} blockLoc
 */
function canSeeGlassBlock(player, blockLoc) {
	const target = {
		x: blockLoc.x + 0.5,
		y: blockLoc.y + 0.5,
		z: blockLoc.z + 0.5,
	};
	return hasLineOfSight(player, target);
}

/**
 * Find nearest visible glass/fence window around player (inside house scan).
 * Chỉ chọn block có ít nhất 1 kính/fence bên cạnh; ưu tiên block có 2+ hàng xóm.
 * @param {Player} player
 */
function findVisibleGlassNear(player) {
	const dim = player.dimension;
	const cx = Math.floor(player.location.x);
	const cy = Math.floor(player.location.y);
	const cz = Math.floor(player.location.z);
	/** @type {{ x: number, y: number, z: number, score: number, neighbors: number } | null} */
	let best = null;

	for (let x = cx - GLASS_SCAN_RADIUS; x <= cx + GLASS_SCAN_RADIUS; x++) {
		for (let y = cy - 2; y <= cy + 4; y++) {
			for (let z = cz - GLASS_SCAN_RADIUS; z <= cz + GLASS_SCAN_RADIUS; z++) {
				const block = dim.getBlock({ x, y, z });
				if (!block || !isWindowMaterial(block.typeId)) continue;
				if (!isValidWindowAnchor(dim, x, y, z)) continue;
				const neighbors = countWindowSideNeighbors(dim, x, y, z);
				if (!canSeeGlassBlock(player, { x, y, z })) continue;
				const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2 + (z - cz) ** 2);
				const score = dist - neighbors * 3;
				if (!best || score < best.score) {
					best = { x, y, z, score, neighbors };
				}
			}
		}
	}
	return best;
}

/**
 * @param {Player} player
 */
function tryWindowScare(player) {
	const session = sessions.get(player.id);
	if (!session) return;

	const glass = findVisibleGlassNear(player);
	if (glass) {
		spawnWindowOutsideGlass(player, glass);
		return;
	}
	session.phase = "done";
	touchSession(player.id);
	console.warn(
		`verity chase: no valid window (glass/fence + neighbor) — sequence done for ${player.name}`,
	);
}

/**
 * @param {import("@minecraft/server").Dimension} dim
 * @param {{ x: number, y: number, z: number }} glassLoc
 */
/**
 * @param {import("@minecraft/server").Dimension} dim
 * @param {number} x
 * @param {number} y
 * @param {number} z
 */
function destroyGlassBlock(dim, x, y, z) {
	try {
		dim.runCommand(`setblock ${x} ${y} ${z} air destroy`);
	} catch (err) {
		console.warn(`verity chase destroy glass ${x},${y},${z}: ${err}`);
	}
	try {
		dim.runCommand(`kill @e[type=item,x=${x},y=${y},z=${z},r=1.5]`);
	} catch {
		/* ignore */
	}
}

/**
 * @param {import("@minecraft/server").Dimension} dim
 * @param {{ x: number, y: number, z: number }} glassLoc
 */
function breakGlassAround(dim, glassLoc) {
	let broke = 0;
	for (let dx = -1; dx <= 1; dx++) {
		for (let dy = -1; dy <= 1; dy++) {
			for (let dz = -1; dz <= 1; dz++) {
				if (broke >= 4) return;
				const x = glassLoc.x + dx;
				const y = glassLoc.y + dy;
				const z = glassLoc.z + dz;
				const block = dim.getBlock({ x, y, z });
				if (!block || !isWindowMaterial(block.typeId)) continue;
				if (UNBREAKABLE.has(block.typeId)) continue;
				destroyGlassBlock(dim, x, y, z);
				broke++;
			}
		}
	}
}

/**
 * @param {Player} player
 */
function showEpisodeEndCredits() {
	try {
		world.sendMessage(`<§fPnTMC§r> ${EPISODE_END_CHAT}`);
	} catch (err) {
		console.warn(`verity chase episode end chat: ${err}`);
	}
}

/**
 * @param {Player} player
 */
function tickWindowPhase(player) {
	const session = sessions.get(player.id);
	if (!session?.windowId || session.phase !== "window") return;
	const windowEnt = world.getEntity(session.windowId);
	if (!windowEnt?.isValid) {
		session.phase = "done";
		touchSession(player.id);
		return;
	}

	if ((session.windowGraceSteps ?? 0) < WINDOW_SPAWN_GRACE) {
		session.windowGraceSteps = (session.windowGraceSteps ?? 0) + 1;
		session.lookTicks = 0;
		return;
	}

	if (!isAimingAtWindowScare(player, windowEnt, session.glassLoc)) {
		session.lookTicks = 0;
		return;
	}

	session.lookTicks = (session.lookTicks ?? 0) + 1;
	if (session.lookTicks < WINDOW_LOOK_TICKS || session.windowTriggered) return;

	session.windowTriggered = true;
	if (session.glassLoc) {
		breakGlassAround(player.dimension, session.glassLoc);
	}

	try {
		windowEnt.setProperty("pntmc:window_scare", true);
	} catch {
		/* ignore */
	}

	playChaseAudio(player, SOUND_JUMPSCARE, player.location);

	system.runTimeout(() => {
		if (session.windowId) despawnEntity(session.windowId);
		session.windowId = undefined;
		session.phase = "done";
		touchSession(player.id);
		showEpisodeEndCredits();
		if (player.isValid) {
			try {
				player.kill();
			} catch (err) {
				console.warn(`verity chase kill: ${err}`);
				try {
					player.applyDamage(9999, { cause: EntityDamageCause.override });
				} catch {
					/* ignore */
				}
			}
		}
	}, 80);
}

/**
 * @param {Player} player
 */
function tickStalkPhase(player) {
	const session = sessions.get(player.id);
	if (!session?.verityId) return;
	const verity = world.getEntity(session.verityId);
	if (!verity?.isValid) {
		cleanupSession(player);
		return;
	}

	faceEntityTowardPlayer(verity, player);

	if (hasEyeContact(player, verity)) {
		session.stalkFaceSteps = (session.stalkFaceSteps ?? 0) + 1;
		if (session.stalkFaceSteps >= STALK_FACE_DELAY_STEPS) {
			beginChase(player);
		}
	} else {
		session.stalkFaceSteps = 0;
	}
}

/**
 * @param {Player} player
 */
function tickChasePhase(player) {
	const session = sessions.get(player.id);
	if (!session?.verityId) return;
	const verity = world.getEntity(session.verityId);
	if (!verity?.isValid) {
		cleanupSession(player);
		return;
	}

	if (isPlayerHidingFromVerity(player, verity)) {
		session.hideSteps = (session.hideSteps ?? 0) + 1;
		if (session.hideSteps >= HIDE_CONFIRM_STEPS) {
			beginEscape(player);
		}
		return;
	}

	session.hideSteps = 0;

	const cooldown = (session.chaseStepCooldown ?? CHASE_STEP_INTERVAL_TICKS) - 10;
	if (cooldown > 0) {
		session.chaseStepCooldown = cooldown;
	} else {
		session.chaseStepCooldown = CHASE_STEP_INTERVAL_TICKS;
		advanceVerityTowardPlayer(player, verity);
	}

	faceEntityTowardPlayer(verity, player);

	if (!hasEyeContact(player, verity)) return;

	try {
		player.onScreenDisplay.setActionBar(ACTIONBAR);
	} catch {
		/* ignore */
	}

	const dist = flatDist(player.location, verity.location);
	if (dist > DAMAGE_DIST) return;

	session.damageCooldown = (session.damageCooldown ?? 0) + 10;
	if (session.damageCooldown < 20) return;

	session.damageCooldown = 0;
	try {
		player.applyDamage(2, {
			cause: EntityDamageCause.entityAttack,
			damagingEntity: verity,
		});
	} catch (err) {
		console.warn(`verity chase damage: ${err}`);
	}
}

/**
 * @param {Player} player
 */
function tickChaseSession(player) {
	const session = sessions.get(player.id);
	if (!session || session.phase === "done") return;

	if (session.phase === "stalk") {
		tickStalkPhase(player);
		return;
	}

	if (session.phase === "chase") {
		tickChasePhase(player);
		return;
	}

	if (session.phase === "window") {
		tickWindowPhase(player);
	}

	touchSession(player.id);
}

/**
 * @param {Player} player
 */
export function tickVerityChase(player) {
	const session = sessions.get(player.id);
	if (session) {
		tickChaseSession(player);
		return;
	}
	if (!shouldBlockSleep()) return;
	startChaseSequence(player, false);
}

/**
 * @param {Player} player
 * @param {string} message
 * @returns {boolean}
 */
export function handleChaseTestChat(player, message) {
	const cmd = message.trim().toLowerCase();
	if (cmd !== "!veritychase" && cmd !== "/veritychase") return false;
	startChaseSequence(player, true);
	return true;
}

/**
 * Khôi phục chase sau khi player vào lại world (entity id không còn hợp lệ).
 * @param {Player} player
 */
export function restoreChaseSession(player) {
	if (sessions.has(player.id)) return;

	const data = loadPlayerJson(player.id, PLAYER_SAVE.CHASE);
	if (!data || typeof data.phase !== "string") return;

	if (data.phase === "done") {
		setSession(player.id, { phase: "done", testMode: !!data.testMode });
		return;
	}

	/** @type {{
	 *   phase: ChasePhase,
	 *   verityId?: string,
	 *   windowId?: string,
	 *   glassLoc?: { x: number, y: number, z: number },
	 *   stalkFaceSteps?: number,
	 *   hideSteps?: number,
	 *   lookTicks?: number,
	 *   windowGraceSteps?: number,
	 *   windowTriggered?: boolean,
	 *   testMode?: boolean,
	 *   damageCooldown?: number,
	 * }} */
	const session = {
		phase: data.phase,
		stalkFaceSteps: data.stalkFaceSteps ?? 0,
		hideSteps: data.hideSteps ?? 0,
		lookTicks: data.lookTicks ?? 0,
		windowGraceSteps: data.windowGraceSteps ?? 0,
		windowTriggered: !!data.windowTriggered,
		damageCooldown: data.damageCooldown ?? 0,
		glassLoc: data.glassLoc,
		testMode: !!data.testMode,
		chaseStepCooldown: data.chaseStepCooldown ?? CHASE_STEP_INTERVAL_TICKS,
	};
	setSession(player.id, session);

	if (data.phase === "stalk" || data.phase === "chase") {
		const spawn = findStalkSpawn(player);
		if (!spawn) {
			console.warn(`verity chase restore: no spawn for ${player.name}`);
			return;
		}
		try {
			const verity = player.dimension.spawnEntity(VERITY_ID, spawn);
			verity.teleport(spawn, { facingLocation: player.location });
			session.verityId = verity.id;
			playChaseAudio(
				player,
				data.phase === "stalk" ? SOUND_FOREST : SOUND_CHASE,
			);
			touchSession(player.id);
			console.warn(`verity chase restore: ${data.phase} for ${player.name}`);
		} catch (err) {
			console.warn(`verity chase restore spawn: ${err}`);
		}
		return;
	}

	if (data.phase === "window") {
		if (data.windowTriggered) {
			session.phase = "done";
			touchSession(player.id);
			return;
		}
		if (data.glassLoc) {
			spawnWindowOutsideGlass(player, data.glassLoc, {
				lookTicks: data.lookTicks,
				windowGraceSteps: data.windowGraceSteps,
				windowTriggered: data.windowTriggered,
			});
		} else {
			tryWindowScare(player);
		}
		console.warn(`verity chase restore: window for ${player.name}`);
	}
}

/**
 * @param {Player} player
 */
export function resetChaseForPlayer(player) {
	cleanupSession(player);
}

/**
 * @param {string} playerId
 */
export function resetChaseProgress(playerId) {
	const player = [...world.getPlayers()].find((p) => p.id === playerId);
	if (player) {
		cleanupSession(player);
		return;
	}
	setSession(playerId, undefined);
}

export function initVerityChase() {
	world.afterEvents.playerLeave.subscribe((ev) => {
		const session = sessions.get(ev.playerId);
		if (session) persistChaseSession(ev.playerId, session);
		sessions.delete(ev.playerId);
	});

	const spawnEv = world.afterEvents.playerSpawn;
	if (spawnEv) {
		spawnEv.subscribe((ev) => {
			if (!(ev.player instanceof Player)) return;
			system.runTimeout(() => restoreChaseSession(ev.player), 20);
		});
	}

	system.run(() => {
		for (const player of world.getPlayers()) {
			restoreChaseSession(player);
		}
	});

	system.runInterval(() => {
		for (const player of world.getPlayers()) {
			tickVerityChase(player);
		}
	}, 10);
	console.warn("verity chase: active (!veritychase to test)");
}
