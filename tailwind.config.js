/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,jsx,ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: '#000000',
        secondary: '#1E1E1E',
        accent: {
          DEFAULT: '#CCFF00',
          primary: '#CCFF00',
          secondary: '#00E0C0',
        },
        'activity-red': '#FF3B30',
        'activity-green': '#30D158',
        'activity-blue': '#007AFF',
        'activity-cyan': '#32ADE6',
        'nutrition-protein': '#FFCC00',
        'nutrition-carb': '#FF9500',
        'nutrition-fat': '#FF3B30',
        dark: {
          900: '#050505',
          800: '#111111',
          700: '#1A1A1A',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      }
    },
  },
  plugins: [],
}
