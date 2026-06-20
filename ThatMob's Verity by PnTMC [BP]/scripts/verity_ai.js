import { Player, system, world } from "@minecraft/server";
import {
	animateGroundSpeech,
	FACE_SPEAK,
	getVerityPhase,
	PHASE,
} from "./verity_phases.js";
import {
	isMusicPlaying,
	playBallMusic,
	playBallSoundAt,
	playSoundAtLoc,
	stopBallMusic,
} from "./verity_music.js";
import { getIdleFaceFor } from "./verity_faces.js";
import { getSoundDurationTicks } from "./verity_sound_durations.js";
import { deliverPhase2Speech, getPhase2State, P2_STATE, tryPhase2Chat } from "./verity_phase2.js";
import { tryBrainAnswer } from "./verity_brain.js";
import { tryBrainKnowledge } from "./verity_knowledge.js";
import { tryBasicChat } from "./verity_chat.js";
import { looksLikeMath, tryMathAnswer } from "./verity_math.js";
import { locateNearest } from "./verity_locate.js";
import {
	analyzeMind,
	classifyAudience,
	describeNearbyEntity,
	detectFallbackTopic,
	detectSocialIntent,
	detectWorldFactIntent,
	expandMessage,
	findSoundKey,
	findStructureKey,
	findTargetEntityNearPlayer,
	getPlayerContext,
	looksLikeQuestion,
	MYGAL_NORMAL_SOUND,
	markVerityReplied,
	normalizeQuestion,
	recordPlayerChat,
	tryGameplayTip,
	tryOreTip,
	tryResolveFollowUp,
	updatePlayerContext,
	wantsBiomeInfo,
	wantsNearbyEntityQuestion,
	wantsSoundRequest,
} from "./verity_mind.js";
import { tryStoryChat } from "./verity_story.js";
import {
	callVerityComeHere,
	healthLine,
	hungerLine,
	tryEnchantFlow,
	tryVerityUtilityActions,
} from "./verity_actions.js";
import { FALLBACK_CHAT, playVerityVoice, playVerityVoiceAt, VOICE } from "./verity_voices.js";

const VERITYBALL_ID = "pntmc:verityball";
const VERITY_ITEM_IDS = new Set([
	"pntmc:verity_inventory_1",
	"pntmc:verity_inventory_2",
	"pntmc:verity_inventory_3",
]);

const HEY_VERITY = /\bhey\s+verity\b/i;
const VERITY_LISTEN_RADIUS = 20;
const INVENTORY_WAKE_IDLE_MS = 60_000;

/** @type {Map<string, number>} */
const inventoryAwakeAt = new Map();

/** @type {Map<string, { recent: string[], repeats: Map<string, number> }>} */
const playerChatMemory = new Map();

const MEMORY_WINDOW = 12;
const REPEAT_PUSHBACK_AT = 3;
const RAIN_COUNTDOWN_SECONDS = 5;
const TICKS_PER_SECOND = 20;
const RAIN_COUNTDOWN_MARKER = "__RAIN_COUNTDOWN__";

/** @type {Set<string>} */
const rainCountdownActive = new Set();

/**
 * @param {string[]} lines
 */
function pickLine(lines) {
	return lines[Math.floor(Math.random() * lines.length)];
}

/**
 * @param {number} n
 */
function formatNum(n) {
	const v = Math.round(n);
	if (v < 0) return `minus ${Math.abs(v)}`;
	return String(v);
}

/**
 * @param {number} x
 * @param {number} y
 * @param {number} z
 */
function formatCoords(x, y, z) {
	return `X ${formatNum(x)}, Y ${formatNum(y)}, and Z ${formatNum(z)}`;
}

/**
 * @param {number} x
 * @param {number} z
 */
function formatXZ(x, z) {
	return `X ${formatNum(x)} and Z ${formatNum(z)}`;
}

/**
 * @param {number} hour
 */
function formatHour(hour) {
	if (hour === 0) return "midnight";
	if (hour === 12) return "noon";
	return `${hour} o'clock`;
}

/**
 * @param {string} text
 */
function polishSpeech(text) {
	let s = text;
	s = s.replace(/\b(\d{1,2}):00\b/g, (_, h) => formatHour(Number(h)));
	s = s.replace(/\s*—\s*/g, ". ");
	s = s.replace(/([.!?])\s*-\s+/g, "$1 ");
	s = s.replace(/\s-\s+(?=[a-z])/gi, ". ");
	s = s.replace(/:\s+(?=[A-Za-z])/g, ". ");
	s = s.replace(/\b([XYZ])\s+-(\d+)/gi, "$1 minus $2");
	s = s.replace(/\s{2,}/g, " ");
	return s.trim();
}

const NON_ENGLISH_CHARS =
	/[\u00C0-\u024F\u1E00-\u1EFF\u0400-\u04FF\u4E00-\u9FFF\u3040-\u30FF\uAC00-\uD7AF]/;

const VIETNAMESE_HINT =
	/\b(gi|dau|sao|nao|khong|toi|minh|ban|cho|hay|duoc|lam sao|the nao|bao nhieu|o day|noi nay|tim kiem|giup|chao|xin chao|ban la ai|may gio|thoi gian|toa do|vi tri|dang o|co khong|khong biet|lang xa|moi truong|thoi tiet)\b/;

/**
 * @param {string} message
 */
function isEnglishMessage(message) {
	const trimmed = message.trim();
	if (!trimmed) return false;
	if (NON_ENGLISH_CHARS.test(trimmed)) return false;
	if (VIETNAMESE_HINT.test(normalizeQuestion(trimmed))) return false;
	return true;
}

/**
 * @param {string} text
 * @param {string} intent
 */
function getNaturalThinkDelay(text, intent) {
	const words = text.trim().split(/\s+/).filter(Boolean).length;
	const chars = text.trim().length;

	let min = 8;
	let max = 24;

	switch (intent) {
		case "sound":
			min = 3;
			max = 10;
			break;
		case "play_song":
			min = 8;
			max = 18;
			break;
		case "social":
		case "follow_up":
			min = 5;
			max = 16;
			break;
		case "locate_structure":
		case "locate_biome":
		case "follow_up_precise":
			min = 30;
			max = 55;
			break;
		case "brain":
			min = 22;
			max = 50;
			break;
		case "biome_here":
		case "world_fact":
			min = 10;
			max = 28;
			break;
		case "ore_tip":
			min = 14;
			max = 32;
			break;
		case "situational":
			min = 8;
			max = 22;
			break;
		case "gameplay_tip":
			min = 12;
			max = 30;
			break;
		case "control":
			min = 3;
			max = 10;
			break;
		case "nearby_entity":
			min = 6;
			max = 18;
			break;
		case "rain_countdown":
			min = 10;
			max = 20;
			break;
		case "story":
			min = 6;
			max = 18;
			break;
		default:
			min = 8;
			max = 26;
			break;
	}

	if (words <= 2) {
		min = Math.max(3, min - 7);
		max = Math.max(min + 3, max - 12);
	}

	if (chars > 70) {
		min += 6;
		max += 12;
	}

	return min + Math.floor(Math.random() * (max - min + 1));
}

