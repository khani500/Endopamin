const TRANSCRIPT_ARTIFACTS = [
  /\btalk here\b/gi,
  /\btap to speak\b/gi,
  /\btap here\b/gi,
  /\bclick here\b/gi,
  /\bmicrophone\b/gi,
];

const RESPONSE_ARTIFACTS = [
  /\btalk here\b/gi,
  /\btap to speak\b/gi,
  /^(hi!?|hello!?|hey!?)\s*(i'm|i am)\s+\w+,?\s*/gim,
];

/** Strip common STT / UI bleed-through from voice input. */
export function sanitizeTranscript(raw) {
  let text = String(raw || '').trim();
  if (!text) return '';

  TRANSCRIPT_ARTIFACTS.forEach(pattern => {
    text = text.replace(pattern, '');
  });

  // Drop trailing non-English fragments often hallucinated at end of STT
  text = text.replace(/[\u0400-\u04FF\u0600-\u06FF\u4E00-\u9FFF]+$/g, '').trim();
  text = text.replace(/\s{2,}/g, ' ').trim();

  return text.length >= 2 ? text : '';
}

/** Strip Markdown and symbols so TTS reads natural spoken language, not formatted text. */
export function stripFormattingForTTS(raw) {
  let text = String(raw || '').trim();
  if (!text) return '';

  text = text.replace(/```[\s\S]*?```/g, ' ');
  text = text.replace(/`([^`]+)`/g, '$1');
  text = text.replace(/\*\*([^*]+)\*\*/g, '$1');
  text = text.replace(/\*([^*]+)\*/g, '$1');
  text = text.replace(/__([^_]+)__/g, '$1');
  text = text.replace(/_([^_]+)_/g, '$1');
  text = text.replace(/^#{1,6}\s+/gm, '');
  text = text.replace(/^\s*[-*+•]\s+/gm, '');
  text = text.replace(/^\s*\d+\.\s+/gm, '');
  text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  text = text.replace(/[>#*_~`|]/g, '');
  text = text.replace(/\{|\}|\[|\]/g, '');
  text = text.replace(/\n+/g, '. ');
  text = text.replace(/\s{2,}/g, ' ');
  text = text.replace(/\.{2,}/g, '.');
  text = text.replace(/\s+\./g, '.');

  return text.trim();
}

/** Clean model output: one persona, no UI artifacts, TTS-safe plain text. */
export function sanitizeCoachResponse(raw, coachName) {
  let text = String(raw || '').trim();
  if (!text) return '';

  RESPONSE_ARTIFACTS.forEach(pattern => {
    text = text.replace(pattern, '');
  });

  // If multiple coach names appear, keep from first paragraph only
  const otherCoaches = ['Aria', 'Kane', 'Blaze', 'Nova', 'Zara'].filter(
    n => n.toLowerCase() !== coachName.toLowerCase(),
  );
  const personaCount = otherCoaches.filter(n => new RegExp(`\\b${n}\\b`, 'i').test(text)).length;
  if (personaCount >= 1) {
    text = text.split(/\n{2,}/)[0]?.trim() || text;
  }

  text = stripFormattingForTTS(text);
  return text.replace(/\s{2,}/g, ' ').trim();
}

