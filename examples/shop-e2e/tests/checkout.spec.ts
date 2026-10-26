import { expect, test } from '../src/fixtures';

test.beforeEach(async ({ catalog, checkout }) => {
  await catalog.goto();
  await catalog.addToCart('Espresso beans, 250 g');
  await checkout.goto();
});

test('pays by card and shows the order number', async ({ catalog, checkout }, testInfo) => {
  // The step titles are the case's step texts, so TestOps reports each step against its case step.
  await test.step('Fill in the card details', async () => {
    await checkout.fillCard('4242 4242 4242 4242');
  });

  await test.step('Pay by card', async () => {
    await checkout.pay();
    await expect(checkout.thankYou('Ada Lovelace')).toBeVisible();
    await expect(checkout.orderLine).toBeVisible();
    await expect(catalog.cartBadge).toHaveText('0');
  });

  // Files added with testInfo.attach() are uploaded to TestOps with the result.
  const confirmation = (await checkout.orderLine.textContent()) ?? '';
  await testInfo.attach('order-number', { body: confirmation.match(/#\d+/)?.[0] ?? '', contentType: 'text/plain' });
});

test('a declined card shows an error and keeps the cart', async ({ catalog, checkout }, testInfo) => {
  // SHOP_E2E_FLAKY=1 makes the first attempt fail on purpose, so the retry decides the result and only
  // that last attempt is reported to TestOps.
  if (process.env.SHOP_E2E_FLAKY && testInfo.retry === 0) {
    throw new Error('flaky on purpose: the first attempt fails so the retry decides the result');
  }
  await checkout.fillCard('4000 0000 0000 0002');
  await checkout.pay();

  await expect(checkout.declined).toHaveText('Your card was declined. Try another card.');
  await expect(catalog.cartBadge).toHaveText('1');
});

test('pays with PayPal', async () => {
  test.skip(true, "PayPal isn't available in the demo shop yet");
});
