// Bean & Leaf: a small shop for the TestOps demo. Products, a cart with discount codes and free
// shipping, and a card checkout with test cards. Everything runs in the browser; the cart lives in
// localStorage, so every Playwright test starts with an empty one.
//
// Known bug, on purpose: a discount code can be applied more than once, and each time it takes
// another 10% off. The test "a discount code applies only once" fails because of it, and the
// TestOps DEMO workspace tracks it as a defect.

const PRODUCTS = [
  { id: 'espresso', name: 'Espresso beans, 250 g', price: 990 },
  { id: 'filter', name: 'Filter coffee, 500 g', price: 1450 },
  { id: 'green-tea', name: 'Green tea, 100 g', price: 620 },
  { id: 'mug', name: 'Ceramic mug', price: 1200 },
];
const SHIPPING = 490;
const FREE_SHIPPING_FROM = 4000;
const DISCOUNT_CODES = { WELCOME10: 0.1 };
/** Test cards: this one is declined; any other 16-digit number is accepted. */
const DECLINED_CARD = '4000000000000002';
const STORAGE_KEY = 'demo-shop';

const main = document.getElementById('main');
const announcer = document.getElementById('announcer');

// ---------- state

const money = (cents) => `€${(cents / 100).toFixed(2)}`;
const product = (id) => PRODUCTS.find((p) => p.id === id);
const itemCount = () => Object.values(state.cart).reduce((sum, qty) => sum + qty, 0);

/** The saved cart, keeping only known products, whole quantities and known codes. */
function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    const cart = Object.fromEntries(
      Object.entries(saved.cart ?? {}).filter(([id, qty]) => product(id) && Number.isInteger(qty) && qty > 0 && qty <= 10),
    );
    const codes = (saved.codes ?? []).filter((code) => Object.hasOwn(DISCOUNT_CODES, code));
    return { cart, codes, lastOrder: Number.isInteger(saved.lastOrder) ? saved.lastOrder : 1000 };
  } catch {
    return { cart: {}, codes: [], lastOrder: 1000 };
  }
}

let state = load();

function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  document.getElementById('cart-count').textContent = String(itemCount());
}


function totals() {
  const subtotal = Object.entries(state.cart).reduce((sum, [id, qty]) => sum + product(id).price * qty, 0);
  // The bug: every applied code counts, including the same code applied twice.
  const rate = state.codes.reduce((sum, code) => sum + DISCOUNT_CODES[code], 0);
  const discount = Math.round(subtotal * rate);
  const shipping = subtotal === 0 || subtotal - discount >= FREE_SHIPPING_FROM ? 0 : SHIPPING;
  return { subtotal, discount, shipping, total: subtotal - discount + shipping };
}

function announce(text) {
  announcer.textContent = '';
  // A new text node makes screen readers announce the same message again.
  setTimeout(() => (announcer.textContent = text), 50);
}

const escape = (text) =>
  String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// ---------- pages

function catalogPage(query = '') {
  const shown = PRODUCTS.filter((p) => p.name.toLowerCase().includes(query.trim().toLowerCase()));
  main.innerHTML = `
    <h1>Products</h1>
    <div class="field">
      <label for="search">Search products</label>
      <input id="search" type="search" value="${escape(query)}" autocomplete="off" />
    </div>
    ${shown.length === 0 ? '<p class="empty">No products match your search.</p>' : ''}
    <ul class="products">
      ${shown
        .map(
          (p) => `
        <li class="product">
          <h2>${escape(p.name)}</h2>
          <p class="price">${money(p.price)}</p>
          <button type="button" data-add="${p.id}">Add ${escape(p.name)} to cart</button>
        </li>`,
        )
        .join('')}
    </ul>`;
  const search = main.querySelector('#search');
  search.addEventListener('input', () => {
    catalogPage(search.value);
    const again = main.querySelector('#search');
    again.focus();
    again.setSelectionRange(again.value.length, again.value.length);
  });
  main.querySelectorAll('[data-add]').forEach((button) =>
    button.addEventListener('click', () => {
      const id = button.dataset.add;
      state.cart[id] = Math.min((state.cart[id] ?? 0) + 1, 10);
      save();
      announce(`${product(id).name} added to the cart. ${itemCount()} items in the cart.`);
    }),
  );
}

function summaryRows() {
  const { subtotal, discount, shipping, total } = totals();
  return `
    <dl class="summary">
      <div><dt>Subtotal</dt><dd data-testid="subtotal">${money(subtotal)}</dd></div>
      ${discount ? `<div><dt>Discount</dt><dd data-testid="discount">−${money(discount)}</dd></div>` : ''}
      <div><dt>Shipping</dt><dd data-testid="shipping">${shipping === 0 ? 'Free' : money(shipping)}</dd></div>
      <div class="total"><dt>Total</dt><dd data-testid="total">${money(total)}</dd></div>
    </dl>`;
}

