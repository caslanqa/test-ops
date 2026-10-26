import { expect, test } from '../src/fixtures';

test.beforeEach(async ({ catalog }) => {
  await catalog.goto();
});

test('adding products updates the cart badge and the totals', async ({ catalog, cart }) => {
  // The step titles are the case's step texts, so TestOps reports each step against its case step.
  await test.step('Add Espresso beans twice and a Ceramic mug', async () => {
    await catalog.addToCart('Espresso beans, 250 g', 2);
    await catalog.addToCart('Ceramic mug');
    await expect(catalog.cartBadge).toHaveText('3');
  });

  await test.step('Open the cart', async () => {
    await cart.openFromHeader();
    await expect(cart.summary('subtotal')).toHaveText('€31.80');
    await expect(cart.summary('shipping')).toHaveText('€4.90');
    await expect(cart.summary('total')).toHaveText('€36.70');
  });
});

test('changing the quantity updates the totals', async ({ catalog, cart }) => {
  await catalog.addToCart('Filter coffee, 500 g');
  await cart.goto();

  await cart.setQuantity('Filter coffee, 500 g', 2);
  await expect(cart.summary('subtotal')).toHaveText('€29.00');
  await expect(cart.summary('total')).toHaveText('€33.90');
});

test('removing the last product empties the cart', async ({ catalog, cart }) => {
  await catalog.addToCart('Ceramic mug');
  await cart.goto();

  await cart.remove('Ceramic mug');
  await expect(cart.emptyMessage).toBeVisible();
  await expect(catalog.cartBadge).toHaveText('0');
});

test('orders from €40 ship for free', async ({ catalog, cart }) => {
  await catalog.addToCart('Filter coffee, 500 g', 3);
  await cart.goto();

  await expect(cart.summary('shipping')).toHaveText('Free');
  await expect(cart.summary('total')).toHaveText('€43.50');
});
