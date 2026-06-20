import { world } from "@minecraft/server";

/** Per-player blobs stored on world dynamic properties (key includes player id). */
export const PLAYER_SAVE = {
	CONTEXT: "context",
	CHASE: "chase",
};

export const WORLD_SAVE = {
	BALL_OWNER_ID: "pntmc:verityball_owner_id",
};

/**
 * @param {string} playerId
 * @param {string} suffix
 */
function playerWorldKey(playerId, suffix) {
	return `pntmc:save:${playerId}:${suffix}`;
}

/**
 * @param {string} playerId
 * @param {string} suffix
 * @param {unknown} data
 */
export function savePlayerJson(playerId, suffix, data) {
	try {
		world.setDynamicProperty(playerWorldKey(playerId, suffix), JSON.stringify(data));
	} catch (err) {
		console.warn(`verity persist save ${suffix}: ${err}`);
	}
}

/**
 * @param {string} playerId
 * @param {string} suffix
 */
export function loadPlayerJson(playerId, suffix) {
	const raw = world.getDynamicProperty(playerWorldKey(playerId, suffix));
	if (typeof raw !== "string" || !raw) return null;
	try {
		return JSON.parse(raw);
	} catch {
		return null;
	}
}

/**
 * @param {string} playerId
 * @param {string} suffix
 */
export function clearPlayerJson(playerId, suffix) {
	try {
		world.setDynamicProperty(playerWorldKey(playerId, suffix), undefined);
	} catch {
		/* ignore */
	}
}

/**
 * @param {string} playerId
 */
export function clearPlayerPersist(playerId) {
	for (const suffix of Object.values(PLAYER_SAVE)) {
		clearPlayerJson(playerId, suffix);
	}
}

export function clearAllOnlinePlayerPersist() {
	for (const player of world.getPlayers()) {
		clearPlayerPersist(player.id);
	}
}

/**
 * @param {string} playerId
 */
export function setBallOwnerId(playerId) {
	try {
		world.setDynamicProperty(WORLD_SAVE.BALL_OWNER_ID, playerId);
	} catch (err) {
		console.warn(`verity persist ball owner: ${err}`);
	}
}

/**
 * @returns {string | undefined}
 */
export function getBallOwnerId() {
	const id = world.getDynamicProperty(WORLD_SAVE.BALL_OWNER_ID);
	return typeof id === "string" ? id : undefined;
}

export function clearBallOwnerId() {
	try {
		world.setDynamicProperty(WORLD_SAVE.BALL_OWNER_ID, undefined);
	} catch {
		/* ignore */
	}
}
