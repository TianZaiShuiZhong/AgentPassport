import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser',
  timeout: 45000,
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:5273',
    browserName: 'chromium',
    ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}),
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node scripts/dev.mjs --production',
    url: 'http://127.0.0.1:5273',
    timeout: 90000,
    reuseExistingServer: false,
    env: {
      UI_PORT: '5273',
      VAULT_PORT: '8877',
      RESEARCH_PORT: '8878',
      WRITER_PORT: '8879',
      DATA_DIR: `.data/e2e-${Date.now()}`,
      CHAIN_MODE: 'local',
      LLM_API_KEY: '',
    },
  },
});
