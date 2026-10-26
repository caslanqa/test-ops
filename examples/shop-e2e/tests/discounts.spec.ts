import { expect, test } from '../src/fixtures';

test.beforeEach(async ({ catalog, cart }) => {
  await catalog.goto();
  await catalog.addToCart('Filter coffee, 500 g');
  await cart.goto();
});

test('a valid code takes 10% off', async ({ cart }) => {
  await cart.applyCode('WELCOME10');
  await expect(cart.codeAccepted).toHaveText('Code WELCOME10 applied: 10% off.');
  await expect(cart.summary('discount')).toHaveText('−€1.45');
  await expect(cart.summary('total')).toHaveText('€17.95');
});

test('an unknown code is rejected', async ({ cart }) => {
  await cart.applyCode('SAVE50');
  await expect(cart.codeError).toHaveText("This discount code isn't valid.");
  await expect(cart.summary('discount')).toHaveCount(0);
});

// The shop has this bug on purpose: the code stacks, so the second time takes another 10% off.
// By default the test is expected to fail, which keeps the build green while the bug is known.
// SHOP_E2E_STRICT=1 turns that off, so the failure is real and TestOps gets the failed result with
// its screenshot, video and trace.
test('a discount code applies only once', async ({ cart }) => {
  test.fail(!process.env.SHOP_E2E_STRICT, 'the same code can be applied twice');
  await cart.applyCode('WELCOME10');
  await cart.applyCode('WELCOME10');
  // The page has settled after the second Apply; no need to wait the default 5 s for the bug.
  await expect(cart.summary('discount')).toHaveText('−€1.45', { timeout: 1000 });
});