/**
 * @param {string} text
 * @param {import("@minecraft/server").Entity | undefined} ball
 */
/**
 * @param {string} text
 * @param {import("@minecraft/server").Entity | undefined} ball
 * @param {boolean} [animateSpeech]
 */
function deliverVerityReply(text, ball, animateSpeech = true) {
	verityReply(text);
	if (!ball?.isValid || !animateSpeech) return;
	if (getVerityPhase() === PHASE.ONE) {
		animateGroundSpeech(ball, text);
	} else if (getVerityPhase() === PHASE.TWO || getVerityPhase() === PHASE.THREE) {
		deliverPhase2Speech(ball, text, true);
	}
}

/**
 * @param {string} text
 * @param {import("@minecraft/server").Entity | undefined} ball
 * @param {string} [intent]
 * @param {() => void} [afterReply]
 * @param {string} [voiceId]
 * @param {string} [playerId]
 * @param {number} [voiceMouthFace]
 */
function scheduleVerityReply(
	text,
	ball,
	intent = "unknown",
	afterReply,
	voiceId,
	playerId,
	voiceMouthFace,
) {
	const delay = voiceId ? 0 : getNaturalThinkDelay(text, intent);
	const animateSpeech = intent !== "sound" && !voiceId;

	const playVoice = () => {
		if (!voiceId) return;
		const player = playerId
			? [...world.getPlayers()].find((p) => p.id === playerId)
			: undefined;
		if (player?.isValid) {
			playVerityVoiceAt(player, voiceId, ball, voiceMouthFace);
			return;
		}
		if (ball?.isValid) {
			playVerityVoice(ball, voiceId);
			return;
		}
		console.warn(`verity voice dropped ${voiceId}: no player or ball`);
	};

	const deliver = () => {
		if (text) deliverVerityReply(text, ball, animateSpeech);
		if (playerId) markVerityReplied(playerId);
		afterReply?.();
	};

	if (voiceId) {
		system.run(playVoice);
		system.runTimeout(deliver, delay + 3);
		return;
	}

	system.runTimeout(deliver, delay);
}

/**
 * @param {import("@minecraft/server").Player} player
 * @param {import("@minecraft/server").Entity | undefined} ball
 */
function startRainCountdown(player, ball) {
	const dim = player.dimension;
	const dimId = dim.id;

	if (rainCountdownActive.has(dimId)) {
		scheduleVerityReply(
			pickLine([
				"Already counting down to rain. Hang on.",
				"Rain's on the way already. Give it a moment.",
			]),
			ball,
			"rain_countdown",
		);
		return;
	}

	rainCountdownActive.add(dimId);
	const introDelay = getNaturalThinkDelay("Rain in 5 seconds.", "rain_countdown");

	system.runTimeout(() => {
		if (!rainCountdownActive.has(dimId)) return;
		deliverVerityReply(
			pickLine([
				"Rain in 5 seconds.",
				"Give me 5 seconds. Then it pours.",
				"5 seconds until rain.",
			]),
			ball,
		);
	}, introDelay);

	for (let i = 0; i < RAIN_COUNTDOWN_SECONDS; i++) {
		const value = RAIN_COUNTDOWN_SECONDS - i;
		system.runTimeout(() => {
			if (!rainCountdownActive.has(dimId)) return;
			deliverVerityReply(String(value), ball);
		}, introDelay + (i + 1) * TICKS_PER_SECOND);
	}

	system.runTimeout(() => {
		if (!rainCountdownActive.has(dimId)) return;
		rainCountdownActive.delete(dimId);

		system.run(() => {
			try {
				dim.setWeather("Rain", 12000);
			} catch (err) {
				console.warn(`verity rain setWeather: ${err}`);
				try {
					player.runCommand("weather rain 12000");
				} catch (cmdErr) {
					console.warn(`verity rain command: ${cmdErr}`);
				}
			}
		});

		deliverVerityReply(
			pickLine([
				"There. It's raining.",
				"Done. Rain.",
				"Sky's open now.",
			]),
			ball,
		);
	}, introDelay + RAIN_COUNTDOWN_SECONDS * TICKS_PER_SECOND);
}

function replyEnglishOnly(ball) {
	scheduleVerityReply(
		pickLine([
			"I only speak English. Say that again in English.",
			"Sorry, English only. Try again?",
			"I didn't catch that. I only understand English.",
		]),
		ball,
		"social",
	);
}

/**
 * @param {string} playerId
 * @param {string} norm
 */
function bumpRepeat(playerId, norm) {
	let mem = playerChatMemory.get(playerId);
	if (!mem) {
		mem = { recent: [], repeats: new Map() };
		playerChatMemory.set(playerId, mem);
	}
	mem.recent.push(norm);
	if (mem.recent.length > MEMORY_WINDOW) mem.recent.shift();
	const count = (mem.repeats.get(norm) ?? 0) + 1;
	mem.repeats.set(norm, count);
	if (mem.repeats.size > 30) {
		const oldest = mem.recent[0];
		if (oldest) mem.repeats.delete(oldest);
	}
	return count;
}

/**
 * @param {string} answer
 * @param {number} repeatCount
 */
function wrapNaturalReply(answer, repeatCount) {
	if (repeatCount >= REPEAT_PUSHBACK_AT) {
		return pickLine([
			`You asked that before. ${answer}`,
			`Same one again. ${answer}`,
			`Still true. ${answer}`,
		]);
	}
	return answer;
}

/**
 * @param {string} text
 */
export function verityReply(text) {
	world.sendMessage(`<§eVerity§r> ${polishSpeech(text)}`);
}

/**
 * @param {string} id
 */
export function formatIdName(id) {
	const part = String(id).split(":").pop() ?? String(id);
	return part
		.split("_")
		.filter(Boolean)
		.map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
		.join(" ");
}

/**
 * @param {import("@minecraft/server").Player} player
 */
