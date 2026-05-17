/* global require, module */
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./App.{js,jsx,ts,tsx}', './src/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        primary: '#000000',
        secondary: '#1E1E1E',
        accent: '#CCFF00',
        'activity-red': '#FF3B30',
        'activity-green': '#30D158',
        'activity-blue': '#007AFF',
        'activity-cyan': '#32ADE6',
        'nutrition-protein': '#FFCC00',
        'nutrition-carb': '#FF9500',
        'nutrition-fat': '#FF3B30',
      },
    },
  },
  plugins: [],
};
