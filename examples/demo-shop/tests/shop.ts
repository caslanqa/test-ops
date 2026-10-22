import type { Page } from '@playwright/test';
import { testops } from '@testops/reporter';

/** The per-user demo gets fresh TestOps IDs; the webhook supplies those IDs for the demo refs. */
export function demoTestops(ref: string, defectTitle?: string) {
  const name = ref.replace(/[^A-Za-z0-9]/g, '_').toUpperCase();
  return testops(process.env[`TESTOPS_CASE_${name}`], defectTitle);
}

export async function addToCart(page: Page, productName: string, times = 1) {
  for (let i = 0; i < times; i++) {
    await page.getByRole('button', { name: `Add ${productName} to cart` }).click();
  }
}

export const cartBadge = (page: Page) => page.locator('#cart-count');
export const summary = (page: Page, name: 'subtotal' | 'discount' | 'shipping' | 'total') => page.getByTestId(name);
