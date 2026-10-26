import { test as base } from '@playwright/test';
import { CartPage } from './pages/CartPage';
import { CatalogPage } from './pages/CatalogPage';

/** Tests ask for the page objects they need; each is built from the test's own page. */
export const test = base.extend<{ catalog: CatalogPage; cart: CartPage }>({
  catalog: async ({ page }, use) => {
    await use(new CatalogPage(page));
  },
  cart: async ({ page }, use) => {
    await use(new CartPage(page));
  },
});

export { expect } from '@playwright/test';
