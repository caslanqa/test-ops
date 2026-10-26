import { expect, test } from '@playwright/test';
import { demoTestops } from './shop';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('the catalog lists every product with its price', demoTestops('catalog-list'), async ({ page }) => {
  await expect(page.getByRole('heading', { level: 2 })).toHaveText([
    'Espresso beans, 250 g',
    'Filter coffee, 500 g',
    'Green tea, 100 g',
    'Ceramic mug',
  ]);
  await expect(page.locator('.product').filter({ hasText: 'Espresso beans' })).toContainText('€9.90');
});

test('searching narrows the catalog', demoTestops('catalog-search'), async ({ page }) => {
  await page.getByLabel('Search products').fill('tea');
  await expect(page.getByRole('heading', { level: 2 })).toHaveText(['Green tea, 100 g']);

  await page.getByLabel('Search products').fill('chocolate');
  await expect(page.getByText('No products match your search.')).toBeVisible();
});