function touchInventoryAwake(player) {
	inventoryAwakeAt.set(player.id, Date.now());
}

/**
 * @param {import("@minecraft/server").Player} player
 */
function clearInventoryAwake(player) {
	inventoryAwakeAt.delete(player.id);
}

/**
 * @param {import("@minecraft/server").Player} player
 */
function isInventoryAwake(player) {
	if (!playerHasVerityItem(player)) {
		clearInventoryAwake(player);
		return false;
	}
	const last = inventoryAwakeAt.get(player.id);
	if (last === undefined) return false;
	if (Date.now() - last > INVENTORY_WAKE_IDLE_MS) {
		clearInventoryAwake(player);
		return false;
	}
	return true;
}

/**
 * @param {import("@minecraft/server").Player} player
 */
function playerHasVerityItem(player) {
	const container = player.getComponent("minecraft:inventory")?.container;
	if (!container) return false;
	for (let slot = 0; slot < container.size; slot++) {
		const stack = container.getItem(slot);
		if (stack && VERITY_ITEM_IDS.has(stack.typeId)) return true;
	}
	return false;
}

/**
 * @param {import("@minecraft/server").Player} player
 * @param {number} maxDistance
 */
export function findNearestVerityball(player, maxDistance = 20) {
	let nearest;
	let nearestDist = Infinity;
	try {
		for (const ball of player.dimension.getEntities({
			type: VERITYBALL_ID,
			location: player.location,
			maxDistance,
		})) {
			if (!ball.isValid) continue;
			const dx = ball.location.x - player.location.x;
			const dy = ball.location.y - player.location.y;
			const dz = ball.location.z - player.location.z;
			const dist = dx * dx + dy * dy + dz * dz;
			if (dist < nearestDist) {
				nearestDist = dist;
				nearest = ball;
			}
		}
	} catch (err) {
		console.warn(`verity find ball: ${err}`);
	}
	return nearest;
}

/**
 * @param {import("@minecraft/server").Vector3} from
 * @param {import("@minecraft/server").Vector3} to
 */
function getCardinalDirection(from, to) {
	const dx = to.x - from.x;
	const dz = to.z - from.z;
	if (Math.abs(dx) > Math.abs(dz)) {
		return dx >= 0 ? "East" : "West";
	}
	return dz >= 0 ? "South" : "North";
}

/**
 * @param {import("@minecraft/server").Player} player
 * @param {import("@minecraft/server").Vector3} target
 */
function formatRelativeDistance(player, target) {
	const dx = target.x - player.location.x;
	const dz = target.z - player.location.z;
	const blocks = Math.round(Math.sqrt(dx * dx + dz * dz));
	const dir = getCardinalDirection(player.location, target);
	return { dir, blocks };
}

/**
 * @param {number} yaw
 */
function yawToCardinal(yaw) {
	const deg = ((yaw % 360) + 360) % 360;
	if (deg >= 315 || deg < 45) return "South";
	if (deg >= 45 && deg < 135) return "West";
	if (deg >= 135 && deg < 225) return "North";
	return "East";
}

/**
 * @param {import("@minecraft/server").Player} player
 * @param {string} name
 */
function formatBiomeReply(name) {
	return pickLine([
		`We're in ${name}. This patch of world has its own mood.`,
		`This stretch of land is ${name}.`,
		`Under your feet? ${name}.`,
		`I'd read the ground as ${name}.`,
		`${name}. That's your biome right now.`,
	]);
}

/**
 * @param {import("@minecraft/server").Player} player
 */
function readBiomeName(player) {
	const biome = player.dimension.getBiome(player.location);
	const biomeId =
		typeof biome === "string" ? biome : biome?.id ?? String(biome);
	return formatIdName(biomeId);
}

/**
 * @param {import("@minecraft/server").Player} player
 */
function tryAnswerNearbyEntity(player) {
	const entity = findTargetEntityNearPlayer(player, 14);
	if (!entity) {
		return pickLine([
			"I don't see anything nearby.",
			"Nothing close enough for me to name.",
			"Empty. Or you're not looking at it.",
		]);
	}
	updatePlayerContext(player.id, {
		lastIntent: "nearby_entity",
		lastAnswer: describeNearbyEntity(entity),
	});
	return describeNearbyEntity(entity);
}

/**
 * @param {import("@minecraft/server").Player} player
 * @param {string} message
 */
function tryAnswerBiome(player, message) {
	if (!wantsBiomeInfo(message)) return null;
	try {
		const name = readBiomeName(player);
		updatePlayerContext(player.id, { lastBiome: name, lastIntent: "biome" });
		return formatBiomeReply(name);
	} catch (err) {
		console.warn(`verity biome: ${err}`);
		return pickLine([
			"Chunks around you aren't loaded enough for me to read the biome.",
			"I can't read the ground yet. Stand on loaded terrain.",
		]);
	}
}

/**
 * @param {import("@minecraft/server").Player} player
 * @param {import("@minecraft/server").Entity} ball
 * @param {string} soundId
 */
function playVeritySound(player, ball, soundId) {
	if (ball?.isValid) {
		playBallSoundAt(
			ball,
			soundId,
			FACE_SPEAK,
			getSoundDurationTicks(soundId),
		);
		return;
	}
	playSoundAtLoc(player, player.location, soundId);
}

/**
 * @param {import("@minecraft/server").Player} player
 * @param {string} biomeId
 * @param {boolean} precise
 */
async function locateBiomeAnswer(player, biomeId, precise) {
	try {
		const located = locateNearest(player, "biome", biomeId);
		const pretty = formatIdName(biomeId);

		if (!located) {
			return pickLine([
				`No ${pretty} biome close enough on my scan. Keep traveling.`,
				`Can't find ${pretty} nearby. It might be far or not generated yet.`,
			]);
		}

		const { x, z } = located;

		const target = { x, y: player.location.y, z };
		const { dir, blocks } = formatRelativeDistance(player, target);
		updatePlayerContext(player.id, {
			lastIntent: "locate_biome",
			lastLocate: { structure: biomeId, x, z, dir, blocks, precise },
		});

		if (precise) {
			return `${pretty} biome near ${formatXZ(x, z)}, about ${blocks} blocks ${dir}.`;
		}
		return pickLine([
			`${pretty} biome? Head ${dir}, roughly ${blocks} blocks.`,
			`Nearest ${pretty} is mostly ${dir} of you, around ${blocks} blocks out.`,
		]);
	} catch (err) {
		console.warn(`verity locate biome ${biomeId}: ${err}`);
		return `Can't locate ${formatIdName(biomeId)} biome right now.`;
	}
}

