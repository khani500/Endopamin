import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  return {
    plugins: [react()],
    build: {
      rollupOptions: {
        output: {
          manualChunks: {
            'react-vendor': ['react', 'react-dom', 'react-router-dom'],
            'motion': ['framer-motion'],
            'supabase': ['@supabase/supabase-js'],
            'firebase': ['firebase/app', 'firebase/messaging'],
          },
        },
      },
      chunkSizeWarningLimit: 600,
    },
    server: {
      host: '0.0.0.0',
      port: 5173,
      proxy: {
        '/exercisedb': {
          target: 'https://exercisedb.p.rapidapi.com',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/exercisedb/, ''),
          headers: {
            'X-RapidAPI-Key': env.VITE_EXERCISEDB_KEY || '',
            'X-RapidAPI-Host': 'exercisedb.p.rapidapi.com',
          },
        },
      },
    },
  }
})
