import { expect, test, type Page } from '@playwright/test';
import { addToCart, cartBadge, testops } from './shop';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await addToCart(page, 'Espresso beans, 250 g');
  await page.goto('/#/checkout');
});

async function fillCard(page: Page, card: string, { email = 'ada@example.com' } = {}) {
  await page.getByLabel('Name on card').fill('Ada Lovelace');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Card number').fill(card);
  await page.getByLabel('Expiry (MM/YY)').fill('12/30');
  await page.getByLabel('CVC').fill('123');
}

test('pays by card and shows the order number', testops('checkout-card'), async ({ page }) => {
  await fillCard(page, '4242 4242 4242 4242');
  await page.getByRole('button', { name: 'Pay €14.80' }).click();

  await expect(page.getByRole('heading', { name: 'Thank you, Ada Lovelace!' })).toBeVisible();
  await expect(page.getByText(/Order #\d+ is confirmed\. You paid €14\.80\./)).toBeVisible();
  await expect(cartBadge(page)).toHaveText('0');
});

test('a declined card shows an error and keeps the cart', testops('checkout-declined'), async ({ page }) => {
  await fillCard(page, '4000 0000 0000 0002');
  await page.getByRole('button', { name: /Pay/ }).click();

  await expect(page.getByRole('alert')).toHaveText('Your card was declined. Try another card.');
  await expect(cartBadge(page)).toHaveText('1');
});

test('the form asks for a valid email and card number', testops('checkout-validation'), async ({ page }) => {
  await fillCard(page, '4242 4242', { email: 'ada@' });
  await page.getByRole('button', { name: /Pay/ }).click();

  await expect(page.getByLabel('Email')).toHaveAccessibleDescription('Enter an email address like name@example.com.');
  await expect(page.getByLabel('Card number')).toHaveAccessibleDescription('Enter the 16 digits of the card number.');
  await expect(page.getByLabel('Email')).toBeFocused();
});

test('pays with PayPal', testops('checkout-paypal'), async () => {
  test.skip(true, "PayPal isn't available in the demo shop yet");
});