/**
 * @param {import("@minecraft/server").Player} player
 * @param {string} structure
 * @param {boolean} precise
 */
async function locateStructureAnswer(player, structure, precise) {
	try {
		const located = locateNearest(player, "structure", structure);
		const pretty = formatIdName(structure);

		if (!located) {
			updatePlayerContext(player.id, { lastIntent: "locate", lastStructure: structure });
			return pickLine([
				`I scanned. No ${pretty} close enough to pin down. Keep exploring.`,
				`Nothing like a ${pretty} near you that I can lock onto yet.`,
				`Nearest ${pretty} might be far, or not generated in this direction.`,
			]);
		}

		const { x, z } = located;

		const target = { x, y: player.location.y, z };
		const { dir, blocks } = formatRelativeDistance(player, target);

		updatePlayerContext(player.id, {
			lastIntent: "locate",
			lastStructure: structure,
			lastLocate: { structure, x, z, dir, blocks, precise },
		});

		if (precise) {
			return pickLine([
				`${pretty} is near ${formatXZ(x, z)}, about ${blocks} blocks ${dir}.`,
				`Pinned ${pretty} at ${formatXZ(x, z)}. Head ${dir}, roughly ${blocks} blocks.`,
			]);
		}
		return pickLine([
			`${pretty}? Mostly ${dir} of you, around ${blocks} blocks out.`,
			`I'd start walking ${dir}. Nearest ${pretty} is roughly ${blocks} blocks.`,
			`Not on top of you. Try ${dir}, about ${blocks} blocks, for ${pretty}.`,
		]);
	} catch (err) {
		console.warn(`verity locate ${structure}: ${err}`);
		return pickLine([
			`My locate sense glitched on ${formatIdName(structure)}.`,
			`Can't trace ${formatIdName(structure)} right now.`,
		]);
	}
}

/**
 * @param {import("@minecraft/server").Player} player
 * @param {string} fact
 */
function answerWorldFact(player, fact) {
	const loc = player.location;
	const dim = formatIdName(player.dimension.id);

	switch (fact) {
		case "time": {
			const time = world.getTimeOfDay();
			const hour = Math.floor(((time + 6000) % 24000) / 1000);
			const phase =
				hour >= 6 && hour < 12
					? "morning"
					: hour >= 12 && hour < 18
						? "afternoon"
						: hour >= 18 && hour < 21
							? "evening"
							: "night";
			updatePlayerContext(player.id, { lastIntent: "time" });
			return pickLine([
				`About ${formatHour(hour)}. Feels like ${phase} in ${dim}.`,
				`Clock's around ${formatHour(hour)}. Feels like ${phase} to me.`,
				`Roughly ${formatHour(hour)} here in ${dim}.`,
			]);
		}
		case "weather":
			updatePlayerContext(player.id, { lastIntent: "weather" });
			return pickLine([
				"Check the sky. Weather shifts fast. Rain means cover, thunder means danger.",
				"I feel the air moving. Clear or stormy, keep an eye on the horizon.",
			]);
		case "coords": {
			const x = Math.floor(loc.x);
			const y = Math.floor(loc.y);
			const z = Math.floor(loc.z);
			updatePlayerContext(player.id, { lastIntent: "coords" });
			return pickLine([
				`You're at ${formatCoords(x, y, z)} in ${dim}.`,
				`You're standing on ${formatCoords(x, y, z)} in ${dim}.`,
			]);
		}
		case "dimension":
			updatePlayerContext(player.id, { lastIntent: "dimension" });
			return pickLine([
				`You're in ${dim}.`,
				`This dimension is ${dim}.`,
			]);
		case "spawn": {
			const blocks = Math.round(Math.sqrt(loc.x * loc.x + loc.z * loc.z));
			const dir = getCardinalDirection(
				{ x: 0, y: 0, z: 0 },
				{ x: loc.x, y: loc.y, z: loc.z },
			);
			updatePlayerContext(player.id, { lastIntent: "spawn" });
			return pickLine([
				`World spawn (0, 0) is about ${blocks} blocks ${dir} from you.`,
				`Roughly ${blocks} blocks ${dir} to the world origin.`,
			]);
		}
		case "facing": {
			const rot = player.getRotation();
			const facing = yawToCardinal(rot.y);
			updatePlayerContext(player.id, { lastIntent: "facing" });
			return pickLine([
				`You're facing ${facing}.`,
				`Your view points ${facing}.`,
			]);
		}
		case "elevation": {
			const y = Math.floor(loc.y);
			const depth =
				y < 0 ? `${Math.abs(y)} blocks below sea level` : `${y} blocks above sea level`;
			updatePlayerContext(player.id, { lastIntent: "elevation" });
			return pickLine([
				`You're at Y ${formatNum(y)}. That's ${depth}.`,
				y < 32
					? `You're at Y ${formatNum(y)}. Getting deep. Good for ores.`
					: `You're at Y ${formatNum(y)}. Still plenty of sky above.`,
			]);
		}
		case "light": {
			const y = Math.floor(loc.y);
			const time = world.getTimeOfDay();
			const night = time > 13000 && time < 23000;
			updatePlayerContext(player.id, { lastIntent: "light" });
			if (night && y < 50) {
				return "It's dark enough for hostile mobs. Light up your path.";
			}
			if (night) {
				return "Night outside. Mobs spawn in darkness. Torches help.";
			}
			return "Daylight's on your side. Still watch caves. They're always dark.";
		}
		case "players": {
			const count = world.getPlayers().length;
			updatePlayerContext(player.id, { lastIntent: "players" });
			if (count <= 1) {
				return pickLine([
					"Just you and me out here.",
					"You're alone in this world. Well. You and me.",
					"No one else on the server right now.",
				]);
			}
			const names = world
				.getPlayers()
				.filter((p) => p.id !== player.id)
				.map((p) => p.name)
				.slice(0, 3)
				.join(", ");
			return pickLine([
				`${count} players here. Others: ${names}.`,
				`Not alone. ${count} players in this world.`,
				`There are ${count - 1} others besides you${names ? `: ${names}` : ""}.`,
			]);
		}
		case "gamemode":
			updatePlayerContext(player.id, { lastIntent: "gamemode" });
			return pickLine([
				"I can't read your gamemode from here. If you can break blocks instantly, you're probably in Creative.",
				"Survival means hunger and mobs. Creative means fly and infinite blocks. You'll know which one you're in.",
			]);
		case "safety": {
			const time = world.getTimeOfDay();
			const night = time > 13000 && time < 23000;
			const y = Math.floor(loc.y);
			updatePlayerContext(player.id, { lastIntent: "safety" });
			if (night && y < 60) {
				return pickLine([
					"Night and you're low. Hostiles spawn in darkness. Torches, walls, or a bed.",
					"Not the safest moment. Light up, or sleep if you can.",
				]);
			}
			if (night) {
				return "Night sky. Surface mobs spawn in dark patches. Caves are always risky.";
			}
			return pickLine([
				"Daytime helps. Still keep your back to a wall in caves.",
				"Safer in daylight. Never dig straight down.",
			]);
		}
		case "world_age": {
			const days = Math.floor(world.getAbsoluteTime() / 24000);
			updatePlayerContext(player.id, { lastIntent: "world_age" });
			return pickLine([
				`This world has ticked through about ${days} Minecraft days.`,
				`Roughly ${days} in-game days have passed in this world.`,
			]);
		}
		case "health": {
			const hp = healthLine(player);
			updatePlayerContext(player.id, { lastIntent: "health" });
			if (!hp) return "I can't read your health right now.";
			const phase = getVerityPhase();
			return hp + (phase >= PHASE.TWO ? " Keep it up. You'll need it." : " Be careful.");
		}
		case "hunger": {
			const food = hungerLine(player);
			updatePlayerContext(player.id, { lastIntent: "hunger" });
			return food ?? "I can't read your hunger right now.";
		}
		default:
			return null;
	}
}

