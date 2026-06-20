import { world } from "@minecraft/server";
import { wantsComeHere, wantsEnchantBooks } from "./verity_actions.js";
import { getVerityPhase, PHASE } from "./verity_phases.js";
import { looksLikeMath } from "./verity_math.js";
import { tryKnowledgeAnswer } from "./verity_knowledge.js";
import {
	detectControlIntent,
	detectFallbackTopic,
	detectGameplayIntent,
	detectSocialIntent,
	detectSituationalIntent,
	detectWorldFactIntent,
	expandMessage,
	findBiomeLocateKey,
	findSoundKey,
	findStructureKey,
	getPlayerContext,
	looksLikeQuestion,
	normalizeQuestion,
	tokenize,
	tryGameplayTip,
	tryResolveFollowUp,
	wantsBiomeInfo,
	wantsNearbyEntityQuestion,
	wantsPlaySong,
	wantsPreciseLocate,
	wantsRainCountdown,
	wantsSoundRequest,
} from "./verity_intent.js";

export {
	describeNearbyEntity,
	detectControlIntent,
	detectFallbackTopic,
	detectGameplayIntent,
	detectSocialIntent,
	detectSituationalIntent,
	detectWorldFactIntent,
	expandMessage,
	findBiomeLocateKey,
	findSoundKey,
	findStructureKey,
	findTargetEntityNearPlayer,
	getPlayerContext,
	looksLikeQuestion,
	MYGAL_NORMAL_SOUND,
	normalizeQuestion,
	tokenize,
	tryGameplayTip,
	tryOreTip,
	tryResolveFollowUp,
	updatePlayerContext,
	wantsBiomeInfo,
	wantsNearbyEntityQuestion,
	wantsPlaySong,
	wantsPreciseLocate,
	wantsRainCountdown,
	wantsSoundRequest,
} from "./verity_intent.js";

/** @typedef {'verity'|'player'|'uncertain'} ChatAudience */
/** @typedef {'follow_up'|'follow_up_precise'|'locate_structure'|'locate_biome'|'biome_here'|'sound'|'play_song'|'world_fact'|'social'|'ore_tip'|'rain_countdown'|'situational'|'gameplay_tip'|'control'|'nearby_entity'|'come_here'|'enchant_books'|'math'|'brain'|'unknown'} MindIntent */

/**
 * @typedef {object} MindAnalysis
 * @property {MindIntent} intent
 * @property {number} confidence
 * @property {string} summary
 * @property {ChatAudience} audience
 * @property {string} situation
 * @property {string} normalized
 * @property {string[]} tokens
 * @property {boolean} isQuestion
 * @property {boolean} precise
 * @property {boolean} shouldRespond
 * @property {string} [structure]
 * @property {string} [biomeId]
 * @property {string} [soundId]
 * @property {string} [worldFact]
 * @property {string} [social]
 * @property {string} [followUpText]
 * @property {string} [tone]
 */

const SEEKING =
	/\b(where|find|locate|nearest|closest|nearby|search|looking for|trying to find|how do i get|how far|direction|way to|help me find)\b/;

const ORE_HINT =
	/\b(mine|mining|dig|ore|diamond|iron|gold|copper|lapis|redstone|netherite|ancient debris|emerald|layer|y level|depth)\b/;

const P2P_GROUP =
	/\b(guys|everyone|team|bro|dude|man|yo guys|all of you|you guys|come on guys)\b/;

const P2P_THIRD =
	/\b(he|she|they|him|her|them)\s+(said|says|went|goes|is|are|was|were|did|does|has|have)\b/;

/** @type {Map<string, number>} playerId -> tick when Verity last replied to them */
const lastVerityReplyTick = new Map();

/** @type {{ id: string, name: string, text: string, tick: number }[]} */
const recentChat = [];

const RECENT_CHAT_MAX = 24;
const VERITY_FOLLOWUP_WINDOW = 200;

/**
 * @param {string} playerId
 */
export function markVerityReplied(playerId) {
	lastVerityReplyTick.set(playerId, Date.now());
}

/**
 * @param {import("@minecraft/server").Player} sender
 * @param {string} message
 */
