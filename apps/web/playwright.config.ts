import { defineConfig, devices } from '@playwright/test';

// Assumes the API and its database are already running (`docker compose up -d db`
// plus `pnpm --filter api run start:dev`); only the web dev server is started here.
export default defineConfig({
  testDir: './e2e',
  use: {
    baseURL: 'http://localhost:4200',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'pnpm exec ng serve --port 4200',
    url: 'http://localhost:4200',
    // ponytail: CI doesn't run e2e; use !process.env.CI (needs @types/node) if it ever does
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
