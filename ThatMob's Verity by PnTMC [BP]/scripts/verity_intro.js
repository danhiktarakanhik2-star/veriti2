import { Player, system, world } from "@minecraft/server";

const BOX_ID = "pntmc:cardboard_box";
const VERITYBALL_ID = "pntmc:verityball";

const WELCOME_MESSAGE =
	"§o§7Thank You For Playing §eVerity §7by §l§f@PnTMC§r\n\n§7§oInspired by ThatMob's Verity";

const INTRO_COMPLETE_PROP = "pntmc:verity_intro_complete";
const BOX_WORLD_PROP = "pntmc:cardboard_box_world";
const BOX_SPAWN_DIST = 5;
const PULL_DISTANCE = 22;

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

const LIQUID = new Set([
	"minecraft:water",
	"minecraft:flowing_water",
	"minecraft:lava",
	"minecraft:flowing_lava",
]);

/** @type {Map<string, string>} */
const introBoxes = new Map();

/** @type {Set<string>} */
const pullTriggered = new Set();

/** @type {(box: import("@minecraft/server").Entity, player: import("@minecraft/server").Player) => void} */
let openBoxHandler = () => {};

/**
 * @param {(box: import("@minecraft/server").Entity, player: import("@minecraft/server").Player) => void} handler
 */
export function setIntroOpenBoxHandler(handler) {
	openBoxHandler = handler;
}

export function markIntroComplete() {
	world.setDynamicProperty(INTRO_COMPLETE_PROP, true);
	world.setDynamicProperty(BOX_WORLD_PROP, undefined);
	introBoxes.clear();
	pullTriggered.clear();
}

export function resetVerityIntro() {
	world.setDynamicProperty(INTRO_COMPLETE_PROP, undefined);
	world.setDynamicProperty(BOX_WORLD_PROP, undefined);
	introBoxes.clear();
	pullTriggered.clear();
}

/**
 * @param {(dim: import("@minecraft/server").Dimension) => void} fn
 */
function forEachGameDimension(fn) {
	for (const id of [
		"minecraft:overworld",
		"minecraft:nether",
		"minecraft:the_end",
	]) {
		try {
			fn(world.getDimension(id));
		} catch {
			/* ignore */
		}
	}
}

/**
 * @returns {import("@minecraft/server").Entity | undefined}
 */
function findAnyUnopenedBoxInWorld() {
	/** @type {import("@minecraft/server").Entity | undefined} */
	let found;
	forEachGameDimension((dim) => {
		if (found) return;
		try {
			for (const box of dim.getEntities({ type: BOX_ID })) {
				if (!box.isValid || !isBoxUnopened(box)) continue;
				found = box;
				return;
			}
		} catch {
			/* ignore */
		}
	});
	return found;
}

/**
 * @returns {boolean}
 */
