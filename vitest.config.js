import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'src/**/*.test.{js,jsx,ts,tsx}',
      'tests/**/*.test.{js,jsx,ts,tsx}',
    ],
  },
});
