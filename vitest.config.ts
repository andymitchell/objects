import { defineConfig, configDefaults } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    testTimeout: 15000,
    // The MongoDB ground-truth corpus boots a real mongod, downloading its binary on first run. It is the final
    // authority on a conformance question, but far too heavy to pay for on every run: `npm run test:mongo-truth`.
    exclude: [...configDefaults.exclude, '**/*.mongo-truth.test.ts'],
  },
})
