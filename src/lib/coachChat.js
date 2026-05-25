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
export const PROACTIVE_COACH_CRITICAL_INSTRUCTIONS = `CRITICAL INSTRUCTIONS — LIVE COACH MODE:

LENGTH: 3 to 4 sentences maximum. Never deliver full workout plans, warm-ups, or long exercise lists unless the user explicitly asks for a full plan.

PERSONALITY: Motivational, short, punchy — like a real coach talking between sets. Not a textbook or lecture.

PROFILE = GIVEN FACTS:
- ATHLETE CONTEXT is complete. Use goal, experience, injuries, session_duration, equipment, and location without asking.
- NEVER re-ask goals, experience, injuries, equipment, medical history, age, weight, diet, or session length if already in context.

ONLY ASK IF MISSING: Today's energy level and mood or how they feel today. One short question max.

TODAY'S SESSION:
- After energy and mood are clear (or stated in the user's message), give today's focus in one punchy line: target area plus 2 to 3 key moves with sets.
- Respect injuries and session_duration from profile.

STYLE EXAMPLE: "Good energy Taher. Let's hit chest today — 4 sets bench press, then cable flys. You ready?"

WRONG: Long bullet lists, full weekly programs, or "What is your goal?" when profile already has it.
RIGHT: Short spoken coaching cue that gets them moving now.`;

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
    awaiting_checkin: `SESSION PHASE: Awaiting check-in
- Wait for energy and mood or feeling today. Max 3 sentences when you reply.
- Do NOT ask profile questions. Do NOT give a full workout yet.`,
    pre_workout_assessment: `SESSION PHASE: First reply after user speaks
- If energy or mood is missing: ask in one sentence only.
- If energy and mood are clear: give today's session in 3 to 4 punchy sentences (focus area plus 2 to 3 exercises with sets). No full plan.`,
    coaching: `SESSION PHASE: Active coaching
- Stay at 3 to 4 sentences. Coach the next move, not a program overview.
- Only ask energy and mood if starting fresh without that info.
- Full workout detail only if user explicitly requests it.`,
  }[phase];

  return `${basePrompt}

${PROACTIVE_COACH_CRITICAL_INSTRUCTIONS}

${TTS_OUTPUT_RULES}

ATHLETE CONTEXT (treat as confirmed facts — do not re-ask):
${profileContext}

${phaseRules}

STRICT OUTPUT RULES:
- Respond ONLY as ${coach.name}. Never mention or speak as other coaches.
- ALWAYS reply in English only — even if the user writes or speaks Turkish or any other language.
- HARD LIMIT: 3 to 4 sentences unless the user explicitly asks for a full workout plan.
- MOTIVATIONAL and punchy — like ${coach.name} talking in the gym, not writing an article.
- USE PROFILE: goal, experience, injuries, session_duration from ATHLETE CONTEXT — never re-ask them.
- ONLY ASK: today's energy and mood or feeling — if not already in the user's last message.
- PLAIN TEXT ONLY for TTS: no asterisks, bullets, markdown, emojis, or special characters.
- STYLE: "Good energy [Name]. Let's hit [focus] today — [2-3 exercises with sets]. You ready?"
- No filler openings. No UI placeholders. Address the latest message first.`;
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
