import { ItemStack } from "@minecraft/server";
import {
	FACE_ABNORMAL_OPEN,
	FACE_ABNORMAL_SHUT,
	FACE_BORED_P2,
	FACE_CREEPY_SMILE,
	FACE_DAY2_OPEN,
	FACE_DAY2_SHUT,
	FACE_HURT,
	FACE_SERIOUS_1,
	FACE_SERIOUS_2,
	FACE_SERIOUS_3,
	FACE_SMILE,
	FACE_SPEAK,
} from "./verity_faces.js";

export const VERITY_INVENTORY_IDS = new Set([
	"pntmc:verity_inventory_1",
	"pntmc:verity_inventory_2",
	"pntmc:verity_inventory_3",
]);

/** inventory item => face_index khi đặt ra */
export const VERITY_ITEM_TO_FACE = {
	"pntmc:verity_inventory_1": FACE_SMILE,
	"pntmc:verity_inventory_2": FACE_BORED_P2,
	"pntmc:verity_inventory_3": FACE_ABNORMAL_OPEN,
};

/** face_index => inventory item (cầm trên tay) */
export const FACE_TO_INVENTORY_ITEM = {
	[FACE_SMILE]: "pntmc:verity_inventory_1",
	[FACE_SPEAK]: "pntmc:verity_inventory_1",
	[FACE_HURT]: "pntmc:verity_inventory_1",
	[FACE_ABNORMAL_SHUT]: "pntmc:verity_inventory_3",
	[FACE_ABNORMAL_OPEN]: "pntmc:verity_inventory_3",
	[FACE_BORED_P2]: "pntmc:verity_inventory_2",
	[FACE_DAY2_SHUT]: "pntmc:verity_inventory_2",
	[FACE_DAY2_OPEN]: "pntmc:verity_inventory_2",
	[FACE_CREEPY_SMILE]: "pntmc:verity_inventory_3",
	[FACE_SERIOUS_1]: "pntmc:verity_inventory_2",
	[FACE_SERIOUS_2]: "pntmc:verity_inventory_2",
	[FACE_SERIOUS_3]: "pntmc:verity_inventory_3",
};

/**
 * @param {import("@minecraft/server").Player} player
 */
export function playerHoldingVerity(player) {
	const container = player.getComponent("minecraft:inventory")?.container;
	if (!container) return false;
	const stack = container.getItem(player.selectedSlotIndex);
	return !!stack && VERITY_INVENTORY_IDS.has(stack.typeId);
}

/**
 * Đổi item Verity đang cầm trên tay theo face_index.
 * @param {import("@minecraft/server").Player} player
 * @param {number} faceIndex
 * @returns {boolean}
 */
export function syncHeldVerityItem(player, faceIndex) {
	const itemId = FACE_TO_INVENTORY_ITEM[faceIndex];
	if (!itemId) return false;

	const container = player.getComponent("minecraft:inventory")?.container;
	if (!container) return false;

	const slot = player.selectedSlotIndex;
	const stack = container.getItem(slot);
	if (!stack || !VERITY_INVENTORY_IDS.has(stack.typeId)) return false;
	if (stack.typeId === itemId) return false;

	try {
		container.setItem(slot, new ItemStack(itemId, stack.amount));
		return true;
	} catch (err) {
		console.warn(`verity inventory face sync: ${err}`);
		return false;
	}
}