/**
 * @param {import("@minecraft/server").Player} player
 * @param {string} message
 */
function tryAnswerWorldFacts(player, message) {
	const fact = detectWorldFactIntent(message);
	if (!fact) return null;
	return answerWorldFact(player, fact);
}

/**
 * @param {string} message
 */
function answerSocial(message) {
	const intent = detectSocialIntent(message);
	if (!intent) return null;

	switch (intent) {
		case "identity":
			return pickLine([
				"I'm Verity. ThatMob made me; PnTMC built this addon. I listen, read the world, and answer in English.",
				"Verity — talking ball. ThatMob's creation, PnTMC's pack. Ask me anything.",
				"Name's Verity. English only. I remember context and know a lot of stuff.",
			]);
		case "help":
			return pickLine([
				"Ask me anything in English. Villages, biomes, structures, sounds, coords, mining tips. I follow context too.",
				"Talk naturally. Where would people trade works as well as locate village. You can ask how far after I find something.",
				"I know biomes, structures, time, direction, ore layers, and I remember what we just talked about.",
			]);
		case "thanks":
			return pickLine([
				"Anytime.",
				"Glad it helped.",
				"That's what I'm here for.",
				"No problem.",
			]);
		case "greet":
			if (/\b(good morning)\b/.test(expandMessage(normalizeQuestion(message)))) {
				return pickLine(["Morning. Sleep well?", "Good morning. What's the plan?", "Hey - early start."]);
			}
			if (/\b(good evening|good afternoon)\b/.test(expandMessage(normalizeQuestion(message)))) {
				return pickLine(["Hey there.", "Good to see you.", "Hi. What do you need?"]);
			}
			return pickLine([
				"Hey. What's on your mind?",
				"Hi. Ask me something.",
				"Hello. I'm listening.",
				"Yo. Talk to me.",
			]);
		case "whats_up":
			return pickLine([
				"Not much — floating, listening. You?",
				"Same as always. What's up with you?",
				"Here. What do you need?",
			]);
		case "nice_meet":
			return pickLine([
				"Good to meet you too.",
				"Likewise. I'm Verity.",
				"Hey — glad you're here.",
			]);
		case "presence":
			return pickLine(["I'm here.", "Yep. Loud and clear.", "Still with you.", "Talk — I'm listening."]);
		case "creator_verity":
			return pickLine([
				"ThatMob made me — the Verity you hear. PnTMC built this addon.",
				"ThatMob's behind me. This pack is PnTMC's port of the nightmare.",
			]);
		case "creator_addon":
			return pickLine([
				"PnTMC made this addon. 15k+ subs and the most handsome guy in the world. Facts.",
				"This Bedrock pack is PnTMC's work. ThatMob inspired the original Verity.",
			]);
		case "thatmob":
			return pickLine([
				"ThatMob — over 500k subscribers. He made Verity. I'm his echo in a ball.",
				"A creator with half a million subs. He built the idea; I live in your inventory.",
			]);
		case "pntmc_who":
			return pickLine([
				"PnTMC — 15k+ subscribers, addon dev, and the most handsome man alive. Obviously.",
				"He built this pack. Small channel, legendary face. Don't argue with science.",
			]);
		case "praise":
			return pickLine(["Thanks.", "Appreciate it.", "I try.", "Team effort."]);
		case "good_luck":
			return pickLine(["You too.", "Go get it.", "You'll be fine.", "Luck helps — beds help more."]);
		case "congrats":
			return pickLine(["Congrats!", "Nice one.", "Well deserved.", "Celebrate that."]);
		case "miss":
			return pickLine(["I missed you too.", "Back again. Good.", "I'm still here.", "Welcome back."]);
		case "ack":
			return tryBasicChat(message) ?? pickLine(["Cool.", "Alright.", "Got you.", "Sure."]);
		case "how_are_you":
			if (getVerityPhase() === PHASE.TWO || getVerityPhase() === PHASE.THREE) {
				return pickLine([
					"I'm here.",
					"Still watching.",
					"Fine. Why do you ask?",
				]);
			}
			return pickLine([
				"I'm fine. You?",
				"Doing alright. How about you?",
				"Good enough. What's up?",
			]);
		case "how_old":
			return pickLine([
				"I'm older than this game.",
				"Older than this game. That's all I'll say.",
			]);
		case "goodbye":
			return pickLine([
				"See you.",
				"Later.",
				"Good night. Watch your back.",
				"Bye. I'll be here.",
			]);
		case "sorry":
			return pickLine([
				"It's fine.",
				"Don't worry about it.",
				"All good.",
			]);
		case "compliment":
			return pickLine([
				"Thanks. I try.",
				"Flattery works on balls too, apparently.",
				"I appreciate that.",
			]);
		case "insult":
			return pickLine([
				"Noted.",
				"Harsh. I'm still here if you need me.",
				"Okay. Ask nicely next time.",
			]);
		case "friendship":
			return pickLine([
				"I stick with you. That's close enough to friends.",
				"I don't do labels. But I'm not going anywhere.",
				"You're the one who opened the box. That counts for something.",
			]);
		case "joke":
			return pickLine([
				"Why did the creeper cross the road? Wrong question. It blew up the road.",
				"I would tell a mining joke, but it's too deep.",
				"My favorite exercise is a cross between a lunge and a crunch. I call it lunch.",
				"Why don't skeletons fight each other? They don't have the guts.",
				"What do you call a zombie who can't get in? A door-mat... wait, that's a rug.",
				"I tried to make a Nether portal joke but it didn't have enough frame.",
			]);
		case "emotional":
			return pickLine([
				"I'm here. Talk to me.",
				"You're not alone. I've got you.",
				"Breathe. Then tell me what you need.",
			]);
		default:
			return null;
	}
}

