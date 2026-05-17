/* global process */
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import mkcert from 'vite-plugin-mkcert'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    process.env.VITE_DISABLE_MKCERT !== 'true' && mkcert(),
  ].filter(Boolean),
  server: {
    host: true,
  },
})
