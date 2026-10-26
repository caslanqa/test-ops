import { test as base } from '@playwright/test';
import { CatalogPage } from './pages/CatalogPage';

/** Tests ask for the page objects they need; each is built from the test's own page. */
export const test = base.extend<{ catalog: CatalogPage }>({
  catalog: async ({ page }, use) => {
    await use(new CatalogPage(page));
  },
});

export { expect } from '@playwright/test';
