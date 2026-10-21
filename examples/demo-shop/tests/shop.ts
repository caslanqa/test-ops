import type { Page } from '@playwright/test';
export { testops } from '@testops/reporter';

export async function addToCart(page: Page, productName: string, times = 1) {
  for (let i = 0; i < times; i++) {
    await page.getByRole('button', { name: `Add ${productName} to cart` }).click();
  }
}

export const cartBadge = (page: Page) => page.locator('#cart-count');
export const summary = (page: Page, name: 'subtotal' | 'discount' | 'shipping' | 'total') => page.getByTestId(name);
