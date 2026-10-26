import type { Locator, Page } from '@playwright/test';

/** The shop's front page: the product list, the search box and the cart badge in the header. */
export class CatalogPage {
  readonly titles: Locator;
  readonly cartBadge: Locator;
  readonly emptyResult: Locator;

  constructor(private readonly page: Page) {
    this.titles = page.getByRole('heading', { level: 2 });
    this.cartBadge = page.locator('#cart-count');
    this.emptyResult = page.getByText('No products match your search.');
  }

  async goto() {
    await this.page.goto('/');
  }

  product(name: string): Locator {
    return this.page.locator('.product').filter({ hasText: name });
  }

  async search(text: string) {
    await this.page.getByLabel('Search products').fill(text);
  }

  async addToCart(name: string, times = 1) {
    for (let i = 0; i < times; i++) {
      await this.page.getByRole('button', { name: `Add ${name} to cart` }).click();
    }
  }
}
