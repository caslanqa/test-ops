import type { Page, TestDetails } from '@playwright/test';

/**
 * Links a test to its TestOps case. The reporter finds the case that has the tag `e2e:<key>`
 * (the DEMO workspace and testops/seed.mjs have them), so the link survives renaming either side.
 * The test also gets the Playwright tag @<key>, so CI can run just the cases TestOps asks for
 * (--grep, from the webhook's automation_keys). `defect` names an open TestOps defect that a
 * failure of this test is linked to.
 */
export function testops(key: string, defect?: string): TestDetails {
  return {
    tag: `@${key}`,
    annotation: [
      { type: 'testops', description: key },
      ...(defect ? [{ type: 'testops-defect', description: defect }] : []),
    ],
  };
}

export async function addToCart(page: Page, productName: string, times = 1) {
  for (let i = 0; i < times; i++) {
    await page.getByRole('button', { name: `Add ${productName} to cart` }).click();
  }
}

export const cartBadge = (page: Page) => page.locator('#cart-count');
export const summary = (page: Page, name: 'subtotal' | 'discount' | 'shipping' | 'total') => page.getByTestId(name);