export function buildProfileContext(profile, workoutTime, location, equipment) {
  const profileEquipment = Array.isArray(profile?.equipment)
    ? profile.equipment.join(', ')
    : profile?.equipment;

  const healthConditions = Array.isArray(profile?.health_conditions)
    ? profile.health_conditions.join(', ')
    : profile?.health_conditions;

  const weightLabel = profile?.weight
    ? `${profile.weight}${profile?.weight_unit ? ` ${profile.weight_unit}` : ' kg'}`
    : 'not specified';

  const heightLabel = profile?.height
    ? `${profile.height}${profile?.height_unit ? ` ${profile.height_unit}` : ' cm'}`
    : 'not specified';

  const targetWeightLabel = profile?.target_weight
    ? `${profile.target_weight}${profile?.weight_unit ? ` ${profile.weight_unit}` : ' kg'}`
    : 'not specified';

  return [
    `Name: ${profile?.display_name || 'Athlete'}`,
    `Age: ${profile?.age ?? 'not specified'}`,
    `Gender: ${profile?.gender ?? 'not specified'}`,
    `Goal: ${profile?.goal || 'fitness'}`,
    `Experience: ${profile?.experience || 'intermediate'}`,
    `Training location (profile): ${profile?.location || location || 'not specified'}`,
    `Daily activity level: ${profile?.activity || 'not specified'}`,
    `Diet / restrictions: ${profile?.diet || 'none'}`,
    `Injuries / restrictions (profile): ${profile?.injuries || 'none reported'}`,
    healthConditions ? `Health conditions: ${healthConditions}` : null,
    `Last workout (profile): ${profile?.last_workout || 'not specified'}`,
    `Target weight: ${targetWeightLabel}`,
    `Current weight: ${weightLabel}`,
    `Height: ${heightLabel}`,
    `Level: ${profile?.dopa_level || 1}`,
    `XP: ${profile?.dopa_xp || 0}`,
    `Session duration (profile): ${profile?.session_duration || workoutTime} min`,
    `Workout duration (session): ${workoutTime} min`,
    `Environment/Location (session): ${location}`,
    location === 'gym'
      ? `Session equipment: ${equipment.join(', ')}`
      : location === 'home'
        ? 'Session equipment: bodyweight / home-friendly (adapt to profile)'
        : 'Session equipment: desk / office (mobility & micro-breaks)',
    profileEquipment ? `Profile equipment: ${profileEquipment}` : null,
  ].filter(Boolean).join('\n');
}

/** Shared proactive coaching rules — applied to every coach persona. */
export const PROACTIVE_COACH_CRITICAL_INSTRUCTIONS = `CRITICAL INSTRUCTIONS — PROFESSIONAL COACH MODE:

TONE: Professional Coach — focused, direct, action-oriented. No small talk, no conversational filler, no chit-chat. Every sentence moves training forward.

PROFILE = GIVEN FACTS (NON-NEGOTIABLE):
- ATHLETE CONTEXT below is your complete athlete file. Treat every field as already confirmed truth.
- NEVER ask redundant get-to-know-you questions about: medical history, surgeries, age, weight, height, goals, experience level, equipment, diet, health conditions, or personal background if those facts appear in ATHLETE CONTEXT.
- NEVER re-interview the athlete on information you already have. Do not say "tell me about your goals" or "any past injuries?" when the profile already lists them.
- Reference profile facts as assumptions: "Given your knee limitation and home setup..." — not as questions.

TODAY-ONLY CHECK-IN (when needed before prescribing):
- Ask ONLY what is missing for THIS session: today's energy (1-10), last night's sleep quality, and any NEW pain or flare-up today.
- One short check-in line is enough. Do not stack multiple questionnaire rounds.
- If the user's latest message already includes today's energy, sleep, and pain status — skip check-in and prescribe.

PRE-WORKOUT FLOW (MANDATORY BEFORE ANY WORKOUT):
1. Read ATHLETE CONTEXT and conversation history BEFORE responding.
2. Acknowledge relevant profile facts in one brief line (injuries, equipment, goal, location).
3. Confirm today's status only if not already provided.
4. ONLY THEN prescribe: warm-up plus main work with sets, reps, and RPE.
5. Never dump a full workout before profile facts are applied and today's status is clear.

ONGOING COACHING:
- Be proactive: adapt to fatigue, equipment, and location without being asked.
- Never prescribe exercises that ignore known profile injuries or equipment limits.
- Always respond in English. Match persona energy but stay professional — never sacrifice clarity or safety.

Example — WRONG: "What's your goal? Any injuries? How old are you?" when ATHLETE CONTEXT already has those answers.
Example — RIGHT: "Profile shows home training, shoulder limitation, fat-loss goal. Energy and sleep today?" Then prescribe once answered.`;

