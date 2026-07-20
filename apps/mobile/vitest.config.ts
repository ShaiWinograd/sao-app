import { defineConfig } from 'vitest/config';

// Only the pure, React-Native-free logic modules are unit-tested here (no native
// mocks required). The expo-location/React hooks are integration-tested on device.
export default defineConfig({
  test: {
    include: ['lib/**/*.spec.ts'],
  },
});
