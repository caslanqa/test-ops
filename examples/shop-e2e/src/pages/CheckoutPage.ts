import type { Locator, Page } from '@playwright/test';

/** The card checkout and the confirmation that follows it. */
export class CheckoutPage {
  readonly orderLine: Locator;
  readonly declined: Locator;

  constructor(private readonly page: Page) {
    this.orderLine = page.getByText(/Order #\d+ is confirmed\. You paid €14\.80\./);
    this.declined = page.getByRole('alert');
  }

  async goto() {
    await this.page.goto('/#/checkout');
  }

  async fillCard(card: string, { email = 'ada@example.com' }: { email?: string } = {}) {
    await this.page.getByLabel('Name on card').fill('Ada Lovelace');
    await this.page.getByLabel('Email').fill(email);
    await this.page.getByLabel('Card number').fill(card);
    await this.page.getByLabel('Expiry (MM/YY)').fill('12/30');
    await this.page.getByLabel('CVC').fill('123');
  }

  async pay() {
    await this.page.getByRole('button', { name: /Pay/ }).click();
  }

  thankYou(name: string): Locator {
    return this.page.getByRole('heading', { name: `Thank you, ${name}!` });
  }
}
