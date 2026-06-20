import { Player, system, world } from "@minecraft/server";
import { applyBallFace } from "./verity_phases.js";
import { VERITY_INVENTORY_IDS, VERITY_ITEM_TO_FACE } from "./verity_items.js";
import { registerVerityballOwner } from "./verity_resurrection.js";
import {
	enforceSingleVerityball,
	setCanonicalVerityball,
} from "./verity_singleton.js";

const VERITYBALL_ID = "pntmc:verityball";
const NEAR_PLAYER_DROP_RADIUS = 10;

/** @type {Set<string>} */
const handledDropItems = new Set();

/**
 * @param {import("@minecraft/server").Vector3} a
 * @param {import("@minecraft/server").Vector3} b
 */
function distSq(a, b) {
	const dx = a.x - b.x;
	const dy = a.y - b.y;
	const dz = a.z - b.z;
	return dx * dx + dy * dy + dz * dz;
}

/**
 * @param {import("@minecraft/server").Vector3} loc
 * @param {import("@minecraft/server").Dimension} dimension
 * @param {number} radius
 */
function findNearestPlayer(loc, dimension, radius) {
	const maxSq = radius * radius;
	let nearest;
	let best = maxSq;
	for (const player of dimension.getPlayers()) {
		const d = distSq(loc, player.location);
		if (d < best) {
			best = d;
			nearest = player;
		}
	}
	return nearest;
}

/**
 * @param {import("@minecraft/server").Entity} itemEntity
 * @returns {string | undefined}
 */
function readVerityItemType(itemEntity) {
	if (!itemEntity.isValid || itemEntity.typeId !== "minecraft:item") return undefined;
	const stack = itemEntity.getComponent("minecraft:item")?.itemStack;
	if (!stack || !VERITY_INVENTORY_IDS.has(stack.typeId)) return undefined;
	return stack.typeId;
}

/**
 * @param {import("@minecraft/server").Entity} entity
 * @returns {import("@minecraft/server").Vector3 | undefined}
 */
function readEntityVelocity(entity) {
	try {
		const v = entity.getVelocity();
		const mag = v.x * v.x + v.y * v.y + v.z * v.z;
		if (mag < 0.0004) return undefined;
		return { x: v.x, y: v.y, z: v.z };
	} catch {
		return undefined;
	}
}

/**
 * @param {import("@minecraft/server").Player} player
 * @returns {import("@minecraft/server").Vector3}
 */
function estimateDropVelocity(player) {
	let view = { x: 0, y: 0, z: 1 };
	try {
		view = player.getViewDirection();
	} catch {
		const yawRad = (player.getRotation().y * Math.PI) / 180;
		view = { x: -Math.sin(yawRad), y: 0, z: Math.cos(yawRad) };
	}

	let playerVel = { x: 0, y: 0, z: 0 };
	try {
		playerVel = player.getVelocity();
	} catch {
		/* ignore */
	}

	const throwStrength = 0.3;
	const lift = 0.24;

	return {
		x: view.x * throwStrength + playerVel.x * 0.35,
		y: view.y * throwStrength + lift + playerVel.y * 0.25,
		z: view.z * throwStrength + playerVel.z * 0.35,
	};
}

/**
 * @param {import("@minecraft/server").Entity} itemEntity
 * @param {import("@minecraft/server").Player} player
 * @param {boolean} [preferPlayerEstimate]
 * @returns {import("@minecraft/server").Vector3}
 */
function resolveDropVelocity(itemEntity, player, preferPlayerEstimate = false) {
	const estimated = estimateDropVelocity(player);
	if (preferPlayerEstimate) return estimated;

	const fromItem = readEntityVelocity(itemEntity);
	if (!fromItem) return estimated;

	return fromItem;
}

/**
 * @param {import("@minecraft/server").Entity} ball
 * @param {import("@minecraft/server").Vector3} velocity
 */
function applyDropMotion(ball, velocity) {
	try {
		ball.clearVelocity();
		ball.applyImpulse(velocity);
	} catch (err) {
		console.warn(`verity drop: motion ${err}`);
	}
}

/**
 * @param {import("@minecraft/server").Player} player
 * @param {import("@minecraft/server").Vector3} loc
 * @param {string} itemTypeId
 * @param {import("@minecraft/server").Vector3} velocity
 */
