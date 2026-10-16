import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// Отдельный конфиг для тестов: без PWA-плагина и dev-mock API.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    restoreMocks: true,
  },
})