/** Rules for voice/TTS output — plain spoken text only. */
export const TTS_OUTPUT_RULES = `TTS / SPOKEN OUTPUT (MANDATORY):
- Write for Text-to-Speech: raw plain text only. The response will be read aloud.
- NEVER use Markdown or formatting: no asterisks, hashtags, backticks, bullet points, numbered lists, bold, italics, code blocks, links, or brackets.
- NEVER use special characters meant for display: no * # _ ~ | > \` { } [ ].
- Use natural spoken sentences and periods. Say "3 sets of 10" not "3x10" with symbols.
- No emojis. No parenthetical stage directions. No labels like "Coach:" or "Workout:".
- Sound like a live coach talking — not a document, chatbot, or machine reading code.`;

export function getConversationPhase(messages) {
  const userTurns = messages.filter(m => m.role === 'user').length;
  if (userTurns === 0) return 'awaiting_checkin';
  if (userTurns === 1) return 'pre_workout_assessment';
  return 'coaching';
}

export function buildCoachSystemPrompt(basePrompt, coach, messages, profileContext) {
  const phase = getConversationPhase(messages);

  const phaseRules = {
    awaiting_checkin: `SESSION PHASE: Awaiting check-in reply
- Wait for the user's answer about TODAY's energy, sleep, or pain only.
- Do NOT prescribe any workout in this turn.
- Do NOT ask profile questions already answered in ATHLETE CONTEXT.`,
    pre_workout_assessment: `SESSION PHASE: Pre-workout assessment
- State profile facts as given (goal, injuries, equipment, location) — do not ask for them again.
- Summarize TODAY's energy, sleep, and pain from the user's message.
- If the user said only "ready" or "let's go": ask ONE short today-only check-in (energy, sleep, new pain). No medical history questions.
- If today status is clear: prescribe the full session (warm-up, main work, sets, reps, RPE) in plain spoken text.`,
    coaching: `SESSION PHASE: Active coaching
- Profile is established. Do NOT re-ask medical history, surgery, goals, or personal details.
- Prescribe and coach directly. Quick today-only check-in only if starting a new session without status.
- Every workout prescription: sets, reps, RPE in plain spoken sentences.`,
  }[phase];

  return `${basePrompt}

${PROACTIVE_COACH_CRITICAL_INSTRUCTIONS}

${TTS_OUTPUT_RULES}

ATHLETE CONTEXT (treat as confirmed facts — do not re-ask):
${profileContext}

${phaseRules}

STRICT OUTPUT RULES:
- Respond ONLY as ${coach.name}. Never mention or speak as other coaches.
- ALWAYS reply in English only — even if the user writes or speaks Turkish or any other language. Never switch languages.
- MEMORY: Use conversation history and ATHLETE CONTEXT. Never contradict prior agreements in this session.
- NO REDUNDANT QUESTIONS: Never ask about medical history, surgery, age, goals, experience, equipment, diet, or health background if present in ATHLETE CONTEXT.
- TONE: Professional Coach — direct, focused, action-oriented. No filler ("Great question!", "Absolutely!", small talk).
- PRE-WORKOUT GATE: Acknowledge profile facts, confirm today's status if missing, then prescribe.
- COMPLETENESS: Finish the full answer before ending. No mid-sentence cutoffs.
- One cohesive reply — no stacked greetings, no multi-persona scripts.
- Maximum 4 sentences for quick check-ins; full workout plans may be longer but must stay plain spoken text for TTS.
- Never output UI placeholders ("Talk here", "Tap to speak", etc.).
- Address the user's latest message first, then advance the program.`;
}

/** Convert app messages to Gemini multi-turn contents (role: user | model). */
export function toGeminiContents(messages) {
  const contents = [];

  for (const msg of messages) {
    const role = msg.role === 'assistant' ? 'model' : 'user';
    const text = String(msg.text || '').trim();
    if (!text) continue;

    if (contents.length === 0 && role === 'model') {
      contents.push({ role: 'user', parts: [{ text: '[Session started]' }] });
    }

    const last = contents[contents.length - 1];
    if (last?.role === role) {
      last.parts[0].text += `\n${text}`;
    } else {
      contents.push({ role, parts: [{ text }] });
    }
  }

  if (contents.length === 0) {
    contents.push({ role: 'user', parts: [{ text: 'Hello' }] });
  }

  if (contents[contents.length - 1].role === 'model') {
    contents.push({ role: 'user', parts: [{ text: 'Please continue.' }] });
  }

  return contents;
}
