const { defineConfig, devices } = require('@playwright/test');

const URL = 'https://ciliegio-shop.netlify.app/CiliegioShop.html';

module.exports = defineConfig({
  testDir: './tests',
  timeout: 90000,
  expect: { timeout: 12000 },
  retries: 1,
  reporter: [['html', { open: 'never' }], ['list']],

  projects: [
    // Desktop
    {
      name: 'Desktop Chrome',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'Desktop Firefox',
      use: { ...devices['Desktop Firefox'], navigationTimeout: 60000 },
    },
    {
      name: 'Desktop Safari',
      use: { ...devices['Desktop Safari'] },
    },

    // Mobile iOS
    {
      name: 'iPhone 14',
      use: { ...devices['iPhone 14'] },
    },
    {
      name: 'iPhone SE',
      use: { ...devices['iPhone SE'] },
    },
    {
      name: 'iPad Pro',
      use: { ...devices['iPad Pro 11'] },
    },

    // Mobile Android
    {
      name: 'Pixel 7',
      use: { ...devices['Pixel 7'] },
    },
    {
      name: 'Galaxy S23',
      use: { ...devices['Galaxy S8'] },
    },
    {
      name: 'Samsung Internet',
      use: {
        ...devices['Galaxy S8'],
        userAgent: 'Mozilla/5.0 (Linux; Android 13; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/23.0 Chrome/115.0.0.0 Mobile Safari/537.36',
      },
    },
  ],

  use: {
    baseURL: URL,
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    trace: 'retain-on-failure',
    navigationTimeout: 30000,
  },
});
