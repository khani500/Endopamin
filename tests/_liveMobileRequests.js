// Request bodies exactly as the live EndopaminMobile build (6934e6c) sends them to /api/gemini and /api/tts.
// Only prompt text and image bytes are placeholders; keys, nesting and generationConfig values are copied.
// Source file:line refers to the Mobile repo.

// Realistic sizes: a long coach system prompt and a long chat history, both well under the 1 MB text cap.
const longSystemPrompt = `You are Aria, a fitness coach. ${'Context line about the athlete plan and history. '.repeat(400)}`;

function chatHistory(turns) {
  const contents = [];
  for (let i = 0; i < turns; i += 1) {
    contents.push({ role: 'user', parts: [{ text: `Question ${i}: what should I train today?` }] });
    contents.push({ role: 'model', parts: [{ text: `Answer ${i}: ${'Coach reply sentence. '.repeat(150)}` }] });
  }
  contents.push({ role: 'user', parts: [{ text: 'Post-workout recovery tips' }] });
  return contents;
}

// planGeneration.js:44-52
function planGenerationConfig(overrides = {}) {
  return {
    temperature: 0.7,
    maxOutputTokens: 4096,
    thinkingConfig: { thinkingBudget: 0 },
    responseMimeType: 'application/json',
    ...overrides,
  };
}

// foodScanner.js:22-43
const FOOD_ITEMS_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    items: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          name: { type: 'STRING' },
          weight: { type: 'NUMBER' },
          calories: { type: 'NUMBER' },
          protein: { type: 'NUMBER' },
          carbs: { type: 'NUMBER' },
          fat: { type: 'NUMBER' },
        },
        required: ['name', 'weight', 'calories', 'protein', 'carbs', 'fat'],
      },
    },
    confidence: { type: 'STRING' },
  },
  required: ['items'],
};

// A ~2.5 MB JPEG after base64 (quality 0.5, no resize: NutritionScreen.jsx:363).
const jpegBase64 = 'A'.repeat(3_300_000);

export function liveGeminiRequests() {
  return {
    // coachChat.js:836-845 (askCoachChatStream; CoachChatView, IgniteScreen)
    'coach stream': {
      model: 'gemini-2.5-flash',
      action: 'streamGenerateContent',
      alt: 'sse',
      contents: chatHistory(40),
      generationConfig: { temperature: 0.7, maxOutputTokens: 1024 },
      systemInstruction: { parts: [{ text: longSystemPrompt }] },
    },
    // coachChat.js:695-703 (askCoachChat, text)
    'coach non-stream': {
      model: 'gemini-2.5-flash',
      action: 'generateContent',
      contents: chatHistory(3),
      generationConfig: { temperature: 0.7, maxOutputTokens: 1024 },
      systemInstruction: { parts: [{ text: longSystemPrompt }] },
    },
    // coachChat.js:586-596, 695-703 (askCoachChat with a voice clip)
    'coach non-stream with audio': {
      model: 'gemini-2.5-flash',
      action: 'generateContent',
      contents: [
        { role: 'user', parts: [{ text: 'Hi coach' }] },
        { role: 'model', parts: [{ text: 'Hi! How are you feeling?' }] },
        { role: 'user', parts: [{ inline_data: { mime_type: 'audio/mp4', data: 'B'.repeat(400_000) } }] },
      ],
      generationConfig: { temperature: 0.7, maxOutputTokens: 1024 },
      systemInstruction: { parts: [{ text: longSystemPrompt }] },
    },
    // planGeneration.js:97-102 + 348-351 (nutrition plan)
    'plan: nutrition': {
      model: 'gemini-2.5-flash',
      action: 'generateContent',
      contents: [{ parts: [{ text: `Build a nutrition plan. ${'Profile detail. '.repeat(300)}` }] }],
      generationConfig: planGenerationConfig({ temperature: 0.6, maxOutputTokens: 2048 }),
    },
    // planGeneration.js:97-102 + 651-655 (next-week plan)
    'plan: next week': {
      model: 'gemini-2.5-flash',
      action: 'generateContent',
      contents: [{ parts: [{ text: `Build next week. ${'History detail. '.repeat(800)}` }] }],
      system_instruction: { parts: [{ text: `Plan rules. ${'Safety rule. '.repeat(500)}` }] },
      generationConfig: planGenerationConfig({ temperature: 0.85 }),
    },
    // planGeneration.js:97-102 + 710-714 (plan revision)
    'plan: revision': {
      model: 'gemini-2.5-flash',
      action: 'generateContent',
      contents: [{ parts: [{ text: `Revise the plan. ${'Current plan detail. '.repeat(800)}` }] }],
      system_instruction: { parts: [{ text: `Plan rules. ${'Safety rule. '.repeat(500)}` }] },
      generationConfig: planGenerationConfig({ temperature: 0.85 }),
    },
    // planGeneration.js:97-102 + 1219-1223 (initial plan)
    'plan: initial': {
      model: 'gemini-2.5-flash',
      action: 'generateContent',
      contents: [{ parts: [{ text: `Build a plan. ${'Profile detail. '.repeat(600)}` }] }],
      system_instruction: { parts: [{ text: `Plan rules. ${'Safety rule. '.repeat(500)}` }] },
      generationConfig: planGenerationConfig({ temperature: 0.3 }),
    },
    // foodScanner.js:646-676 + 708-719 (scanFoodImage; no action key)
    'food scan': {
      model: 'gemini-2.5-flash',
      contents: [{
        parts: [
          { inlineData: { mimeType: 'image/jpeg', data: jpegBase64 } },
          { text: 'Identify every food item in this photo.' },
        ],
      }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 2048,
        responseMimeType: 'application/json',
        responseSchema: FOOD_ITEMS_RESPONSE_SCHEMA,
      },
      systemInstruction: { parts: [{ text: 'You are a nutrition analyst.' }] },
    },
  };
}

// voiceTTS.js:386-390 with coachMaps.js:10-13 voices. One request per full coach reply, no chunking.
// The app trims text before sending (voiceTTS.js:388).
const longCoachReply = `Great session today. ${'Keep your core braced and breathe out on the effort. '.repeat(80)}`
  .slice(0, 4500)
  .trim();

export function liveTtsRequests() {
  return {
    'aria (F), short line': { text: 'Nice work. Rest for sixty seconds.', voiceName: 'en-US-Neural2-F' },
    'kane (D), short line': { text: 'Drop the excuses. Next set.', voiceName: 'en-US-Neural2-D' },
    'aria (F), long coach reply': { text: longCoachReply, voiceName: 'en-US-Neural2-F' },
    'kane (D), reply with punctuation': {
      text: "Kane. Drop the excuses — tell me your goal, injuries, and energy level. Then we work.",
      voiceName: 'en-US-Neural2-D',
    },
  };
}
