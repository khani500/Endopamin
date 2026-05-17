export const colors = {
  primary: '#000000',
  secondary: '#1E1E1E',
  accent: '#CCFF00',
  activityRed: '#FF3B30',
  activityGreen: '#30D158',
  activityBlue: '#007AFF',
  activityCyan: '#32ADE6',
  nutritionProtein: '#FFCC00',
  nutritionCarb: '#FF9500',
  nutritionFat: '#FF3B30',
} as const;

export type ThemeColors = typeof colors;