function cartPage(message = null) {
  const lines = Object.entries(state.cart);
  if (lines.length === 0) {
    main.innerHTML = `
      <h1>Cart</h1>
      <p class="empty">Your cart is empty.</p>
      <p><a href="#/">Browse the products</a></p>`;
    return;
  }
  main.innerHTML = `
    <h1>Cart</h1>
    <table class="cart">
      <caption class="visually-hidden">Products in your cart</caption>
      <thead><tr><th scope="col">Product</th><th scope="col">Quantity</th><th scope="col">Price</th><th scope="col"><span class="visually-hidden">Remove</span></th></tr></thead>
      <tbody>
        ${lines
          .map(([id, qty]) => {
            const p = product(id);
            return `
          <tr>
            <th scope="row">${escape(p.name)}</th>
            <td><input type="number" min="1" max="10" value="${qty}" data-qty="${id}" aria-label="Quantity of ${escape(p.name)}" /></td>
            <td>${money(p.price * qty)}</td>
            <td><button type="button" class="link" data-remove="${id}">Remove ${escape(p.name)}</button></td>
          </tr>`;
          })
          .join('')}
      </tbody>
    </table>
    <form class="discount" novalidate>
      <label for="code">Discount code</label>
      <input id="code" autocomplete="off" />
      <button type="submit">Apply</button>
    </form>
    ${message ? `<p class="${message.error ? 'error' : 'note'}" role="${message.error ? 'alert' : 'status'}">${escape(message.text)}</p>` : ''}
    ${summaryRows()}
    <p><a class="button" href="#/checkout">Checkout</a></p>`;

  main.querySelectorAll('[data-qty]').forEach((input) =>
    input.addEventListener('change', () => {
      const qty = Math.max(1, Math.min(10, Number(input.value) || 1));
      state.cart[input.dataset.qty] = qty;
      save();
      cartPage();
      announce(`Quantity updated. Total ${money(totals().total)}.`);
    }),
  );
  main.querySelectorAll('[data-remove]').forEach((button) =>
    button.addEventListener('click', () => {
      delete state.cart[button.dataset.remove];
      if (itemCount() === 0) state.codes = [];
      save();
      cartPage();
      main.querySelector('h1').focus();
      announce(`${product(button.dataset.remove).name} removed from the cart.`);
    }),
  );
  main.querySelector('.discount').addEventListener('submit', (event) => {
    event.preventDefault();
    const code = main.querySelector('#code').value.trim().toUpperCase();
    if (!Object.hasOwn(DISCOUNT_CODES, code)) {
      cartPage({ error: true, text: "This discount code isn't valid." });
      return;
    }
    state.codes.push(code);
    save();
    cartPage({ error: false, text: `Code ${code} applied: ${DISCOUNT_CODES[code] * 100}% off.` });
  });
}

function checkoutPage(errors = {}, values = {}) {
  if (itemCount() === 0) {
    cartPage();
    return;
  }
  const field = (id, label, attrs = '') => `
    <div class="field">
      <label for="${id}">${label}</label>
      <input id="${id}" name="${id}" value="${escape(values[id] ?? '')}" ${attrs}
        ${errors[id] ? `aria-invalid="true" aria-describedby="${id}-error"` : ''} />
      ${errors[id] ? `<p class="error" id="${id}-error">${escape(errors[id])}</p>` : ''}
    </div>`;
  main.innerHTML = `
    <h1>Checkout</h1>
    ${errors.payment ? `<p class="error" role="alert">${escape(errors.payment)}</p>` : ''}
    <form class="checkout" novalidate>
      ${field('name', 'Name on card', 'autocomplete="cc-name"')}
      ${field('email', 'Email', 'type="email" autocomplete="email"')}
      ${field('card', 'Card number', 'inputmode="numeric" autocomplete="cc-number"')}
      <div class="field-row">
        ${field('expiry', 'Expiry (MM/YY)', 'autocomplete="cc-exp"')}
        ${field('cvc', 'CVC', 'inputmode="numeric" autocomplete="cc-csc"')}
      </div>
      ${summaryRows()}
      <button type="submit">Pay ${money(totals().total)}</button>
    </form>
    <p class="hint">Test cards: 4242 4242 4242 4242 is accepted, 4000 0000 0000 0002 is declined.</p>`;

  main.querySelector('.checkout').addEventListener('submit', (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.target));
    const card = String(data.card).replace(/\s+/g, '');
    const found = {};
    if (!String(data.name).trim()) found.name = 'Enter the name on the card.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(data.email))) found.email = 'Enter an email address like name@example.com.';
    if (!/^\d{16}$/.test(card)) found.card = 'Enter the 16 digits of the card number.';
    if (!/^(0[1-9]|1[0-2])\/\d{2}$/.test(String(data.expiry))) found.expiry = 'Enter the expiry date as MM/YY.';
    if (!/^\d{3}$/.test(String(data.cvc))) found.cvc = 'Enter the 3 digits on the back of the card.';
    if (Object.keys(found).length > 0) {
      checkoutPage(found, data);
      main.querySelector('[aria-invalid="true"]').focus();
      return;
    }
    if (card === DECLINED_CARD) {
      checkoutPage({ payment: 'Your card was declined. Try another card.' }, data);
      return;
    }
    const paid = totals().total;
    state.lastOrder += 1;
    state.cart = {};
    state.codes = [];
    save();
    location.hash = `#/order/${state.lastOrder}?paid=${paid}&name=${encodeURIComponent(String(data.name).trim())}`;
  });
}

function orderPage(number, params) {
  main.innerHTML = `
    <h1>Thank you, ${escape(params.get('name') ?? '')}!</h1>
    <p class="confirmation">Order #${escape(number)} is confirmed. You paid ${money(Number(params.get('paid')))}.</p>
    <p><a href="#/">Continue shopping</a></p>`;
}

// ---------- routing

function route() {
  const [path, query = ''] = location.hash.replace(/^#/, '').split('?');
  const order = path.match(/^\/order\/(\d+)$/);
  if (path === '/cart') cartPage();
  else if (path === '/checkout') checkoutPage();
  else if (order) orderPage(order[1], new URLSearchParams(query));
  else catalogPage();
  document.title = `${main.querySelector('h1').textContent} – Bean & Leaf`;
  // A new page moves focus to its heading, as a page load would (WCAG 2.4.3).
  main.querySelector('h1').setAttribute('tabindex', '-1');
  main.querySelector('h1').focus();
}

window.addEventListener('hashchange', route);
save();
route();
