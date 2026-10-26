import { defineConfig, devices } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const port = Number(process.env.PORT ?? 4173);

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  // The package sends results to TestOps when TESTOPS_URL, TESTOPS_TOKEN and TESTOPS_PROJECT_ID
  // are set; without them, the local Playwright reporters still work.
  reporter: [['list'], ['html', { open: 'never' }], [require.resolve('@testops/reporter')]],
  use: {
    baseURL: `http://localhost:${port}`,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'node server.mjs',
    url: `http://localhost:${port}`,
    reuseExistingServer: !process.env.CI,
  },
});
