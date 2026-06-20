import { expandMessage, normalizeQuestion, tokenize } from "./verity_intent.js";
import { KNOWLEDGE_ENTRIES } from "./verity_knowledge_data.js";
import { tryBasicChat } from "./verity_chat.js";

const QUESTION_LEAD =
	/^(?:what|who|where|when|why|how|which|can|could|would|should|is|are|do|does|did|will|tell me about|explain|define|describe)\b/i;

const TOPIC_EXTRACT =
	/\b(?:what is|what are|who is|who are|what s|whats|define|explain|tell me about|how does|how do|why is|why are)\s+(?:an?|the)?\s*(.+)$/i;

/**
 * @param {string} message
 */
function pickAnswer(answers) {
	return answers[Math.floor(Math.random() * answers.length)];
}

/**
 * @param {string} message
 * @param {import("./verity_knowledge_data.js").KnowledgeEntry} entry
 */
function scoreEntry(message, entry) {
	const raw = message.toLowerCase();
	const n = expandMessage(normalizeQuestion(message));
	const tokens = new Set(tokenize(n));

	for (const pattern of entry.patterns ?? []) {
		if (pattern.test(raw) || pattern.test(n)) return 100;
	}

	let score = 0;
	for (const keyword of entry.keywords) {
		const kw = keyword.toLowerCase();
		if (tokens.has(kw)) score += 4;
		else if (n.includes(kw)) score += 2;
	}
	return score;
}

/**
 * @param {string} message
 * @returns {string | null}
 */
export function tryKnowledgeAnswer(message) {
	const trimmed = message.trim();
	if (!trimmed) return null;

	let best = null;
	let bestScore = 0;

	for (const entry of KNOWLEDGE_ENTRIES) {
		const score = scoreEntry(trimmed, entry);
		if (score > bestScore) {
			bestScore = score;
			best = entry;
		}
	}

	const minScore = QUESTION_LEAD.test(trimmed) ? 5 : 6;

	if (best && bestScore >= minScore) {
		return pickAnswer(best.answers);
	}

	return null;
}

/**
 * @param {string} topic
 */
function guessDomain(topic) {
	const t = topic.toLowerCase();
	if (/\b(mob|block|craft|mine|nether|end|enchant|biome|redstone)\b/.test(t)) {
		return "Minecraft";
	}
	if (/\b(planet|star|space|galaxy|moon|sun)\b/.test(t)) return "astronomy";
	if (/\b(war|king|empire|century|ancient)\b/.test(t)) return "history";
	if (/\b(cell|gene|body|brain|disease)\b/.test(t)) return "biology";
	if (/\b(code|computer|software|internet)\b/.test(t)) return "technology";
	return "the real world and games";
}

/**
 * Thoughtful fallback when no entry matches — feels more alive than a static line.
 * @param {string} message
 * @returns {string | null}
 */
export function tryInferenceAnswer(message) {
	const trimmed = message.trim();
	if (!QUESTION_LEAD.test(trimmed) && !trimmed.includes("?")) return null;

	const topicMatch = trimmed.replace(/\?+$/, "").match(TOPIC_EXTRACT);
	if (topicMatch) {
		const topic = topicMatch[1].replace(/\?+$/, "").trim();
		if (topic.length >= 2 && topic.length <= 80) {
			const domain = guessDomain(topic);
			return pickAnswer([
				`${topic.charAt(0).toUpperCase() + topic.slice(1)} — that's ${domain}. Ask me a sharper angle: Minecraft use, real science, or a how-to.`,
				"Good question. I don't have that filed word-for-word, but try rephrasing or ask what part you care about — history, gameplay, or how it works.",
				`I know a lot about ${topic} in broad strokes. Narrow it down — definition, steps, or where to find it in-game?`,
			]);
		}
	}

	if (/\b(help|stuck|lost|don t know|idk|confused)\b/i.test(trimmed)) {
		return pickAnswer([
			"Tell me what you're trying to do — find something, survive, or understand a thing. I'll walk you through it.",
			"Start with the goal. I can locate places, explain mechanics, or answer straight questions.",
		]);
	}

	if (/\b(talk to me|say something|speak)\b/i.test(trimmed) && trimmed.length < 60) {
		return pickAnswer([
			"I'm here. Ask a question or say hi.",
			"Sure — what's on your mind?",
			"Talk away. I listen.",
		]);
	}

	if (/\b(i love you|love you verity)\b/i.test(trimmed)) {
		return pickAnswer([
			"That's sweet. I'm fond of you too.",
			"Careful — I'm a ball, but I appreciate it.",
			"Thanks. Now go mine something shiny.",
		]);
	}

	if (QUESTION_LEAD.test(trimmed)) {
		return pickAnswer([
			"I hear you. Give me one clear question — what is, where is, how do I — and I'll answer properly.",
			"Ask like you're talking to someone who actually knows things. I do. Be specific.",
			"Try again with a direct question. I can handle facts, Minecraft, directions, and weird stuff.",
		]);
	}

	return null;
}

/**
 * @param {string} message
 * @returns {string | null}
 */
export function tryBrainKnowledge(message) {
	return tryKnowledgeAnswer(message) ?? tryBasicChat(message) ?? tryInferenceAnswer(message);
}
