import { defineConfig } from '@playwright/test';

// The dashboard is a single self-contained file opened over file:// — no web server.
export default defineConfig({
  testDir: 'tests',
  timeout: 60_000,
  retries: 0,
  reporter: [['list']],
  use: {
    browserName: 'chromium',
    viewport: { width: 1440, height: 900 },
    screenshot: 'only-on-failure',
    launchOptions: process.env.PW_CHROMIUM_PATH
      ? { executablePath: process.env.PW_CHROMIUM_PATH }
      : {}
  }
});
