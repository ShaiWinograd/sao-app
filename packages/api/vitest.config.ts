import { defineConfig } from 'vitest/config';

// The integration specs share one Postgres database and reset it in beforeEach,
// so they must not run in parallel with each other.
export default defineConfig({
  test: {
    fileParallelism: false,
  },
});