function spawnVerityballFromDroppedItem(player, loc, itemTypeId, velocity) {
	const faceIndex = VERITY_ITEM_TO_FACE[itemTypeId];
	if (faceIndex === undefined) return;

	let ball;
	try {
		ball = player.dimension.spawnEntity(VERITYBALL_ID, {
			x: loc.x,
			y: loc.y,
			z: loc.z,
		});
	} catch (err) {
		console.warn(`verity drop: spawn failed ${err}`);
		return;
	}

	try {
		applyBallFace(ball, faceIndex, false);
		applyDropMotion(ball, velocity);
	} catch (err) {
		console.warn(`verity drop: face/motion ${err}`);
	}

	system.run(() => {
		if (!ball.isValid) return;
		registerVerityballOwner(ball, player);
		setCanonicalVerityball(ball);
		enforceSingleVerityball(ball);
		console.warn(
			`verity drop: ${player.name} threw ${itemTypeId} → verityball`,
		);
	});
}

/**
 * @param {import("@minecraft/server").Entity} itemEntity
 * @param {import("@minecraft/server").Player} player
 * @param {boolean} [preferPlayerEstimate]
 */
function convertItemEntityToVerityball(
	itemEntity,
	player,
	preferPlayerEstimate = false,
) {
	const itemTypeId = readVerityItemType(itemEntity);
	if (!itemTypeId) return false;
	if (handledDropItems.has(itemEntity.id)) return false;

	handledDropItems.add(itemEntity.id);

	system.run(() => {
		handledDropItems.delete(itemEntity.id);

		const loc = itemEntity.isValid
			? { ...itemEntity.location }
			: { ...player.location };
		const velocity = itemEntity.isValid
			? resolveDropVelocity(itemEntity, player, preferPlayerEstimate)
			: estimateDropVelocity(player);

		if (itemEntity.isValid) {
			try {
				itemEntity.remove();
			} catch (err) {
				console.warn(`verity drop: remove item entity ${err}`);
			}
		}

		spawnVerityballFromDroppedItem(player, loc, itemTypeId, velocity);
	});

	return true;
}

/**
 * @param {unknown} value
 * @returns {import("@minecraft/server").Entity[]}
 */
function asDroppedItemEntities(value) {
	if (value == null) return [];
	if (Array.isArray(value)) {
		return value.filter(
			(entry) =>
				entry &&
				typeof entry === "object" &&
				/** @type {import("@minecraft/server").Entity} */ (entry).isValid,
		);
	}
	if (
		typeof value === "object" &&
		/** @type {import("@minecraft/server").Entity} */ (value).isValid
	) {
		return [/** @type {import("@minecraft/server").Entity} */ (value)];
	}
	return [];
}

/**
 * @param {import("@minecraft/server").EntityItemDropAfterEvent} ev
 */
function onEntityItemDrop(ev) {
	if (!(ev.entity instanceof Player)) return;

	const player = ev.entity;
	const items = asDroppedItemEntities(ev.items);
	if (items.length === 0) return;

	for (const itemEntity of items) {
		convertItemEntityToVerityball(itemEntity, player, true);
	}
}

/**
 * @param {import("@minecraft/server").EntitySpawnAfterEvent} ev
 */
function onVerityItemEntitySpawn(ev) {
	if (ev.entity.typeId !== "minecraft:item") return;
	if (handledDropItems.has(ev.entity.id)) return;
	if (!readVerityItemType(ev.entity)) return;

	const itemEntity = ev.entity;
	system.run(() => {
		if (handledDropItems.has(itemEntity.id)) return;
		if (!itemEntity.isValid) return;

		const player = findNearestPlayer(
			itemEntity.location,
			itemEntity.dimension,
			NEAR_PLAYER_DROP_RADIUS,
		);
		if (!(player instanceof Player)) return;

		convertItemEntityToVerityball(itemEntity, player, false);
	});
}

export function initVerityDrop() {
	const itemDropEv = world.afterEvents.entityItemDrop;
	if (itemDropEv) {
		itemDropEv.subscribe(onEntityItemDrop);
	} else {
		console.warn("verity drop: entityItemDrop unavailable — spawn fallback only");
	}

	world.afterEvents.entitySpawn.subscribe(onVerityItemEntitySpawn);

	world.afterEvents.entityRemove.subscribe((ev) => {
		handledDropItems.delete(ev.removedEntityId);
	});

	console.warn("verity drop: inventory throw → verityball");
}