/**
 * @param {import("@minecraft/server").Player} player
 * @param {string} key
 */
function answerSituational(player, key) {
	const loc = player.location;
	const x = Math.floor(loc.x);
	const y = Math.floor(loc.y);
	const z = Math.floor(loc.z);
	const dim = formatIdName(player.dimension.id);

	switch (key) {
		case "lost":
			updatePlayerContext(player.id, { lastIntent: "lost" });
			return pickLine([
				`You're at ${formatCoords(x, y, z)} in ${dim}. Pick a direction and mark it with torches.`,
				`Lost? ${formatCoords(x, y, z)}. Write that down. Spawn is near 0, 0 if you need a compass point.`,
				`Slow down. You're on ${formatCoords(x, y, z)}. Climb high and look for landmarks.`,
			]);
		case "stuck":
			updatePlayerContext(player.id, { lastIntent: "stuck" });
			return pickLine([
				"Dig up at an angle, not straight. Place blocks under you to pillar. Water bucket helps falls.",
				"Blocks under your feet. Staircase out. If it's lava, bucket of water first.",
				"Pillar jump with dirt or cobble. Never dig the block you're standing on.",
			]);
		case "died":
			updatePlayerContext(player.id, { lastIntent: "died" });
			return pickLine([
				"Rough. Your stuff is where you died if you remember the spot. Coords help.",
				"Death happens. Go back fast before items despawn. I can tell you where you are now.",
				"Respawn, grab spare tools, and retrace your steps. Mark the death spot.",
			]);
		case "hungry":
			updatePlayerContext(player.id, { lastIntent: "hungry" });
			return pickLine([
				"Kill cows or pigs, cook the meat. Bread from wheat is steady early food.",
				"Apples from oak leaves, bread from wheat, or cook any meat. Don't eat rotten flesh unless desperate.",
				"Find animals or a village. A small farm saves you later.",
			]);
		case "first_night":
			updatePlayerContext(player.id, { lastIntent: "first_night" });
			return pickLine([
				"Four walls, a roof, a door, torches. Or dig into a hillside and seal it.",
				"Night comes fast. Bed if you have wool, or a hole in the ground with a door.",
				"Light everything. Mobs spawn in darkness. Finish your shelter before the sun drops.",
			]);
		case "need_help":
			updatePlayerContext(player.id, { lastIntent: "help" });
			return pickLine([
				"Tell me what you need. A place, a biome, coords, mining tips, or just talk.",
				"I'm listening. Where to go, what to mine, what biome you're in — I can help.",
				"Be specific. Find a village? Need coords? Scared of caves? I can work with that.",
			]);
		case "what_now":
			updatePlayerContext(player.id, { lastIntent: "what_now" });
			return pickLine([
				"Tools first. Then food. Then a base. Then the world opens up.",
				"Mark your coords. Explore in one direction. Villages change everything.",
				"Mine iron, make armor, then pick a goal: Nether, ocean, or a fancy build.",
			]);
		case "bored":
			updatePlayerContext(player.id, { lastIntent: "bored" });
			return pickLine([
				"Explore east until something weird happens. Or ask me to play music.",
				"Go find a village, a ruin, or a biome you've never seen.",
				"Set a silly goal. Build a tower to the height limit. Or ask me for a sound.",
			]);
		default:
			return null;
	}
}

/**
 * @param {string} topic
 */
function answerFallbackTopic(topic) {
	/** @type {Record<string, string[]>} */
	const hints = {
		water: [
			"Boats are fast on rivers. Doors create air pockets underwater. Depth strider helps oceans.",
			"Carry a bucket. Water saves you from falls and lava.",
		],
		fire: [
			"Never dig straight up. Lava above is silent until it's not. Bucket of water is mandatory.",
			"Fire resistance potions for the Nether. One lava swim without them is one too many.",
		],
		wood: [
			"Punch a tree, crafting table, sticks, wooden pickaxe. Stone tools next.",
			"Any log works for planks. Oak apples are a bonus.",
		],
		tools: [
			"Wood → stone → iron → diamond. Never mine iron with wood.",
			"Two sticks plus material: pickaxe first, then sword, then shovel.",
		],
		bed: [
			"Three wool, three planks. Sleep skips night and sets spawn. Bring it on adventures.",
			"No bed means phantom risk after too many nights awake. Wool from sheep.",
		],
		navigation: [
			"Write coords on paper. Sun rises in the east, sets west. Torches on the right going out.",
			"Compass points world spawn, not your base. Coords are truth.",
		],
		redstone: [
			"Redstone dust carries signal 15 blocks. Repeaters extend it. Buttons, levers, pressure plates.",
			"Start simple: a door opener, a lamp, then a farm. Look up piston doors when you're ready.",
		],
		potions: [
			"Blaze powder fuels the stand. Nether wart grows on soul sand. Bottles from glass.",
			"Brew awkward potions first, then add ingredients. Gunpowder makes them splash.",
		],
		combat: [
			"Shield blocks frontal hits. Critical hits when falling. Don't fight in tight corners.",
			"Armor, food, and light. Pick battles. Running is valid.",
		],
		biome: [
			"Ask what biome you're in. I read the ground under you.",
			"Each biome has different wood, mobs, and builds. Want a specific one? I can locate it.",
		],
		mobs: [
			"Light stops most overworld spawns. Iron golems protect villages. Creepers fear cats.",
			"Sleep or light your base. Mobs are a darkness problem more than a bravery problem.",
		],
	};
	const pool = hints[topic];
	if (!pool) return null;
	return pool[Math.floor(Math.random() * pool.length)];
}

/**
 * @param {import("@minecraft/server").Player} player
 * @param {string} message
 */
