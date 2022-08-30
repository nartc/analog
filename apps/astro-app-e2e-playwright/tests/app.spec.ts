import { chromium, Browser, Page } from 'playwright';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  test,
  describe,
} from 'vitest';

let browser: Browser;
let page: Page;

beforeAll(async () => {
  browser = await chromium.launch();
});
afterAll(async () => {
  await browser.close();
});

beforeEach(async () => {
  page = await browser.newPage({
    baseURL: 'http://localhost:3000',
  });
  await page.goto('/');
});
afterEach(async () => {
  await page.close();
});

const cases = [
  [
    'client side rendered CardComponent is rendered',
    'astro-island[component-export="CardComponent"]',
    'Angular (Client Side)',
  ],
  [
    'server side rendered CardComponent is rendered',
    'astro-card',
    'Angular (server side binding)',
  ],
];

describe('AstroApp', () => {
  describe('Given the user has navigated to the home page', () => {
    test.each(cases)('Then %s', async (_, selector, text) => {
      const componentLocator = page.locator(selector);
      await expect(componentLocator.locator(`>> text=${text}`)).toContain(
        new RegExp(text, 'i')
      );
    });
  });
});
