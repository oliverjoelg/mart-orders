/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages serves the site at https://oliverjoelg.github.io/mart-orders/
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/mart-orders/' : '/',
  plugins: [react()],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'supabase/tests/**/*.test.ts'],
    testTimeout: 30_000,
  },
}))
