// Builds the DEMO workspace in TestOps for the Bean & Leaf shop, through the public API:
//   - the project, its suites and cases (with steps), automated cases tagged e2e:<key> for the
//     Playwright reporter, and manual-only checks;
//   - requirements linked to their cases, a milestone and a release regression plan;
//   - a manual run with results and step results, and defects.
// The automated runs come from the Playwright tests (npm test with the TestOps settings).
//
//   TESTOPS_URL=https://testops.example.com/api/v1 TESTOPS_TOKEN=<API token> node testops/seed.mjs
//
// The token's owner becomes the workspace admin; use a dedicated demo account, because its name and
// email appear in the member lists. Re-running is safe: it finds what exists by name and only
// adds what is missing. TESTOPS_WORKSPACE_SLUG changes the workspace's slug (default "demo").
const API = process.env.TESTOPS_URL?.trim().replace(/\/+$/, '');
const TOKEN = process.env.TESTOPS_TOKEN?.trim();
const SLUG = process.env.TESTOPS_WORKSPACE_SLUG?.trim() || 'demo';
if (!API || !TOKEN) {
  console.error('Set TESTOPS_URL (e.g. http://localhost:8080/api/v1) and TESTOPS_TOKEN (an API token).');
  process.exit(1);
}

async function call(method, path, body) {
  const res = await fetch(API + path, {
    method,
    headers: {
      authorization: `Bearer ${TOKEN}`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} answered ${res.status}: ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : undefined;
}

/** Finds an item by a field among `list`, or creates it; says which happened. */
async function ensure(kind, list, field, value, create) {
  const found = list.find((item) => item[field] === value);
  if (found) return found;
  const created = await create();
  console.log(`  + ${kind}: ${value}`);
  return created;
}

const step = (action, expectedResult) => ({ action, expectedResult });

// ---------- the repository: suites and cases
const SUITES = [
  {
    name: 'Catalog',
    description: 'Browsing and searching the products.',
    cases: [
      {
        key: 'catalog-list', title: 'The catalog lists every product with its price', priority: 'HIGH', type: 'SMOKE',
        steps: [
          step('Open the shop', 'Espresso beans, Filter coffee, Green tea and Ceramic mug are listed'),
          step('Look at the espresso beans', 'They cost €9.90'),
        ],
      },
      {
        key: 'catalog-search', title: 'Searching narrows the catalog',
        steps: [
          step('Search for "tea"', 'Only Green tea, 100 g is listed'),
          step('Search for "chocolate"', '"No products match your search." is shown'),
        ],
      },
    ],
  },
  {
    name: 'Cart',
    description: 'Adding, changing and removing products; totals and shipping.',
    cases: [
      {
        key: 'cart-add', title: 'Adding products updates the cart badge and the totals', priority: 'HIGH',
        steps: [
          step('Add Espresso beans twice and a Ceramic mug', 'The cart badge shows 3'),
          step('Open the cart', 'Subtotal €31.80, shipping €4.90, total €36.70'),
        ],
      },
      {
        key: 'cart-quantity', title: 'Changing the quantity updates the totals',
        preconditions: 'Filter coffee, 500 g is in the cart.',
        steps: [step('Set the quantity to 2 and leave the field', 'Subtotal €29.00, total €33.90')],
      },
      {
        key: 'cart-remove', title: 'Removing the last product empties the cart',
        preconditions: 'Only a Ceramic mug is in the cart.',
        steps: [step('Remove the Ceramic mug', '"Your cart is empty." is shown and the badge shows 0')],
      },
      {
        key: 'cart-free-shipping', title: 'Orders from €40 ship for free',
        steps: [step('Put three Filter coffee packs in the cart (€43.50)', 'Shipping is Free and the total is €43.50')],
      },
    ],
  },
  {
    name: 'Discounts',
    description: 'Discount codes in the cart.',
    cases: [
      {
        key: 'discount-valid', title: 'A valid code takes 10% off',
        preconditions: 'Filter coffee, 500 g is in the cart.',
        steps: [step('Apply WELCOME10', '"Code WELCOME10 applied: 10% off." Discount −€1.45, total €17.95')],
      },
      {
        key: 'discount-invalid', title: 'An unknown code is rejected',
        steps: [step('Apply SAVE50', '"This discount code isn\'t valid." No discount is taken')],
      },
      {
        key: 'discount-once', title: 'A discount code applies only once', priority: 'HIGH',
        preconditions: 'Filter coffee, 500 g is in the cart.',
        steps: [
          step('Apply WELCOME10', 'The discount is −€1.45'),
          step('Apply WELCOME10 again', 'The discount stays −€1.45'),
        ],
      },
    ],
  },
  {
    name: 'Checkout',
    description: 'Paying by card with the test cards.',
    cases: [
      {
        key: 'checkout-card', title: 'Pays by card and shows the order number', priority: 'CRITICAL', type: 'SMOKE',
        preconditions: 'Espresso beans, 250 g is in the cart.',
        steps: [
          step('Fill in the form with card 4242 4242 4242 4242, expiry 12/30, CVC 123', 'The button says "Pay €14.80"'),
          step('Pay', '"Thank you, <name>!" and "Order #<number> is confirmed. You paid €14.80."'),
          step('Look at the cart badge', 'It shows 0'),
        ],
      },
      {
        key: 'checkout-declined', title: 'A declined card shows an error and keeps the cart', priority: 'HIGH',
        steps: [step('Pay with card 4000 0000 0000 0002', '"Your card was declined. Try another card." The cart keeps its product')],
      },
      {
        key: 'checkout-validation', title: 'The form asks for a valid email and card number',
        steps: [step('Pay with email "ada@" and card "4242 4242"', 'Both fields explain what is wrong and focus moves to the email field')],
      },
      {
        key: 'checkout-paypal', title: 'Pays with PayPal', automationStatus: 'TO_BE_AUTOMATED', priority: 'LOW',
        description: 'PayPal is planned; the automated test is skipped until it exists.',
        steps: [step('Choose PayPal at checkout', 'The PayPal window opens')],
      },
    ],
  },
  {
    name: 'Manual checks',
    description: 'Accessibility and layout, checked by people before each release.',
    cases: [
      {
        title: 'The shop works with the keyboard alone', priority: 'HIGH', manual: true,
        steps: [
          step('Tab through the header, the products, the cart and checkout', 'Every control can be reached and shows a focus ring'),
          step('Place an order without the mouse', 'The order is confirmed'),
        ],
      },
      {
        title: 'A screen reader announces cart changes', manual: true,
        steps: [
          step('With VoiceOver or NVDA running, add a product', '"<product> added to the cart" is announced'),
          step('Remove it in the cart', 'The removal is announced'),
        ],
      },
      {
        title: 'The shop fits a 320 px wide screen', manual: true,
        steps: [
          step('Open the products on a 320 px wide window', 'Nothing scrolls sideways'),
          step('Open the cart with two products', 'The cart table fits the width'),
        ],
      },
      {
        title: 'Prices are shown in euros with two decimals', priority: 'LOW', manual: true,
        steps: [step('Look at the prices in the catalog, the cart and checkout', 'Every price looks like €9.90')],
      },
    ],
  },
];

const REQUIREMENTS = [
  { title: 'Customers can pay by card', externalRef: 'SHOP-1', cases: ['checkout-card', 'checkout-declined', 'checkout-validation'] },
  { title: 'Discount codes', externalRef: 'SHOP-2', cases: ['discount-valid', 'discount-invalid', 'discount-once'] },
  { title: 'Free shipping from €40', externalRef: 'SHOP-3', cases: ['cart-free-shipping'] },
  {
    title: 'Keyboard and screen reader users can shop', externalRef: 'SHOP-4',
    cases: ['The shop works with the keyboard alone', 'A screen reader announces cart changes', 'The shop fits a 320 px wide screen'],
  },
];

const DISCOUNT_DEFECT = 'A discount code can be applied more than once';
const LAYOUT_DEFECT = 'The cart scrolls sideways on a 320 px wide screen';
const MANUAL_RUN = '1.0 release – manual checks';

// ---------- build it
console.log(`TestOps at ${API}`);
const workspaces = await call('GET', '/workspaces');
const workspace = await ensure('workspace', workspaces, 'slug', SLUG, () =>
  call('POST', '/workspaces', { name: 'DEMO', slug: SLUG }));
const projects = await call('GET', `/workspaces/${workspace.id}/projects`);
const project = await ensure('project', projects, 'key', 'SHOP', () =>
  call('POST', `/workspaces/${workspace.id}/projects`, {
    key: 'SHOP',
    name: 'Bean & Leaf shop',
    description: 'An example web shop with manual checks and Playwright tests. Source: github.com/caslanqa/test-ops/tree/master/examples/demo-shop',
  }));
const P = `/projects/${project.id}`;

const suites = await call('GET', `${P}/suites`);
const cases = await call('GET', `${P}/cases`);
const caseIds = new Map();
for (const suite of SUITES) {
  const { id: suiteId } = await ensure('suite', suites, 'name', suite.name, () =>
    call('POST', `${P}/suites`, { name: suite.name, description: suite.description }));
  for (const c of suite.cases) {
    const testCase = await ensure('case', cases, 'title', c.title, () =>
      call('POST', `${P}/cases`, {
        suiteId,
        title: c.title,
        preconditions: c.preconditions,
        description: c.description,
        priority: c.priority ?? 'MEDIUM',
        type: c.type ?? 'FUNCTIONAL',
        automationStatus: c.manual ? 'MANUAL' : c.automationStatus ?? 'AUTOMATED',
        tags: c.key ? [`e2e:${c.key}`, suite.name.toLowerCase()] : [suite.name.toLowerCase()],
        steps: c.steps,
      }));
    caseIds.set(c.key ?? c.title, testCase.id);
  }
}

const requirements = await call('GET', `${P}/requirements`);
for (const r of REQUIREMENTS) {
  if (requirements.some((item) => item.title === r.title)) continue;
  const created = await call('POST', `${P}/requirements`, { title: r.title, externalRef: r.externalRef });
  console.log(`  + requirement: ${r.title}`);
  await call('POST', `${P}/requirements/${created.id}/cases`, { testCaseIds: r.cases.map((key) => caseIds.get(key)) });
}

const dueDate = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString().slice(0, 10);
const milestone = await ensure('milestone', await call('GET', `${P}/milestones`), 'name', '1.0 launch', () =>
  call('POST', `${P}/milestones`, { name: '1.0 launch', dueDate }));
const plan = await ensure('plan', await call('GET', `${P}/plans`), 'title', 'Release regression', () =>
  call('POST', `${P}/plans`, {
    title: 'Release regression',
    description: 'Every case before a release: the automated ones from CI, the manual checks by a tester.',
    milestoneId: milestone.id,
    testCaseIds: [...caseIds.values()],
  }));

const defects = await call('GET', `${P}/defects`);
await ensure('defect', defects, 'title', DISCOUNT_DEFECT, () =>
  call('POST', `${P}/defects`, {
    title: DISCOUNT_DEFECT,
    description: 'Applying WELCOME10 twice takes 20% off instead of 10%. The automated test "A discount code applies only once" fails because of it; each CI run links its failure here.',
    severity: 'HIGH',
    tags: ['discounts'],
  }));

// A manual run of the release checks, partly done, as a tester would leave it.
const runs = await call('GET', `${P}/runs`);
if (!runs.some((r) => r.title === MANUAL_RUN)) {
  const manual = ['The shop works with the keyboard alone', 'A screen reader announces cart changes', 'The shop fits a 320 px wide screen', 'Prices are shown in euros with two decimals'];
  const run = await call('POST', `${P}/runs`, {
    title: MANUAL_RUN,
    description: 'Manual part of the release regression.',
    milestoneId: milestone.id,
    environment: 'Staging',
    build: '1.0.0-rc.1',
    testCaseIds: manual.map((title) => caseIds.get(title)),
  });
  console.log(`  + run: ${MANUAL_RUN}`);
  const minutes = (n) => n * 60_000;
  const result = (title, body) => call('POST', `${P}/runs/${run.id}/results`, { testCaseId: caseIds.get(title), source: 'MANUAL', ...body });
  await result(manual[0], {
    status: 'PASSED',
    durationMs: minutes(6),
    stepResults: [{ stepPosition: 0, status: 'PASSED' }, { stepPosition: 1, status: 'PASSED' }],
  });
  await result(manual[1], {
    status: 'BLOCKED',
    comment: 'VoiceOver passed. No Windows machine with NVDA was free today.',
    durationMs: minutes(9),
    stepResults: [{ stepPosition: 0, status: 'BLOCKED', comment: 'NVDA not available' }],
  });
  const layout = await result(manual[2], {
    status: 'FAILED',
    comment: 'The cart table is wider than the screen.',
    durationMs: minutes(4),
    stepResults: [
      { stepPosition: 0, status: 'PASSED' },
      { stepPosition: 1, status: 'FAILED', comment: 'The table is about 380 px wide, so the whole page scrolls sideways.' },
    ],
  });
  await ensure('defect', defects, 'title', LAYOUT_DEFECT, () =>
    call('POST', `${P}/defects`, {
      title: LAYOUT_DEFECT,
      description: 'On a 320 px wide screen the cart table needs about 380 px, so the page scrolls sideways (WCAG 1.4.10 Reflow).',
      severity: 'MEDIUM',
      tags: ['accessibility'],
      resultIds: [layout.id],
    }));
}

const web = API.replace(/\/api\/v\d+$/, '');
console.log(`
The DEMO workspace is ready: ${web}/workspaces/${workspace.id}

  DEMO_WORKSPACE_ID=${workspace.id}
      Set this on the TestOps server to show the workspace, read-only, to everyone who signs in.
  TESTOPS_PROJECT_ID=${project.id}
      Use it with TESTOPS_URL and TESTOPS_TOKEN when running the Playwright tests (npm test),
      or as the GitHub variable for the demo-shop workflow.
`);