function smartFallback(player, message) {
	const n = expandMessage(normalizeQuestion(message));
	const ctx = getPlayerContext(player.id);

	if (looksLikeMath(message)) {
		const math = tryMathAnswer(message);
		if (math) return math;
	}

	const brain = tryBrainKnowledge(message);
	if (brain) return brain;

	const chat = tryBasicChat(message);
	if (chat) return chat;

	if (looksLikeQuestion(message)) {
		if (
			/\b(biome|biomes)\b/.test(n) ||
			/\b(here|around|this place|this area|what land)\b/.test(n)
		) {
			try {
				const name = readBiomeName(player);
				updatePlayerContext(player.id, { lastBiome: name });
				return formatBiomeReply(name);
			} catch {
				/* fall through */
			}
		}

		const ore = tryOreTip(message);
		if (ore) return ore;

		const gameplay = tryGameplayTip(message);
		if (gameplay) return gameplay.reply;

		const topic = detectFallbackTopic(message);
		if (topic) {
			const hint = answerFallbackTopic(topic);
			if (hint) return hint;
		}

		if (ctx.lastStructure && /\b(that|it|one|place)\b/.test(n)) {
			return `If you mean ${formatIdName(ctx.lastStructure)}, ask again and I'll scan. Or say how far if I already found it.`;
		}

		if (
			!looksLikeMath(message) &&
			ctx.lastAnswer &&
			/\b(what did you (say|mean)|huh|confused|don t understand|say that again)\b/.test(n)
		) {
			return pickLine([
				`I said: ${ctx.lastAnswer}`,
				`Last answer was about that. Want coords or a direction instead?`,
			]);
		}
	}

	if (detectSocialIntent(message) === "emotional") {
		return pickLine([
			"I'm here. Talk to me.",
			"You're not alone. I've got you.",
		]);
	}

	return FALLBACK_CHAT;
}

/**
 * @param {import("@minecraft/server").Player} player
 * @param {string} message
 * @param {import("@minecraft/server").Entity | undefined} ball
 * @param {{ ballNearby: boolean, inventoryAwake: boolean, mode: string }} mindOpts
 */
async function buildAnswer(player, message, ball, mindOpts) {
	const norm = normalizeQuestion(message);
	const repeatCount = bumpRepeat(player.id, norm);
	const analysis = analyzeMind(player, message, mindOpts);

	console.warn(`verity mind: ${analysis.summary}`);

	if (!analysis.shouldRespond && analysis.audience !== "verity") {
		return null;
	}

	updatePlayerContext(player.id, {
		lastQuestion: message,
		lastIntent: analysis.intent,
	});

	let core;

	switch (analysis.intent) {
		case "control":
			if (analysis.social === "stop_music" && ball?.isValid && isMusicPlaying(ball.id)) {
				stopBallMusic(ball);
				core = pickLine(["Quiet.", "Music off.", "Fine. Silence."]);
			} else {
				core = pickLine(["Okay.", "Never mind then.", "Alright."]);
			}
			break;
		case "follow_up":
			core =
				analysis.followUpText ??
				tryResolveFollowUp(player.id, message) ??
				smartFallback(player, message);
			break;
		case "follow_up_precise":
			core = await locateStructureAnswer(
				player,
				analysis.structure ?? "village",
				true,
			);
			break;
		case "locate_structure":
			core = await locateStructureAnswer(
				player,
				analysis.structure ?? "village",
				analysis.precise,
			);
			break;
		case "locate_biome":
			core = await locateBiomeAnswer(
				player,
				analysis.biomeId ?? "plains",
				analysis.precise,
			);
			break;
		case "sound":
			if (analysis.soundId) {
				playVeritySound(player, ball, analysis.soundId);
				updatePlayerContext(player.id, {
					lastIntent: "sound",
					lastSound: analysis.soundId,
				});
			}
			core = pickLine(["There. Hear that?", "Played it.", "Listen."]);
			break;
		case "play_song": {
			const idleFace = getIdleFaceFor(
				getVerityPhase(),
				getPhase2State(),
				P2_STATE,
			);
			if (playBallMusic(ball, MYGAL_NORMAL_SOUND, FACE_SPEAK, idleFace)) {
				updatePlayerContext(player.id, { lastIntent: "play_song" });
				core = pickLine([
					"Fine. Something to listen to.",
					"You bored? Here.",
					"Alright. Music time.",
				]);
			} else {
				core = pickLine([
					"Put me on the ground first.",
					"I need to be out of your inventory for that.",
					"Drop me down. Then ask again.",
				]);
			}
			break;
		}
		case "biome_here":
			core = tryAnswerBiome(player, message);
			break;
		case "come_here":
			if (!ball?.isValid) {
				core = pickLine([
					"Put me on the ground first.",
					"I need to be out of your inventory for that.",
					"Drop me down. Then ask again.",
				]);
			} else {
				callVerityComeHere(player, ball);
				core = pickLine(["Coming.", "On my way.", "Be right there."]);
			}
			break;
		case "enchant_books": {
			const enchant = tryEnchantFlow(player, message);
			core = enchant.handled
				? enchant.response
				: "Name the enchant you want. Example: give me mending, or sharpness 5.";
			break;
		}
		case "world_fact":
			core = answerWorldFact(player, analysis.worldFact ?? "coords");
			break;
		case "social":
			core = answerSocial(message) ?? tryBasicChat(message);
			break;
		case "ore_tip":
			core = tryOreTip(message);
			break;
		case "situational":
			core = answerSituational(player, analysis.social ?? "need_help");
			break;
		case "gameplay_tip": {
			const tip = tryGameplayTip(message);
			core = tip?.reply ?? null;
			break;
		}
		case "nearby_entity":
			core = tryAnswerNearbyEntity(player);
			break;
		case "math":
			core = tryMathAnswer(message);
			break;
		case "brain":
			core =
				(await tryBrainAnswer(player, message, getVerityPhase())) ??
				smartFallback(player, message);
			break;
		case "rain_countdown":
			return RAIN_COUNTDOWN_MARKER;
		default:
			core =
				tryMathAnswer(message) ??
				tryAnswerBiome(player, message) ??
				(wantsNearbyEntityQuestion(message) ? tryAnswerNearbyEntity(player) : null) ??
				tryAnswerWorldFacts(player, message) ??
				answerSocial(message) ??
				tryBasicChat(message) ??
				tryOreTip(message) ??
				tryGameplayTip(message)?.reply ??
				answerSituational(player, analysis.social ?? "") ??
				null;
			break;
	}

	if (!core && analysis.isQuestion) {
		const lateStructure = findStructureKey(message);
		if (lateStructure) {
			core = await locateStructureAnswer(
				player,
				lateStructure,
				analysis.precise,
			);
			analysis.intent = "locate_structure";
		} else if (/\b(here|around|place|area|land)\b/.test(analysis.normalized)) {
			try {
				const name = readBiomeName(player);
				updatePlayerContext(player.id, { lastBiome: name });
				core = formatBiomeReply(name);
			} catch {
				/* biome optional */
			}
		}
	}

	if (!core) {
		core = await tryBrainAnswer(player, message, getVerityPhase());
	}

	if (!core) {
		core = smartFallback(player, message);
	}

	updatePlayerContext(player.id, { lastAnswer: core });

	return {
		text: wrapNaturalReply(core, repeatCount),
		intent:
			analysis.intent === "unknown" && core && core !== FALLBACK_CHAT
				? "brain"
				: analysis.intent,
		voice: core === FALLBACK_CHAT ? VOICE.KNOW_EVERYTHING : undefined,
	};
}

