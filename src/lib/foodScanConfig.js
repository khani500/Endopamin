const FOOD_ITEM_SCHEMA = {
  type: 'OBJECT',
  properties: {
    name: { type: 'STRING' },
    estimatedWeight: { type: 'NUMBER' },
    weightUnit: { type: 'STRING' },
    calories: { type: 'NUMBER' },
    protein: { type: 'NUMBER' },
    carbs: { type: 'NUMBER' },
    fat: { type: 'NUMBER' },
    fiber: { type: 'NUMBER' },
    confidence: { type: 'STRING' },
  },
  required: ['name', 'estimatedWeight', 'calories', 'protein', 'carbs', 'fat'],
};

const TOTAL_SCHEMA = {
  type: 'OBJECT',
  properties: {
    calories: { type: 'NUMBER' },
    protein: { type: 'NUMBER' },
    carbs: { type: 'NUMBER' },
    fat: { type: 'NUMBER' },
    fiber: { type: 'NUMBER' },
  },
  required: ['calories', 'protein', 'carbs', 'fat'],
};

export const FOOD_SCAN_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    items: { type: 'ARRAY', items: FOOD_ITEM_SCHEMA },
    total: TOTAL_SCHEMA,
    mealDescription: { type: 'STRING' },
  },
  required: ['items', 'total', 'mealDescription'],
};

export const FOOD_SCAN_GENERATION_CONFIG = {
  temperature: 0,
  maxOutputTokens: 1024,
  responseMimeType: 'application/json',
  responseSchema: FOOD_SCAN_RESPONSE_SCHEMA,
};