export function recordPlayerChat(sender, message) {
	recentChat.push({
		id: sender.id,
		name: sender.name,
		text: message.trim(),
		tick: Date.now(),
	});
	while (recentChat.length > RECENT_CHAT_MAX) recentChat.shift();
}

/**
 * @returns {string}
 */
function getSituationLabel() {
	const phase = getVerityPhase();
	if (phase === PHASE.ONE) return "phase1_helper";
	if (phase === PHASE.TWO) return "phase2_uneasy";
	if (phase === PHASE.THREE) return "phase3";
	if (phase === PHASE.FOUR) return "phase4";
	return "unknown";
}

/**
 * @param {import("@minecraft/server").Player} player
 * @param {string} raw
 */
function messageNamesOtherPlayer(player, raw) {
	const lower = raw.toLowerCase();
	for (const other of world.getPlayers()) {
		if (other.id === player.id) continue;
		const name = other.name.toLowerCase().trim();
		if (!name || name.length < 2) continue;
		if (lower.startsWith(name) || lower.startsWith(`hey ${name}`)) return true;
		if (lower.startsWith(`@${name}`)) return true;
		if (new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(lower)) {
			if (!/\b(you|your|verity)\b/.test(lower)) return true;
		}
	}
	return false;
}

/**
 * @param {import("@minecraft/server").Player} player
 * @param {string} message
 * @param {{ ballNearby: boolean, inventoryAwake: boolean, mode: string }} opts
 * @returns {ChatAudience}
 */
export function classifyAudience(player, message, opts) {
	const raw = message.trim();
	const n = expandMessage(normalizeQuestion(message));
	const others = [...world.getPlayers()].filter((p) => p.id !== player.id);
	const multi = others.length > 0;

	if (/\bhey\s+verity\b/i.test(raw) || /^verity\b[,:\s!?]/i.test(raw)) {
		return "verity";
	}

	if (messageNamesOtherPlayer(player, raw)) return "player";

	if (multi && P2P_GROUP.test(n) && !/\b(you|your|verity)\b/.test(n)) {
		return "player";
	}

	if (multi && P2P_THIRD.test(n) && !/\b(you|your|verity)\b/.test(n)) {
		return "player";
	}

	const lastReply = lastVerityReplyTick.get(player.id) ?? 0;
	const recentVerity =
		Date.now() - lastReply < VERITY_FOLLOWUP_WINDOW * 50;

	if (/\b(you|your|u)\b/.test(n)) {
		if (opts.ballNearby || opts.inventoryAwake || recentVerity) return "verity";
	}

	if (looksLikeQuestion(message)) {
		if (opts.inventoryAwake) return "verity";
		if (opts.ballNearby && (recentVerity || /\b(you|verity|help|find|where|what|how)\b/.test(n))) {
			return "verity";
		}
		if (opts.ballNearby && !multi) return "verity";
	}

	if (detectSocialIntent(message) && (opts.inventoryAwake || opts.ballNearby)) {
		if (/\b(you|verity)\b/.test(n) || opts.inventoryAwake) return "verity";
		if (!multi && opts.ballNearby) return "verity";
	}

	if (opts.inventoryAwake && raw.length > 0 && !messageNamesOtherPlayer(player, raw)) {
		return "verity";
	}

	if (opts.ballNearby && recentVerity) return "verity";

	if (opts.ballNearby && looksLikeQuestion(message) && !multi) return "verity";

	if (
		opts.ballNearby &&
		(detectSituationalIntent(message) || detectSocialIntent(message) === "emotional")
	) {
		return "verity";
	}

	if (multi && opts.ballNearby && !/\b(you|your|verity|help|find|where)\b/.test(n)) {
		return "player";
	}

	return "uncertain";
}

/**
 * @param {ChatAudience} audience
 * @param {{ ballNearby: boolean, inventoryAwake: boolean, mode: string }} opts
 */
function audienceShouldRespond(audience, opts) {
	if (audience === "player") return false;
	if (audience === "verity") return true;
	if (audience === "uncertain") {
		if (opts.inventoryAwake) return true;
		if (opts.ballNearby && opts.mode === "ground") return false;
		return false;
	}
	return false;
}

