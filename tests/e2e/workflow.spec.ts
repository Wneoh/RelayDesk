import { test, expect, type Page } from '@playwright/test';
async function signIn(page: Page, role: 'customer' | 'admin') {
  await page.goto('/');
  await page
    .getByRole('button', {
      name: role === 'admin' ? /Enter admin workspace/ : /Try the customer experience/,
    })
    .click();
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeAttached();
}
async function navigate(page: Page, name: RegExp | string) {
  const menu = page.getByRole('button', { name: 'Open navigation', exact: true });
  if (await menu.isVisible()) await menu.click();
  await page.locator('nav').getByRole('button', { name }).click();
}
test('customer, specialist, and administrator complete the reviewed order workflow', async ({
  browser,
}) => {
  const customerContext = await browser.newContext(),
    adminContext = await browser.newContext();
  const customer = await customerContext.newPage(),
    admin = await adminContext.newPage();
  const subject = `Delivery address for RD-2048 ${Date.now()}`;
  try {
    await signIn(customer, 'customer');
    await customer.getByRole('button', { name: 'Submit a ticket', exact: true }).click();
    await customer.getByLabel('Subject', { exact: true }).fill(subject);
    await customer
      .getByLabel('Tell us a little more')
      .fill('Please help me change the delivery address for order RD-2048 before it ships.');
    await customer.getByRole('button', { name: 'Create ticket', exact: true }).click();
    await expect(customer.getByRole('heading', { name: subject, exact: true })).toBeVisible();
    await signIn(admin, 'admin');
    await navigate(admin, /All tickets/);
    await admin.getByRole('textbox', { name: 'Search tickets', exact: true }).fill(subject);
    await admin.getByRole('link', { name: subject, exact: true }).click();
    await admin
      .getByRole('combobox', { name: 'Assigned AI agent', exact: true })
      .selectOption({ label: 'Relay Orders' });
    await expect(customer.getByText(/Please send the complete replacement address/)).toBeVisible();
    await customer
      .getByLabel('Your reply', { exact: true })
      .fill('New address: 42 Willow Avenue, Kuala Lumpur 50480');
    await customer.getByRole('button', { name: 'Send reply', exact: true }).click();
    await expect(
      admin.getByRole('heading', { name: 'Resolution proposed.', exact: true }),
    ).toBeVisible();
    const order = (await (await customer.request.get('/api/orders')).json()).orders.find(
      (o: any) => o.id === 'RD-2048',
    );
    expect(order.address).toBe('42 Willow Avenue, Kuala Lumpur 50480');
    await admin.getByRole('button', { name: /Execution log/ }).click();
    await expect(admin.getByText('Updated delivery address', { exact: true })).toBeVisible();
    await admin.getByRole('button', { name: /Conversation/ }).click();
    await admin.getByRole('button', { name: 'Request more work', exact: true }).click();
    await admin
      .getByLabel('What should the AI revisit?')
      .fill('Verify the persisted delivery address before proposing closure.');
    await admin.getByRole('button', { name: 'Send revision', exact: true }).click();
    await expect(
      admin.getByRole('heading', { name: 'Resolution proposed.', exact: true }),
    ).toBeVisible();
    await expect(
      customer.getByText('Verify the persisted delivery address before proposing closure.', {
        exact: true,
      }),
    ).toHaveCount(0);
    await admin.screenshot({ path: 'docs/screenshots/review.png', fullPage: true });
    await admin.getByRole('button', { name: 'Approve & close', exact: true }).click();
    await expect(admin.getByText('Reviewed. Approved. Closed.', { exact: true })).toBeVisible();
    await expect(customer.getByText('Reviewed. Approved. Closed.', { exact: true })).toBeVisible();
    await expect(customer.getByRole('button', { name: 'Send reply', exact: true })).toHaveCount(0);
  } finally {
    await customerContext.close();
    await adminContext.close();
  }
});
test('admin manages specialist availability and knowledge', async ({ page }) => {
  await signIn(page, 'admin');
  await navigate(page, 'AI agents');
  await expect(
    page.getByRole('heading', { name: 'A team built to help.', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Deactivate Relay Billing', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Enable Relay Billing', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Enable Relay Billing', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Deactivate Relay Billing', exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: 'docs/screenshots/agents.png', fullPage: true });
  await navigate(page, 'Knowledge base');
  await page.getByRole('button', { name: 'New article', exact: true }).click();
  const title = `Business hours ${Date.now()}`;
  await page.getByLabel('Title', { exact: true }).fill(title);
  await page
    .getByLabel('Approved guidance', { exact: true })
    .fill(
      'Our support administrators review tickets Monday through Friday, from 9am to 6pm Malaysia time. AI conversations remain available outside those hours.',
    );
  await page.getByRole('button', { name: 'Save article', exact: true }).click();
  await page.getByRole('textbox', { name: 'Search knowledge', exact: true }).fill(title);
  await expect(page.getByRole('button', { name: new RegExp(title) })).toBeVisible();
  await navigate(page, 'Performance');
  await expect(
    page.getByRole('heading', { name: 'From conversation to closure.', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Where does the time go?', exact: true }),
  ).toBeVisible();
});
test('new theme stays readable without page overflow on desktop and mobile', async ({ page }) => {
  await signIn(page, 'admin');
  await expect(
    page.getByRole('heading', { name: 'Less to handle. More under control.', exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeInViewport();
  await page.screenshot({ path: 'docs/screenshots/command-center.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.sidebar')).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await expect(page.getByRole('button', { name: 'Open navigation', exact: true })).toBeVisible();
  await page.screenshot({ path: 'docs/screenshots/mobile.png', fullPage: true });
  await navigate(page, 'AI agents');
  await expect(
    page.getByRole('heading', { name: 'A team built to help.', exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await navigate(page, /All tickets/);
  await page.screenshot({ path: 'docs/screenshots/inbox.png', fullPage: true });
});

test('performance filters, Chart.js views, and complete CSV export work on desktop and mobile', async ({
  page,
}) => {
  await signIn(page, 'admin');
  await navigate(page, 'Performance');
  await expect(
    page.getByRole('heading', { name: 'Know what’s working.', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('img', { name: /Opened and Closed by UTC day/ })).toBeVisible();
  await page.getByLabel('Chart metric', { exact: true }).selectOption('runs');
  await expect(page.getByRole('img', { name: /Completed and Failed by UTC day/ })).toBeVisible();
  await page.getByLabel('Chart metric', { exact: true }).selectOption('tokens');
  await expect(
    page.getByRole('img', { name: /Input tokens and Output tokens by UTC day/ }),
  ).toBeVisible();
  await page.getByText('View daily data', { exact: true }).click();
  await expect(
    page.getByRole('table', { name: 'Daily ticket and AI activity in UTC' }),
  ).toBeVisible();
  const period = page.waitForResponse(
    (r) => r.url().includes('/api/reports/performance?days=7&mode=all') && r.ok(),
  );
  await page.getByRole('combobox', { name: 'Reporting period', exact: true }).selectOption('7');
  await period;
  const live = page.waitForResponse(
    (r) => r.url().includes('/api/reports/performance?days=7&mode=live') && r.ok(),
  );
  await page.getByRole('combobox', { name: 'AI activity', exact: true }).selectOption('live');
  await live;
  await expect(page.getByRole('button', { name: 'Export report', exact: true })).toBeEnabled();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export report', exact: true }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/relaydesk-performance-7d-live-/);
  const { readFile } = await import('node:fs/promises');
  const content = await readFile((await file.path())!, 'utf8');
  for (const section of ['AI runs', 'Reviews', 'Current backlog', 'Specialist', 'Daily activity'])
    expect(content).toContain(section);
  await page.getByRole('tab', { name: 'AI specialists', exact: true }).click();
  await expect(
    page.getByRole('table', { name: 'AI specialist performance and current workload' }),
  ).toBeVisible();
  await page.screenshot({ path: 'docs/screenshots/performance-specialists.png', fullPage: true });
  await page.getByRole('tab', { name: 'Operations & usage', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Backlog health.', exact: true })).toBeVisible();
  await expect(page.getByText('Verified address updates', { exact: true })).toBeVisible();
  const all = page.waitForResponse(
    (r) => r.url().includes('/api/reports/performance?days=7&mode=all') && r.ok(),
  );
  await page.getByRole('combobox', { name: 'AI activity', exact: true }).selectOption('all');
  await all;
  await page.screenshot({ path: 'docs/screenshots/performance-operations.png', fullPage: true });
  await page.getByRole('tab', { name: 'Overview', exact: true }).click();
  await page.setViewportSize({ width: 1280, height: 1250 });
  await page.screenshot({ path: 'docs/screenshots/performance.png', fullPage: true });
  await page.screenshot({ path: 'docs/screenshots/performance-preview.png', fullPage: false });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.sidebar')).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await expect(page.getByRole('img', { name: /Opened and Closed by UTC day/ })).toBeVisible();
  await page.screenshot({ path: 'docs/screenshots/performance-mobile.png', fullPage: true });
});

async function textContrast(page: Page) {
  return page.evaluate(() => {
    const rgba = (value: string) => {
      const v = value.match(/[\d.]+/g)?.map(Number) || [];
      return v.length < 3 ? [0, 0, 0, 0] : [v[0], v[1], v[2], v[3] ?? 1];
    };
    const blend = (fg: number[], bg: number[]) =>
      [0, 1, 2].map((i) => fg[i] * fg[3] + bg[i] * (1 - fg[3])).concat(1);
    const lum = (rgb: number[]) =>
      rgb
        .slice(0, 3)
        .map((n) => n / 255)
        .map((n) => (n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4))
        .reduce((s, n, i) => s + n * [0.2126, 0.7152, 0.0722][i], 0);
    return [...document.querySelectorAll<HTMLElement>('body *')].flatMap((el) => {
      if (
        ![...el.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim()) ||
        el.closest('[aria-hidden="true"],.sr-only,[disabled],script,style')
      )
        return [];
      const rect = el.getBoundingClientRect(),
        style = getComputedStyle(el);
      if (!rect.width || !rect.height || style.visibility === 'hidden' || style.display === 'none')
        return [];
      const chain: HTMLElement[] = [];
      let parent: HTMLElement | null = el;
      while (parent) {
        chain.unshift(parent);
        parent = parent.parentElement;
      }
      if (
        chain.some(
          (p) =>
            getComputedStyle(p).backgroundImage !== 'none' ||
            Number(getComputedStyle(p).opacity) < 1,
        )
      )
        return [];
      let bg = [255, 255, 255, 1];
      for (const p of chain) bg = blend(rgba(getComputedStyle(p).backgroundColor), bg);
      const fg = blend(rgba(style.color), bg),
        a = lum(fg),
        b = lum(bg),
        ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      const large =
        parseFloat(style.fontSize) >= 24 ||
        (parseFloat(style.fontSize) >= 18.66 && Number(style.fontWeight) >= 700);
      return ratio < (large ? 3 : 4.5)
        ? [
            {
              text: el.textContent?.trim().slice(0, 70),
              selector: el.className,
              color: style.color,
              background: bg.slice(0, 3),
              ratio: Math.round(ratio * 100) / 100,
            },
          ]
        : [];
    });
  });
}
test('workspace text meets AA contrast on the rendered solid surfaces', async ({ page }) => {
  await signIn(page, 'admin');
  for (const name of [
    'Command center',
    /All tickets/,
    'AI agents',
    'Knowledge base',
    'Performance',
  ]) {
    await navigate(page, name);
    if (name === 'Performance')
      await expect(
        page.getByRole('heading', { name: 'Where does the time go?', exact: true }),
      ).toBeVisible();
    expect(await textContrast(page), String(name)).toEqual([]);
  }
  for (const name of ['AI specialists', 'Operations & usage']) {
    await page.getByRole('tab', { name, exact: true }).click();
    expect(await textContrast(page), name).toEqual([]);
  }
});

test('rerun generates a private editable draft and sends only after explicit confirmation', async ({
  browser,
}) => {
  const customerContext = await browser.newContext(),
    adminContext = await browser.newContext();
  const customer = await customerContext.newPage(),
    admin = await adminContext.newPage();
  try {
    await signIn(customer, 'customer');
    const created = await customer.request.post('/api/tickets', {
      data: {
        subject: `Password reset approval ${Date.now()}`,
        description: 'I forgot my password. Please help me reset my password.',
      },
    });
    const { ticket } = await created.json();
    await signIn(admin, 'admin');
    await admin.goto(`/tickets/${ticket.id}`);
    await admin
      .getByRole('combobox', { name: 'Assigned AI agent', exact: true })
      .selectOption({ label: 'Relay Support' });
    await expect(
      admin.getByRole('heading', { name: 'Resolution proposed.', exact: true }),
    ).toBeVisible();
    const before = (await (await customer.request.get(`/api/tickets/${ticket.id}`)).json()).messages
      .length;
    await admin.getByRole('button', { name: 'Run specialist again', exact: true }).click();
    await expect(
      admin.getByRole('heading', { name: 'Review before sending.', exact: true }),
    ).toBeVisible();
    const hidden = await (await customer.request.get(`/api/tickets/${ticket.id}`)).json();
    expect(hidden.draft).toBeNull();
    expect(hidden.messages).toHaveLength(before);
    const reply =
      'I reviewed your password reset request. Open account settings and select Reset password, then check your email for the secure link.';
    await admin.getByLabel('Response to customer', { exact: true }).fill(reply);
    await admin.screenshot({ path: 'docs/screenshots/response-approval.png', fullPage: true });
    await admin.getByRole('button', { name: 'Confirm & send response', exact: true }).click();
    await expect(
      admin.getByRole('heading', { name: 'Review before sending.', exact: true }),
    ).toHaveCount(0);
    await expect
      .poll(
        async () =>
          (await (await customer.request.get(`/api/tickets/${ticket.id}`)).json()).messages.at(-1)
            .body,
      )
      .toBe(reply);
    await expect(admin.getByRole('button', { name: 'Approve & close', exact: true })).toBeVisible();
  } finally {
    await customerContext.close();
    await adminContext.close();
  }
});

test('appearance persists and follows system settings with readable dark reports', async ({
  page,
}) => {
  await signIn(page, 'admin');
  await page.getByRole('button', { name: 'Change appearance', exact: true }).click();
  await page.getByRole('radio', { name: /^Dark/ }).check();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await textContrast(page)).toEqual([]);
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  for (const name of [
    'Command center',
    /All tickets/,
    'AI agents',
    'Knowledge base',
    'Actions & rules',
    'Performance',
  ]) {
    await navigate(page, name);
    if (name === 'Performance')
      await expect(
        page.getByRole('heading', { name: 'Where does the time go?', exact: true }),
      ).toBeVisible();
    expect(await textContrast(page), String(name)).toEqual([]);
  }
  await navigate(page, /All tickets/);
  await page.locator('.ticket-subject-link').first().click();
  await expect(page.getByRole('button', { name: 'Copy ticket link', exact: true })).toBeVisible();
  expect(await textContrast(page), 'Dark ticket details').toEqual([]);
  await page.screenshot({ path: 'docs/screenshots/ticket-dark.png', fullPage: true });
  await navigate(page, 'Performance');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByRole('img', { name: /Opened and Closed by UTC day/ })).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 1250 });
  await page.screenshot({ path: 'docs/screenshots/performance-dark.png', fullPage: true });
  await page.screenshot({ path: 'docs/screenshots/dark-preview.png', fullPage: false });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.sidebar')).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: 'docs/screenshots/dark-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Change appearance', exact: true }).click();
  await page.getByRole('radio', { name: /^System/ }).check();
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByRole('radio', { name: /^Light/ }).check();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
});

test('notifications dismiss outside and tickets support shared URLs and browser history', async ({
  page,
  browser,
}) => {
  await signIn(page, 'admin');
  const notifications = page.getByRole('button', { name: 'Notifications', exact: true }),
    panel = page.getByRole('region', { name: 'Notifications', exact: true });
  await notifications.click();
  await expect(panel).toBeVisible();
  await panel.getByRole('heading', { name: 'Notifications', exact: true }).click();
  await expect(panel).toBeVisible();
  await page
    .getByRole('heading', { name: 'Less to handle. More under control.', exact: true })
    .click();
  await expect(panel).toHaveCount(0);
  await notifications.click();
  await expect(panel).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
  await expect(notifications).toBeFocused();
  await navigate(page, /All tickets/);
  await expect(page).toHaveURL(/\/tickets$/);
  const link = page.locator('.ticket-subject-link').first(),
    href = await link.getAttribute('href'),
    subject = await link.innerText();
  await link.click();
  await expect(page).toHaveURL(href!);
  await expect(page.getByRole('heading', { name: subject, exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Copy ticket link', exact: true })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/\/tickets$/);
  await expect(page.locator('.ticket-subject-link').first()).toBeVisible();
  await page.goForward();
  await expect(page.getByRole('heading', { name: subject, exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: subject, exact: true })).toBeVisible();
  const newContext = await browser.newContext(),
    shared = await newContext.newPage();
  try {
    await shared.goto(href!);
    await expect(shared.getByRole('button', { name: /Enter admin workspace/ })).toBeVisible();
    await shared.getByRole('button', { name: /Enter admin workspace/ }).click();
    await expect(shared).toHaveURL(href!);
    await expect(shared.getByRole('heading', { name: subject, exact: true })).toBeVisible();
    await shared.goto('/tickets/00000000-0000-4000-8000-000000000001');
    await expect(
      shared.getByRole('heading', { name: 'Ticket unavailable', exact: true }),
    ).toBeVisible();
  } finally {
    await newContext.close();
  }
});

test('admin adds a Support user who approves with notes while admin controls deletion and recovery', async ({
  browser,
}) => {
  const adminContext = await browser.newContext(),
    supportContext = await browser.newContext();
  const admin = await adminContext.newPage(),
    support = await supportContext.newPage();
  try {
    await signIn(admin, 'admin');
    await navigate(admin, 'People & access');
    await admin.getByRole('button', { name: 'Add account', exact: true }).click();
    const email = `reviewer-${Date.now()}@relaydesk.demo`,
      password = 'Support!Review2026';
    await admin.getByLabel('Full name', { exact: true }).fill('Taylor Support');
    await admin.getByLabel('Email address', { exact: true }).fill(email);
    await admin.getByLabel('Initial password', { exact: true }).fill(password);
    await admin.getByRole('button', { name: 'Create account', exact: true }).click();
    await expect(admin.getByRole('cell', { name: email, exact: true })).toBeVisible();
    await support.goto('/');
    await support.getByLabel('Email address', { exact: true }).fill(email);
    await support.getByLabel('Password', { exact: true }).fill(password);
    await support.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(support.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible();
    await expect(
      support.locator('nav').getByRole('button', { name: 'People & access', exact: true }),
    ).toHaveCount(0);
    const users = (await (await support.request.get('/api/users')).json()).users,
      agents = (await (await support.request.get('/api/agents')).json()).agents;
    const created = await support.request.post('/api/tickets', {
      data: {
        subject: `Support review ${Date.now()}`,
        description: 'Please explain how to reset my forgotten password.',
        customerId: users.find((u: any) => u.email === 'customer@relaydesk.demo').id,
        agentId: agents.find((a: any) => a.slug === 'support').id,
      },
    });
    expect(created.ok()).toBe(true);
    const { ticket } = await created.json();
    await support.goto(`/tickets/${ticket.id}`);
    await expect(
      support.getByRole('heading', { name: 'Resolution proposed.', exact: true }),
    ).toBeVisible();
    await expect(support.getByRole('button', { name: 'Delete ticket', exact: true })).toHaveCount(
      0,
    );
    await support.getByRole('button', { name: 'Run specialist again', exact: true }).click();
    await expect(
      support.getByRole('heading', { name: 'Review before sending.', exact: true }),
    ).toBeVisible();
    await expect(
      support.getByRole('button', { name: 'Confirm & send response', exact: true }),
    ).toBeDisabled();
    await support
      .getByLabel('Response approval note', { exact: true })
      .fill('Verified that the response follows the approved password reset guidance.');
    await support.getByRole('button', { name: 'Confirm & send response', exact: true }).click();
    await expect(
      support.getByRole('button', { name: 'Approve & close', exact: true }),
    ).toBeDisabled();
    await support
      .getByLabel('Resolution approval note', { exact: true })
      .fill('Confirmed the response is grounded in the reset policy and the next steps are clear.');
    await support.screenshot({ path: 'docs/screenshots/support-approval.png', fullPage: true });
    await support.getByRole('button', { name: 'Approve & close', exact: true }).click();
    await expect(support.getByText('Reviewed. Approved. Closed.', { exact: true })).toBeVisible();
    await navigate(support, 'AI agents');
    await expect(support.getByRole('button', { name: 'Configure', exact: true })).toHaveCount(0);
    await expect(
      support.getByRole('button', { name: 'Deactivate Relay Billing', exact: true }),
    ).toHaveCount(0);
    await admin.goto(`/tickets/${ticket.id}`);
    await admin.getByRole('button', { name: 'Delete ticket', exact: true }).click();
    const dialog = admin.getByRole('dialog', { name: 'Delete ticket', exact: true });
    await dialog
      .getByLabel('Reason for deletion', { exact: true })
      .fill('Disposable browser test ticket; verify recovery.');
    await dialog.getByRole('button', { name: 'Delete ticket', exact: true }).click();
    await expect(admin).toHaveURL(/\/tickets$/);
    await navigate(admin, 'People & access');
    await admin.getByRole('tab', { name: 'Deleted tickets', exact: true }).click();
    const row = admin.getByRole('row').filter({ hasText: ticket.subject });
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: 'Restore ticket', exact: true }).click();
    await expect(row).toHaveCount(0);
    await admin.goto(`/tickets/${ticket.id}`);
    await expect(admin.getByRole('heading', { name: ticket.subject, exact: true })).toBeVisible();
  } finally {
    await adminContext.close();
    await supportContext.close();
  }
});
