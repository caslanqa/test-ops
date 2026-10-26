import { defineConfig, devices } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const port = Number(process.env.PORT ?? 4174);
// With TESTOPS_ATTACHMENTS=all the reporter uploads files for every result, so Playwright has to record
// them for every test; by default it keeps them only for failures.
const record = process.env.TESTOPS_ATTACHMENTS === 'all' ? 'on' : 'retain-on-failure';

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: 1,
  // The package sends results to TestOps when TESTOPS_URL, TESTOPS_TOKEN and TESTOPS_PROJECT_ID are
  // set; without them it stays silent and the other reporters still work.
  reporter: [['list'], ['html', { open: 'never' }], [require.resolve('@testops/reporter')]],
  use: {
    baseURL: `http://localhost:${port}`,
    screenshot: record === 'on' ? 'on' : 'only-on-failure',
    video: record,
    trace: record,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  // The shop is the one from the demo-shop example: three static files and a tiny server.
  webServer: {
    command: 'node ../demo-shop/server.mjs',
    url: `http://localhost:${port}`,
    reuseExistingServer: !process.env.CI,
    env: { PORT: String(port) },
  },
});
