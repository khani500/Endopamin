/**
 * Dopa Peak — Nutrition & AI coach API adapters.
 * Replace implementations with your backend / OpenAI / vision endpoints.
 * All functions accept optional AbortSignal for cancellation.
 */

/** @typedef {{ id: string; name: string; kcal: number; protein: number; carbs: number; fat: number; servingLabel?: string }} FoodItem */

/**
 * POST multipart image → structured food estimate.
 * @param {Blob} imageBlob
 * @param {AbortSignal} [signal]
 * @returns {Promise<{ label: string; confidence: number; portionGrams: number; kcal: number; protein: number; carbs: number; fat: number }>}
 */
export async function analyzeFoodImage(imageBlob, signal) {
  void imageBlob;
  void signal;
  // Example: const form = new FormData(); form.append('image', imageBlob, 'capture.jpg');
  // return fetch(`${import.meta.env.VITE_API_URL}/nutrition/vision`, { method: 'POST', body: form, signal }).then(r => r.json());
  return Promise.reject(
    new Error('[nutritionApi.analyzeFoodImage] Wire to POST /nutrition/vision (multipart image).'),
  );
}

/** Temporary stand-in for UI until vision API is connected. */
export async function analyzeFoodImageDemo(imageBlob, signal) {
  void imageBlob;
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  await new Promise((resolve, reject) => {
    const t = setTimeout(resolve, 900);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      reject(new DOMException('Aborted', 'AbortError'));
    });
  });
  return {
    label: 'Demo: protein bowl',
    confidence: 0.78,
    portionGrams: 340,
    kcal: 512,
    protein: 38,
    carbs: 48,
    fat: 16,
  };
}

/**
 * Search foods database for quick log.
 * @param {string} query
 * @param {AbortSignal} [signal]
 * @returns {Promise<FoodItem[]>}
 */
export async function searchFoods(query, signal) {
  void query;
  void signal;
  return Promise.reject(new Error('[nutritionApi.searchFoods] Wire to GET /nutrition/foods?q='));
}

/**
 * Goal-aware meal plan from server-side planner or LLM.
 * @param {{ goal: string; kcal: number; protein: number; carbs: number; fat: number; mealsPerDay: number }} profile
 * @param {AbortSignal} [signal]
 * @returns {Promise<{ day: string; meals: { slot: string; title: string; kcal: number; protein: number; carbs: number; fat: number; notes?: string }[] }>}
 */
export async function fetchMealPlan(profile, signal) {
  void profile;
  void signal;
  return Promise.reject(new Error('[nutritionApi.fetchMealPlan] Wire to POST /nutrition/meal-plan'));
}

/**
 * Exchange credentials for realtime voice / WebRTC token (e.g. OpenAI Realtime).
 * @returns {Promise<{ token: string; expiresAt: string; model?: string }>}
 */
export async function getVoiceCoachSessionToken() {
  return Promise.reject(new Error('[nutritionApi.getVoiceCoachSessionToken] Wire to POST /coach/voice/session'));
}

/**
 * Send user utterance transcript or audio ref; receive coach reply text (non-streaming stub shape).
 * @param {{ transcript?: string; audioUrl?: string; coachGender: string; coachTone: string }} payload
 * @param {AbortSignal} [signal]
 */
export async function sendVoiceCoachTurn(payload, signal) {
  void payload;
  void signal;
  return Promise.reject(new Error('[nutritionApi.sendVoiceCoachTurn] Wire to POST /coach/voice/turn'));
}

/** Demo reply until voice / LLM API is connected. */
export async function sendVoiceCoachTurnDemo(payload, signal) {
  void signal;
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  await new Promise((resolve, reject) => {
    const t = setTimeout(resolve, 500);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      reject(new DOMException('Aborted', 'AbortError'));
    });
  });
  const tone =
    payload.coachTone === 'calm'
      ? 'Stay steady — save energy for your main workout today.'
      : payload.coachTone === 'military'
        ? 'Report in. Training is non‑negotiable. After lunch do 15 minutes easy walking.'
        : 'Great energy — hit your protein target today; a spoon of peanut butter is fine if it keeps you sane.';
  return {
    replyText: `${tone} (Goal: ${payload.goal ?? '—'}) — message: "${(payload.transcript || '').slice(0, 80)}"`,
  };
}

/**
 * Dev helper: deterministic local search until API exists.
 * @param {string} query
 * @returns {FoodItem[]}
 */
export function mockSearchFoodsLocal(query) {
  const q = query.trim().toLowerCase();
  const db = [
    { id: '1', name: 'Chicken breast (grilled, 150g)', kcal: 248, protein: 46, carbs: 0, fat: 5, servingLabel: '150 g' },
    { id: '2', name: 'Greek yogurt (plain, 200g)', kcal: 130, protein: 20, carbs: 8, fat: 4, servingLabel: '200 g' },
    { id: '3', name: 'Oats (dry, 60g)', kcal: 225, protein: 8, carbs: 40, fat: 4, servingLabel: '60 g' },
    { id: '4', name: 'Salmon (baked, 180g)', kcal: 370, protein: 34, carbs: 0, fat: 24, servingLabel: '180 g' },
    { id: '5', name: 'Banana (medium)', kcal: 105, protein: 1, carbs: 27, fat: 0, servingLabel: '1 pc' },
    { id: '6', name: 'Whole eggs (2 large)', kcal: 140, protein: 12, carbs: 1, fat: 10, servingLabel: '2 eggs' },
    { id: '7', name: 'Brown rice (cooked, 200g)', kcal: 248, protein: 5, carbs: 52, fat: 2, servingLabel: '200 g' },
  ];
  if (!q) return db.slice(0, 5);
  return db.filter(f => f.name.toLowerCase().includes(q)).slice(0, 12);
}