/**
 * @param {string} n
 */
function detectTone(n) {
	if (/\b(please|thanks|thank you|sorry)\b/.test(n)) return "polite";
	if (/\b(urgent|quick|fast|hurry|asap|help me|please help)\b/.test(n)) return "urgent";
	if (/\b(maybe|perhaps|i think|not sure|wondering)\b/.test(n)) return "curious";
	if (/\b(lol|haha|funny|joke|bored)\b/.test(n)) return "playful";
	if (/\b(stupid|hate|shut up|annoying|worst|useless)\b/.test(n)) return "hostile";
	if (/\b(scared|afraid|lost|stuck|help|worried|lonely)\b/.test(n)) return "distressed";
	return "neutral";
}

/**
 * @param {import("@minecraft/server").Player} player
 * @param {string} message
 * @param {{ ballNearby: boolean, inventoryAwake: boolean, mode: string }} opts
 * @returns {MindAnalysis}
 */
export function analyzeMind(player, message, opts) {
	const ctx = getPlayerContext(player.id);
	const normalized = expandMessage(normalizeQuestion(message));
	const tokens = tokenize(normalized);
	const isQuestion = looksLikeQuestion(message);
	const precise = wantsPreciseLocate(message);
	const tone = detectTone(normalized);
	const soundReq = wantsSoundRequest(message);
	const songReq = wantsPlaySong(message);
	const audience = classifyAudience(player, message, opts);
	const situation = getSituationLabel();

	/** @type {{ intent: MindIntent, score: number, extra?: Partial<MindAnalysis> }[]} */
	const ranked = [];

	const followRaw = tryResolveFollowUp(player.id, message);
	if (followRaw) {
		if (followRaw.startsWith("__LOCATE_PRECISE__:")) {
			ranked.push({
				intent: "follow_up_precise",
				score: 0.97,
				extra: { structure: followRaw.split(":")[2], precise: true },
			});
		} else if (followRaw.startsWith("__LOCATE_AGAIN__:")) {
			ranked.push({
				intent: "locate_structure",
				score: 0.92,
				extra: { structure: followRaw.split(":")[2], precise },
			});
		} else if (followRaw.startsWith("__REPLAY_SOUND__:")) {
			ranked.push({
				intent: "sound",
				score: 0.95,
				extra: { soundId: followRaw.split(":").slice(2).join(":") },
			});
		} else if (followRaw.startsWith("__REPEAT_LAST__:")) {
			ranked.push({
				intent: "follow_up",
				score: 0.9,
				extra: { followUpText: "Ask that again clearly. I remember you, not every word." },
			});
		} else {
			ranked.push({
				intent: "follow_up",
				score: 0.94,
				extra: { followUpText: followRaw },
			});
		}
	}

	const control = detectControlIntent(message);
	if (control) ranked.push({ intent: "control", score: 0.99, extra: { social: control } });

	if (wantsComeHere(message)) {
		ranked.push({ intent: "come_here", score: 0.96 });
	}

	if (wantsEnchantBooks(message) && getVerityPhase() === PHASE.ONE) {
		ranked.push({ intent: "enchant_books", score: 0.94 });
	}

	if (looksLikeMath(message)) {
		ranked.push({ intent: "math", score: 0.97 });
	}

	if (tryKnowledgeAnswer(message)) {
		let score = 0.94;
		if (SEEKING.test(normalized) || findStructureKey(message) || findBiomeLocateKey(message)) {
			score = 0.58;
		}
		ranked.push({ intent: "brain", score });
	} else if (isQuestion && !soundReq && !songReq) {
		ranked.push({ intent: "brain", score: 0.52 });
	}

	if (songReq) ranked.push({ intent: "play_song", score: 0.96 });
	if (wantsRainCountdown(message)) ranked.push({ intent: "rain_countdown", score: 0.93 });

	const soundId = findSoundKey(message);
	if (soundId && soundReq) {
		ranked.push({ intent: "sound", score: 0.98, extra: { soundId } });
	} else if (soundId && !SEEKING.test(normalized)) {
		ranked.push({ intent: "sound", score: 0.72, extra: { soundId } });
	}

	if (!soundReq) {
		const structure = findStructureKey(message);
		if (structure) {
			let score = 0.82;
			if (SEEKING.test(normalized)) score += 0.1;
			if (isQuestion) score += 0.04;
			if (ctx.lastIntent === "locate" && /\b(that|it|same|again|one)\b/.test(normalized)) {
				score += 0.06;
			}
			ranked.push({
				intent: "locate_structure",
				score: Math.min(score, 0.99),
				extra: { structure, precise },
			});
		}

		const biomeId = findBiomeLocateKey(message);
		if (biomeId) {
			ranked.push({
				intent: "locate_biome",
				score: SEEKING.test(normalized) ? 0.88 : 0.75,
				extra: { biomeId, precise },
			});
		}
	}

	if (wantsBiomeInfo(message) && !soundReq) {
		let biomeScore = 0.72;
		if (/\b(biome|biomes)\b/.test(normalized)) {
			biomeScore = 0.97;
		} else if (/\b(here|around|this place|under my feet)\b/.test(normalized)) {
			biomeScore = 0.86;
		}
		ranked.push({
			intent: "biome_here",
			score: biomeScore,
		});
	}

	if (
		wantsNearbyEntityQuestion(message) &&
		!soundReq &&
		!/\b(biome|biomes)\b/.test(normalized) &&
		(opts.ballNearby || opts.inventoryAwake)
	) {
		ranked.push({ intent: "nearby_entity", score: 0.93 });
	}

	const worldFact = detectWorldFactIntent(message);
	if (worldFact && !soundReq && !songReq) {
		let factScore = 0.8;
		if (worldFact === "health" || worldFact === "hunger") factScore = 0.91;
		ranked.push({ intent: "world_fact", score: factScore, extra: { worldFact } });
	}

	const social = detectSocialIntent(message);
	if (social && !soundReq && !songReq) {
		let score = social === "greet" ? 0.72 : 0.85;
		if (social === "insult" || social === "compliment" || social === "emotional") score = 0.88;
		if (audience === "verity") score += 0.08;
		ranked.push({ intent: "social", score: Math.min(score, 0.96), extra: { social } });
	}

	const situational = detectSituationalIntent(message);
	if (situational && !soundReq && !songReq) {
		let score = 0.84;
		if (tone === "distressed" || tone === "urgent") score += 0.08;
		ranked.push({
			intent: "situational",
			score: Math.min(score, 0.95),
			extra: { social: situational },
		});
	}

	const gameplay = detectGameplayIntent(message);
	if (gameplay && !soundReq && !songReq) {
		ranked.push({
			intent: "gameplay_tip",
			score: 0.81,
			extra: { worldFact: gameplay },
		});
	}

	if (ORE_HINT.test(normalized) && (SEEKING.test(normalized) || isQuestion) && !soundReq) {
		ranked.push({ intent: "ore_tip", score: 0.74 });
	}

	if (
		isQuestion &&
		!soundReq &&
		!songReq &&
		ranked.length === 0 &&
		detectFallbackTopic(message)
	) {
		ranked.push({ intent: "unknown", score: 0.42 });
	}

	ranked.sort((a, b) => b.score - a.score);

	const best = ranked[0] ?? {
		intent: /** @type {MindIntent} */ ("unknown"),
		score: isQuestion ? 0.35 : 0.2,
	};

	const confidence = Math.round(best.score * 100) / 100;
	const shouldRespond = audienceShouldRespond(audience, opts);

	const summary = [
		best.intent,
		`${Math.round(confidence * 100)}%`,
		audience,
		situation,
		tone,
		tokens.slice(0, 5).join(" ") || "(empty)",
	].join(" | ");

	return {
		intent: best.intent,
		confidence,
		summary,
		audience,
		situation,
		normalized,
		tokens,
		isQuestion,
		precise,
		shouldRespond,
		tone,
		...(best.extra ?? {}),
	};
}

/** @deprecated use analyzeMind */
export const analyzeMessage = analyzeMind;
