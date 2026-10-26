import { expect, test } from '../src/fixtures';

test.beforeEach(async ({ catalog }) => {
  await catalog.goto();
});

test('the catalog lists every product with its price', async ({ catalog }) => {
  await expect(catalog.titles).toHaveText([
    'Espresso beans, 250 g',
    'Filter coffee, 500 g',
    'Green tea, 100 g',
    'Ceramic mug',
  ]);
  await expect(catalog.product('Espresso beans')).toContainText('€9.90');
});

test('searching narrows the catalog', async ({ catalog }) => {
  await catalog.search('tea');
  await expect(catalog.titles).toHaveText(['Green tea, 100 g']);

  await catalog.search('chocolate');
  await expect(catalog.emptyResult).toBeVisible();
});
