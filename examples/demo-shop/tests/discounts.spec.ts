import { expect, test } from '@playwright/test';
import { addToCart, demoTestops, summary } from './shop';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await addToCart(page, 'Filter coffee, 500 g');
  await page.goto('/#/cart');
});

async function applyCode(page: import('@playwright/test').Page, code: string) {
  await page.getByLabel('Discount code').fill(code);
  await page.getByRole('button', { name: 'Apply' }).click();
}

test('a valid code takes 10% off', demoTestops('discount-valid'), async ({ page }) => {
  await applyCode(page, 'WELCOME10');
  await expect(page.getByRole('status').filter({ hasText: 'applied' })).toHaveText('Code WELCOME10 applied: 10% off.');
  await expect(summary(page, 'discount')).toHaveText('−€1.45');
  await expect(summary(page, 'total')).toHaveText('€17.95');
});

test('an unknown code is rejected', demoTestops('discount-invalid'), async ({ page }) => {
  await applyCode(page, 'SAVE50');
  await expect(page.getByRole('alert')).toHaveText("This discount code isn't valid.");
  await expect(summary(page, 'discount')).toHaveCount(0);
});

// The shop has this bug on purpose: the code stacks, so the second time takes another 10% off.
// test.fail() keeps the build green while the bug is known; the reporter still records the
// result as Failed in TestOps and links it to the open defect.
test(
  'a discount code applies only once',
  demoTestops('discount-once', 'A discount code can be applied more than once'),
  async ({ page }) => {
    test.fail(true, 'the same code can be applied twice');
    await applyCode(page, 'WELCOME10');
    await applyCode(page, 'WELCOME10');
    // The page has settled after the second Apply; no need to wait the default 5 s for the bug.
    await expect(summary(page, 'discount')).toHaveText('−€1.45', { timeout: 1000 });
  },
);