function worldAlreadyHasBox() {
	if (world.getDynamicProperty(BOX_WORLD_PROP) === true) return true;

	let found = false;
	forEachGameDimension((dim) => {
		if (found) return;
		try {
			if (dim.getEntities({ type: BOX_ID }).length > 0) {
				found = true;
			}
		} catch {
			/* ignore */
		}
	});
	if (found) {
		world.setDynamicProperty(BOX_WORLD_PROP, true);
	}
	return found;
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
 * @param {import("@minecraft/server").Dimension} dim
 * @param {number} x
 * @param {number} z
 * @param {number} refY
 */
function findGroundY(dim, x, z, refY) {
	for (let dy = 5; dy >= -8; dy--) {
		const y = Math.floor(refY) + dy;
		const below = dim.getBlock({ x: Math.floor(x), y: y - 1, z: Math.floor(z) });
		const feet = dim.getBlock({ x: Math.floor(x), y, z: Math.floor(z) });
		const head = dim.getBlock({ x: Math.floor(x), y: y + 1, z: Math.floor(z) });
		if (!below || !feet || !head) continue;
		if (LIQUID.has(below.typeId) || below.typeId === "minecraft:air") continue;
		if (!PASSABLE.has(feet.typeId) || !PASSABLE.has(head.typeId)) continue;
		return y;
	}
	return null;
}

/**
 * Nâng Y: thoát nước (lên mặt nước) rồi ~~ / ~~1~ đều air (không kẹt đất).
 * @param {import("@minecraft/server").Dimension} dim
 * @param {number} x
 * @param {number} z
 * @param {number} startY
 */
function resolveBoxSpawnY(dim, x, z, startY) {
	const bx = Math.floor(x);
	const bz = Math.floor(z);
	let y = Math.floor(startY);
	const maxY = y + 64;
	const initialY = y;

	const blockAt = (yy) => dim.getBlock({ x: bx, y: yy, z: bz });

	while (y < maxY) {
		const feet = blockAt(y);
		const head = blockAt(y + 1);
		if (!feet || !head) break;
		if (!LIQUID.has(feet.typeId) && !LIQUID.has(head.typeId)) break;
		y++;
	}

	const afterWaterY = y;

	while (y < maxY) {
		const feet = blockAt(y);
		const head = blockAt(y + 1);
		if (!feet || !head) break;
		if (feet.typeId === "minecraft:air" && head.typeId === "minecraft:air") break;
		y++;
	}

	if (y !== initialY) {
		console.warn(
			`verity intro: adjusted box spawn y ${initialY} -> ${y} (water surface ${afterWaterY})`,
		);
	}

	return y;
}

/**
 * @param {import("@minecraft/server").Block | undefined} block
 */
function needsGrassFooting(block) {
	if (!block) return true;
	const id = block.typeId;
	return id === "minecraft:air" || LIQUID.has(id);
}

/**
 * Dưới chân hộp: grass_block nếu air/nước (kể cả mặt nước).
 * @param {import("@minecraft/server").Dimension} dim
 * @param {number} x
 * @param {number} y
 * @param {number} z
 */
function ensureBoxFooting(dim, x, y, z) {
	const bx = Math.floor(x);
	const by = Math.floor(y);
	const bz = Math.floor(z);
	const below = dim.getBlock({ x: bx, y: by - 1, z: bz });

	if (needsGrassFooting(below)) {
		try {
			dim.runCommand(`setblock ${bx} ${by - 1} ${bz} grass_block`);
		} catch (err) {
			console.warn(`verity intro grass footing: ${err}`);
		}
	}

	for (const dy of [0, 1]) {
		const block = dim.getBlock({ x: bx, y: by + dy, z: bz });
		if (block && LIQUID.has(block.typeId)) {
			try {
				block.setType("minecraft:air");
			} catch {
				/* ignore */
			}
		}
	}
}

/**
 * @param {import("@minecraft/server").Dimension} dim
 */
function hasVerityballInWorld(dim) {
	try {
		return dim.getEntities({ type: VERITYBALL_ID, maxDistance: 512 }).length > 0;
	} catch {
		return false;
	}
}

/**
 * @param {import("@minecraft/server").Entity} box
 */
function isBoxUnopened(box) {
	try {
		return box.getProperty("pntmc:opened") !== true;
	} catch {
		return true;
	}
}

/**
 * @param {Player} player
 */
function sendWelcome(player) {
	try {
		player.sendMessage(WELCOME_MESSAGE);
	} catch (err) {
		console.warn(`verity intro welcome: ${err}`);
	}
}

/**
 * @param {Player} player
 */
function spawnIntroBox(player) {
	if (worldAlreadyHasBox()) {
		console.warn(`verity intro: world box exists — skip spawn for ${player.name}`);
		return;
	}

	const view = player.getViewDirection();
	const horiz = Math.sqrt(view.x * view.x + view.z * view.z) || 1;
	const fx = view.x / horiz;
	const fz = view.z / horiz;
	const dim = player.dimension;
	const sx = player.location.x + fx * BOX_SPAWN_DIST;
	const sz = player.location.z + fz * BOX_SPAWN_DIST;
	const groundY =
		findGroundY(dim, sx, sz, player.location.y) ?? Math.floor(player.location.y);
	const sy = resolveBoxSpawnY(dim, sx, sz, groundY);

	ensureBoxFooting(dim, sx, sy, sz);

	let box;
	try {
		box = dim.spawnEntity(BOX_ID, { x: sx, y: sy, z: sz });
	} catch (err) {
		console.warn(`verity intro box spawn: ${err}`);
		return;
	}

	box.teleport({ x: sx, y: sy, z: sz });
	world.setDynamicProperty(BOX_WORLD_PROP, true);
	introBoxes.set(player.id, box.id);
	console.warn(
		`verity intro: box for ${player.name} at ${sx.toFixed(1)}, ${sy}, ${sz.toFixed(1)}`,
	);
}

/**
 * @param {Player} player
 */
function beginIntroForPlayer(player) {
	if (!(player instanceof Player) || !player.isValid) return;
	if (world.getDynamicProperty(INTRO_COMPLETE_PROP) === true) return;
	if (hasVerityballInWorld(player.dimension)) {
		markIntroComplete();
		return;
	}

	sendWelcome(player);

	const worldBox = findAnyUnopenedBoxInWorld();
	if (worldBox) {
		if (flatDist(player.location, worldBox.location) <= 48) {
			introBoxes.set(player.id, worldBox.id);
		}
		console.warn(
			`verity intro: world already has box — no spawn for ${player.name}`,
		);
		return;
	}

	spawnIntroBox(player);
}

/**
 * @param {Player} player
 */
function tickIntroPull(player) {
	if (world.getDynamicProperty(INTRO_COMPLETE_PROP) === true) return;

	const boxId = introBoxes.get(player.id);
	if (!boxId) return;

	let box;
	try {
		box = world.getEntity(boxId);
	} catch {
		introBoxes.delete(player.id);
		return;
	}

	if (!box?.isValid || box.typeId !== BOX_ID) {
		introBoxes.delete(player.id);
		return;
	}

	if (!isBoxUnopened(box)) {
		introBoxes.delete(player.id);
		return;
	}

	const dist = flatDist(player.location, box.location);
	if (dist < PULL_DISTANCE) return;
	if (pullTriggered.has(player.id)) return;
	pullTriggered.add(player.id);

	try {
		const loc = player.location;
		player.teleport(loc, {
			facingLocation: {
				x: box.location.x,
				y: box.location.y + 0.8,
				z: box.location.z,
			},
			checkForBlocks: false,
		});
	} catch (err) {
		console.warn(`verity intro face box: ${err}`);
	}

	system.runTimeout(() => {
		if (!player.isValid || !box.isValid || !isBoxUnopened(box)) return;
		console.warn(`verity intro: auto-open box — ${player.name} walked too far`);
		openBoxHandler(box, player);
	}, 8);
}

/**
 * @param {(box: import("@minecraft/server").Entity, player: Player) => void} openBox
 */
export function initVerityIntro(openBox) {
	setIntroOpenBoxHandler(openBox);

	const spawnEv = world.afterEvents.playerSpawn;
	if (spawnEv) {
		spawnEv.subscribe((ev) => {
			if (!ev.initialSpawn) return;
			if (!(ev.player instanceof Player)) return;
			system.runTimeout(() => beginIntroForPlayer(ev.player), 15);
		});
	}

	system.runInterval(() => {
		for (const player of world.getPlayers()) {
			tickIntroPull(player);
		}
	}, 10);

	console.warn("verity intro: welcome + box spawn active");
}
