import type { Locator, Page } from '@playwright/test';

/** The cart: its lines, the totals and the discount code field. */
export class CartPage {
  readonly emptyMessage: Locator;
  readonly codeAccepted: Locator;
  readonly codeError: Locator;

  constructor(private readonly page: Page) {
    this.emptyMessage = page.getByText('Your cart is empty.');
    this.codeAccepted = page.getByRole('status').filter({ hasText: 'applied' });
    this.codeError = page.getByRole('alert');
  }

  async goto() {
    await this.page.goto('/#/cart');
  }

  async openFromHeader() {
    await this.page.getByRole('link', { name: /Cart/ }).click();
  }

  summary(name: 'subtotal' | 'discount' | 'shipping' | 'total'): Locator {
    return this.page.getByTestId(name);
  }

  /** The cart updates when the field is left, like a change event, hence the Tab. */
  async setQuantity(product: string, quantity: number) {
    const field = this.page.getByLabel(`Quantity of ${product}`);
    await field.fill(String(quantity));
    await field.press('Tab');
  }

  async remove(product: string) {
    await this.page.getByRole('button', { name: `Remove ${product}` }).click();
  }

  async applyCode(code: string) {
    await this.page.getByLabel('Discount code').fill(code);
    await this.page.getByRole('button', { name: 'Apply' }).click();
  }
}
