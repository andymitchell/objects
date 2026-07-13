import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    include: ['**/*.mongo-truth.test.ts'],
    // Booting a mongod is slow, and the very first run also downloads its binary.
    testTimeout: 120_000,
    hookTimeout: 300_000,
  },
})
