import { expect, test } from '@playwright/test';
import { addToCart, cartBadge, demoTestops, summary } from './shop';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('adding products updates the cart badge and the totals', demoTestops('cart-add'), async ({ page }) => {
  await addToCart(page, 'Espresso beans, 250 g', 2);
  await addToCart(page, 'Ceramic mug');
  await expect(cartBadge(page)).toHaveText('3');

  await page.getByRole('link', { name: /Cart/ }).click();
  await expect(summary(page, 'subtotal')).toHaveText('€31.80');
  await expect(summary(page, 'shipping')).toHaveText('€4.90');
  await expect(summary(page, 'total')).toHaveText('€36.70');
});

test('changing the quantity updates the totals', demoTestops('cart-quantity'), async ({ page }) => {
  await addToCart(page, 'Filter coffee, 500 g');
  await page.goto('/#/cart');

  // The cart updates when the field is left, like a change event.
  await page.getByLabel('Quantity of Filter coffee, 500 g').fill('2');
  await page.getByLabel('Quantity of Filter coffee, 500 g').press('Tab');
  await expect(summary(page, 'subtotal')).toHaveText('€29.00');
  await expect(summary(page, 'total')).toHaveText('€33.90');
});

test('removing the last product empties the cart', demoTestops('cart-remove'), async ({ page }) => {
  await addToCart(page, 'Ceramic mug');
  await page.goto('/#/cart');

  await page.getByRole('button', { name: 'Remove Ceramic mug' }).click();
  await expect(page.getByText('Your cart is empty.')).toBeVisible();
  await expect(cartBadge(page)).toHaveText('0');
});

test('orders from €40 ship for free', demoTestops('cart-free-shipping'), async ({ page }) => {
  await addToCart(page, 'Filter coffee, 500 g', 3);
  await page.goto('/#/cart');

  await expect(summary(page, 'shipping')).toHaveText('Free');
  await expect(summary(page, 'total')).toHaveText('€43.50');
});
