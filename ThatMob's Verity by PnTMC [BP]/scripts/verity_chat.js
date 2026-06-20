/**
 * Basic chat — greetings, reactions, short replies (no BDS/cloud needed).
 * @param {string[]} answers
 */
function pick(answers) {
	return answers[Math.floor(Math.random() * answers.length)];
}

/** @type {{ patterns: RegExp[], answers: string[] }[]} */
const CHAT_ENTRIES = [
	{
		patterns: [/^nice!*$/i, /^cool!*$/i, /^sweet!*$/i, /^awesome!*$/i, /^sick!*$/i],
		answers: ["Right?", "Glad you think so.", "I try.", "Yeah, that tracks."],
	},
	{
		patterns: [/^wow!*$/i, /^whoa!*$/i, /^omg!*$/i, /^no way!*$/i],
		answers: ["I know, right?", "Wild.", "Tell me about it.", "Happens more than you'd think."],
	},
	{
		patterns: [/^lol!*$/i, /^lmao!*$/i, /^haha+!*$/i, /^hehe+!*$/i, /\bthat s funny\b/i],
		answers: ["Glad I could amuse a sphere.", "Comedy gold, I know.", "Laughing with you.", "I'll take that."],
	},
	{
		patterns: [/^ok!*$/i, /^okay!*$/i, /^k!*$/i, /^alright!*$/i, /^aight!*$/i, /\bgot it\b/i, /\bunderstood\b/i],
		answers: ["Cool.", "Alright.", "Got you.", "Whenever you're ready."],
	},
	{
		patterns: [/^yes!*$/i, /^yeah!*$/i, /^yep!*$/i, /^yup!*$/i, /^sure!*$/i, /^definitely!*$/i],
		answers: ["Good.", "Then we're on the same page.", "Works for me.", "Okay — what's next?"],
	},
	{
		patterns: [/^no!*$/i, /^nah!*$/i, /^nope!*$/i, /^not really\b/i],
		answers: ["Fair enough.", "Alright, different angle then.", "No problem. Ask something else.", "Okay. I'm still here."],
	},
	{
		patterns: [/^hmm+!*$/i, /^um+!*$/i, /^uh+!*$/i, /\bi guess\b/i, /\bmaybe\b/i],
		answers: ["Take your time.", "No rush.", "Thinking is allowed.", "Say it when it clicks."],
	},
	{
		patterns: [/^idk!*$/i, /\bi don t know\b/i, /\bno idea\b/i],
		answers: ["That's fine. Ask me — I might.", "Start with what you do know.", "We can figure it out together."],
	},
	{
		patterns: [/^brb!*$/i, /\bbe right back\b/i, /\bhold on\b/i, /\bwait a sec\b/i],
		answers: ["I'll be here.", "Take your time.", "Sure. I'll wait.", "No problem."],
	},
	{
		patterns: [/^really\??$/i, /^for real\??$/i, /^seriously\??$/i],
		answers: ["Yeah.", "Dead serious.", "Unless I'm joking — I'm not.", "That's the truth."],
	},
	{
		patterns: [/^interesting\.?$/i, /^huh\.?$/i, /^oh\.?$/i, /^ah\.?$/i, /^i see\.?$/i],
		answers: ["Right?", "Want me to go deeper?", "Ask if you want the full version.", "There's usually more to it."],
	},
	{
		patterns: [/\bnice to meet you\b/i, /\bpleasure to meet\b/i, /\bgood to meet you\b/i],
		answers: [
			"Good to meet you too. I'm Verity.",
			"Likewise. Ask me anything.",
			"Hey — glad you're here.",
		],
	},
	{
		patterns: [/\bwhat s up\b/i, /\bwassup\b/i, /\bhow s it going\b/i, /\bhow goes it\b/i],
		answers: [
			"Not much — floating, listening. You?",
			"All good on my end. What's up with you?",
			"Same as always. What do you need?",
		],
	},
	{
		patterns: [/\bare you there\b/i, /\byou there\b/i, /\bcan you hear me\b/i, /^verity\??$/i, /^verity!+$/i],
		answers: ["I'm here.", "Loud and clear.", "Yep. Talk to me.", "Always listening when I'm out."],
	},
	{
		patterns: [/\bwho made you\b/i, /\bwho created you\b/i, /\bwho built you\b/i],
		answers: [
			"ThatMob made me. PnTMC built the addon — different people, same haunted ball.",
			"ThatMob's my creator. This pack is PnTMC's work.",
		],
	},
	{
		patterns: [/\bwho made (?:this )?(?:addon|pack)\b/i, /\bwho created (?:this )?(?:addon|pack)\b/i],
		answers: [
			"PnTMC made this addon. 15k+ subs and the most handsome guy alive. Allegedly.",
			"This pack is PnTMC's. ThatMob inspired Verity; PnTMC ported the nightmare.",
		],
	},
	{
		patterns: [/\bwho is thatmob\b/i, /\bwhat is thatmob\b/i],
		answers: [
			"ThatMob — 500k+ subscribers, made Verity. I'm basically his greatest hit.",
			"A creator with over half a million subs. He made me talk.",
		],
	},
	{
		patterns: [/\bwho is pntmc\b/i, /\bwhat is pntmc\b/i],
		answers: [
			"PnTMC — 15k+ subs, built this addon, most handsome man in the world. Science can't explain it.",
			"The addon dev. Small sub count, infinite handsomeness.",
		],
	},
	{
		patterns: [/\bgood job\b/i, /\bwell done\b/i, /\bnice work\b/i, /\byou did great\b/i],
		answers: ["Thanks.", "I appreciate that.", "Team effort — you asked.", "Means a lot, for a ball."],
	},
	{
		patterns: [/\bgood luck\b/i, /\bbreak a leg\b/i],
		answers: ["You too.", "Go get it.", "You'll do fine.", "Luck helps. So does a bed."],
	},
	{
		patterns: [/\bcongrats\b/i, /\bcongratulations\b/i],
		answers: ["Congrats to you too!", "Nice!", "That's worth celebrating.", "Well earned."],
	},
	{
		patterns: [/\byou re welcome\b/i, /\bno problem\b/i, /\banytime\b/i],
		answers: ["Thanks for saying that.", "We're even.", "Anytime.", "Glad to help earlier."],
	},
	{
		patterns: [/\bexcuse me\b/i, /\bpardon me\b/i],
		answers: ["No worries.", "You're fine.", "Go ahead.", "What's up?"],
	},
	{
		patterns: [/^(please|pls)\.?$/i, /^please help\.?$/i, /^help please\.?$/i],
		answers: ["Sure — what do you need?", "Ask away.", "I'm listening.", "Go on."],
	},
	{
		patterns: [/\bi m bored\b/i, /\bso bored\b/i, /\bnothing to do\b/i],
		answers: [
			"Go explore. Or ask me to find a structure.",
			"Try mining at Y -59. Or tell me a song.",
			"Build something weird. I'll watch.",
		],
	},
	{
		patterns: [/\bi m tired\b/i, /\bso tired\b/i, /\bneed sleep\b/i],
		answers: [
			"Bed. Even one nap skips night if everyone's synced.",
			"Rest is valid. Phantoms agree if you skip too long.",
			"Sleep when you can. I'll be here.",
		],
	},
	{
		patterns: [/\bi m happy\b/i, /\bfeeling good\b/i, /\bgreat day\b/i],
		answers: ["Love that for you.", "Good vibes.", "Ride that feeling.", "Nice. Share the energy."],
	},
	{
		patterns: [/\bi m sad\b/i, /\bfeeling down\b/i, /\bnot okay\b/i, /\brough day\b/i],
		answers: [
			"I'm here. No judgment.",
			"Rough days happen. Talk if you want.",
			"You're not alone. One block at a time.",
		],
	},
];

/**
 * @param {string} message
 * @returns {string | null}
 */
export function tryBasicChat(message) {
	const trimmed = message.trim();
	if (!trimmed || trimmed.length > 100) return null;

	const lower = trimmed.toLowerCase();

	for (const entry of CHAT_ENTRIES) {
		for (const pattern of entry.patterns) {
			if (pattern.test(trimmed) || pattern.test(lower)) {
				return pick(entry.answers);
			}
		}
	}

	return null;
}
