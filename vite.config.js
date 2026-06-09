import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  return {
    plugins: [react()],
    build: {
      rolldownOptions: {
        output: {
          codeSplitting: {
            groups: [
              {
                test: /node_modules\/(react|react-dom|react-router-dom)\//,
                name: 'react-vendor',
              },
              {
                test: /node_modules\/framer-motion\//,
                name: 'motion',
              },
              {
                test: /node_modules\/@supabase\/supabase-js\//,
                name: 'supabase',
              },
              {
                test: /node_modules\/firebase\//,
                name: 'firebase',
              },
            ],
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
