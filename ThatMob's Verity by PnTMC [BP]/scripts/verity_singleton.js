import { system, world } from "@minecraft/server";

const VERITYBALL_ID = "pntmc:verityball";
const CANONICAL_BALL_PROP = "pntmc:verityball_canonical_id";

const GAME_DIMENSIONS = [
	"minecraft:overworld",
	"minecraft:nether",
	"minecraft:the_end",
];

/**
 * @returns {import("@minecraft/server").Entity[]}
 */
export function collectAllVerityballs() {
	/** @type {import("@minecraft/server").Entity[]} */
	const balls = [];
	for (const dimId of GAME_DIMENSIONS) {
		try {
			const dim = world.getDimension(dimId);
			for (const ball of dim.getEntities({ type: VERITYBALL_ID })) {
				if (ball.isValid) balls.push(ball);
			}
		} catch {
			/* ignore */
		}
	}
	return balls;
}

export function clearCanonicalVerityball() {
	world.setDynamicProperty(CANONICAL_BALL_PROP, undefined);
}

/**
 * @param {import("@minecraft/server").Entity} ball
 */
export function setCanonicalVerityball(ball) {
	if (!ball.isValid || ball.typeId !== VERITYBALL_ID) return;
	world.setDynamicProperty(CANONICAL_BALL_PROP, ball.id);
}

/**
 * @param {import("@minecraft/server").Entity} ball
 */
function removeVerityball(ball) {
	if (!ball.isValid) return;
	try {
		ball.remove();
	} catch (err) {
		console.warn(`verity singleton: remove ${ball.id} ${err}`);
	}
}

/**
 * Chỉ giữ 1 verityball trên cả world — duplicate bị despawn.
 * @param {import("@minecraft/server").Entity | undefined} [spawned]
 */
export function enforceSingleVerityball(spawned) {
	const all = collectAllVerityballs();
	if (all.length === 0) {
		clearCanonicalVerityball();
		return;
	}

	if (all.length === 1) {
		setCanonicalVerityball(all[0]);
		return;
	}

	const storedId = world.getDynamicProperty(CANONICAL_BALL_PROP);
	let keeper =
		typeof storedId === "string" ? world.getEntity(storedId) : undefined;

	if (!keeper?.isValid || keeper.typeId !== VERITYBALL_ID) {
		const older =
			spawned?.isValid && spawned.typeId === VERITYBALL_ID
				? all.filter((b) => b.id !== spawned.id)
				: all;
		keeper = older[0] ?? all[0];
		setCanonicalVerityball(keeper);
	}

	let removed = 0;
	for (const ball of all) {
		if (ball.id === keeper.id) continue;
		removeVerityball(ball);
		removed++;
	}

	if (removed > 0) {
		console.warn(
			`verity singleton: despawned ${removed} duplicate verityball(s), kept ${keeper.id}`,
		);
	}
}

export function initVeritySingleton() {
	system.run(() => enforceSingleVerityball());

	world.afterEvents.entitySpawn.subscribe((ev) => {
		if (ev.entity.typeId !== VERITYBALL_ID) return;
		system.run(() => enforceSingleVerityball(ev.entity));
	});

	system.runInterval(() => {
		if (collectAllVerityballs().length > 1) {
			enforceSingleVerityball();
		}
	}, 40);

	console.warn("verity singleton: one verityball per world");
}
