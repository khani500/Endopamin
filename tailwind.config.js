/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,jsx,ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        dark: {
          900: '#050505',
          800: '#111111',
          700: '#1A1A1A',
        },
        accent: {
          primary: '#FF2D55',   // قرمز انرژی
          secondary: '#00E0C0', // فیروزه‌ای
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      }
    },
  },
  plugins: [],
}
