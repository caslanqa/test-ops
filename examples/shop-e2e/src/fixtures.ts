import { test as base } from '@playwright/test';
import { CartPage } from './pages/CartPage';
import { CatalogPage } from './pages/CatalogPage';
import { CheckoutPage } from './pages/CheckoutPage';

/** Tests ask for the page objects they need; each is built from the test's own page. */
export const test = base.extend<{ catalog: CatalogPage; cart: CartPage; checkout: CheckoutPage }>({
  catalog: async ({ page }, use) => {
    await use(new CatalogPage(page));
  },
  cart: async ({ page }, use) => {
    await use(new CartPage(page));
  },
  checkout: async ({ page }, use) => {
    await use(new CheckoutPage(page));
  },
});

export { expect } from '@playwright/test';