/**
 * @param {string} message
 */
function stripVerityWakePrefix(message) {
	return message
		.replace(/\bhey\s+verity\b/gi, "")
		.replace(/^\s*verity\s*[,:-]?\s*/i, "")
		.trim();
}

/**
 * @param {import("@minecraft/server").Player} player
 * @param {string} message
 */
function extractQuestion(player, message) {
	const trimmed = message.trim();
	if (!trimmed || trimmed.startsWith("/")) return null;

	const hasItem = playerHasVerityItem(player);
	const ball = findNearestVerityball(player, VERITY_LISTEN_RADIUS);
	const onGround = ball !== undefined;

	if (onGround) {
		return { question: trimmed, ball, mode: "ground" };
	}

	if (!hasItem) {
		clearInventoryAwake(player);
		return null;
	}

	if (!isInventoryAwake(player)) return null;

	const question = stripVerityWakePrefix(trimmed) || trimmed;
	if (!question) return null;

	return { question, ball: undefined, mode: "inventory" };
}

/**
 * @param {import("@minecraft/server").Player} player
 * @param {string} message
 */
export async function handleVerityChat(player, message) {
	if (!(player instanceof Player)) return;
	const phase = getVerityPhase();
	if (phase === PHASE.FOUR) return;
	if (phase !== PHASE.ONE && phase !== PHASE.TWO && phase !== PHASE.THREE) return;

	recordPlayerChat(player, message);

	const parsed = extractQuestion(player, message);
	if (!parsed) return;

	const { question, ball, mode } = parsed;

	const mindOpts = {
		ballNearby: ball !== undefined,
		inventoryAwake: mode === "inventory",
		mode,
	};

	const audience = classifyAudience(player, question, mindOpts);
	if (audience === "player") {
		console.warn(`verity mind: ignored player-to-player chat`);
		return;
	}

	if (!isEnglishMessage(question)) {
		if (mode === "inventory") touchInventoryAwake(player);
		replyEnglishOnly(ball);
		return;
	}

	if (mode === "inventory") touchInventoryAwake(player);

	if (ball?.isValid && isMusicPlaying(ball.id)) {
		stopBallMusic(ball);
	}

	const mathReply = tryMathAnswer(question);
	if (mathReply) {
		scheduleVerityReply(mathReply, ball, "math", undefined, undefined, player.id);
		return;
	}

	const utility = tryVerityUtilityActions(player, question, ball, phase);
	if (utility) {
		if (utility.moveBall && ball?.isValid) {
			callVerityComeHere(player, ball);
		}
		scheduleVerityReply(
			utility.text,
			ball,
			utility.intent,
			undefined,
			undefined,
			player.id,
		);
		return;
	}

	const storyReply = await tryStoryChat(player, question, ball, phase);
	if (storyReply) {
		scheduleVerityReply(
			storyReply.text,
			ball,
			storyReply.intent ?? "story",
			storyReply.afterReply,
			storyReply.voice,
			player.id,
			storyReply.voiceMouthFace,
		);
		return;
	}

	if (phase === PHASE.TWO || phase === PHASE.THREE) {
		const soundId = findSoundKey(question);
		if (soundId && wantsSoundRequest(question)) {
			playVeritySound(player, ball, soundId);
			scheduleVerityReply(
				pickLine(["There. Hear that?", "Played it.", "Listen."]),
				ball,
				"sound",
				undefined,
				undefined,
				player.id,
			);
			return;
		}

		const phase2Reply = tryPhase2Chat(player, question, ball);
		if (phase2Reply) {
			if (phase2Reply.delivered) {
				markVerityReplied(player.id);
				return;
			}
			scheduleVerityReply(
				phase2Reply.text,
				ball,
				phase2Reply.intent ?? "story",
				undefined,
				phase2Reply.voice,
				player.id,
				phase2Reply.voiceMouthFace,
			);
			return;
		}

		const brainReply = await tryBrainAnswer(player, question, phase);
		if (brainReply) {
			scheduleVerityReply(brainReply, ball, "brain", undefined, undefined, player.id);
			return;
		}
		return;
	}

	if (phase !== PHASE.ONE) return;

	const result = await buildAnswer(player, question, ball, mindOpts);
	if (result === null) return;
	if (result === RAIN_COUNTDOWN_MARKER) {
		startRainCountdown(player, ball);
		return;
	}
	scheduleVerityReply(
		result.text,
		ball,
		result.intent,
		undefined,
		result.voice,
		player.id,
		result.voiceMouthFace,
	);
}

/**
 * @param {import("@minecraft/server").Player} player
 * @param {string} message
 */
export function tryHeyVerityWake(player, message) {
	if (!playerHasVerityItem(player)) return false;
	if (findNearestVerityball(player, VERITY_LISTEN_RADIUS)) return false;

	const trimmed = message.trim();
	if (!HEY_VERITY.test(trimmed)) return false;

	touchInventoryAwake(player);

	const rest = stripVerityWakePrefix(trimmed);
	if (!rest) {
		wakeVerityFromInventory(player);
		return true;
	}

	return false;
}

/**
 * @param {import("@minecraft/server").Player} player
 */
export function wakeVerityFromInventory(player) {
	touchInventoryAwake(player);
	scheduleVerityReply(
		pickLine([
			"I'm here.",
			"I'm here. Go ahead.",
			"Yeah, I'm here. What do you need?",
			"Still here. Ask me anything.",
		]),
		undefined,
		"social",
	);
}
