import { hash } from 'bcryptjs';
import { pathToFileURL } from 'node:url';
import { createDatabase, type Database } from './db.js';
import { migrate } from './migrate.js';
import { enqueueTx, processNextRun } from './ai.js';
export const demoPassword = 'RelayDesk!2026';
export async function seed(db: Database) {
  const password = await hash(demoPassword, 12);
  const people = [
    ['Maya Chen', 'admin@relaydesk.demo', 'admin'],
    ['Jordan Lee', 'support@relaydesk.demo', 'support'],
    ['Alex Morgan', 'alex@relaydesk.demo', 'admin'],
    ['Jamie Parker', 'customer@relaydesk.demo', 'customer'],
    ['Olivia Brooks', 'olivia@relaydesk.demo', 'customer'],
    ['Noah Williams', 'noah@relaydesk.demo', 'customer'],
    ['Amara Okafor', 'amara@relaydesk.demo', 'customer'],
  ];
  await db.transaction(async (tx) => {
    for (const [name, email, role] of people)
      await tx.query(
        'INSERT INTO users(name,email,password_hash,role) VALUES($1,$2,$3,$4) ON CONFLICT(email) DO NOTHING',
        [name, email, password, role],
      );
    const users = (await tx.query('SELECT id,email FROM users')).rows;
    const user = (email: string) => users.find((u) => u.email === email).id;
    const agents = (await tx.query('SELECT id,slug FROM ai_agents')).rows;
    const agent = (slug: string) => agents.find((a) => a.slug === slug).id;
    const articles = [
      [
        'support',
        'Reset your password',
        'Open the sign-in page and choose “Forgot password”. Enter your account email and use the reset link in the message we send. Check your spam folder if it does not arrive. The link expires after 30 minutes. If you no longer have access to the account email, an administrator must verify your identity.',
      ],
      [
        'support',
        'Connect your online store',
        'Open Settings, choose Integrations, and select your store provider. Follow the provider’s sign-in flow and approve the connection. Return to RelayDesk to confirm that the store appears as connected. Only a business administrator can manage integrations.',
      ],
      [
        'support',
        'Invite a team administrator',
        'A business administrator can invite another administrator from workspace settings. Customers cannot grant themselves administrative access. Ask an existing administrator to review and approve any access request.',
      ],
      [
        'orders',
        'Delivery address changes',
        'A delivery address may be updated only while the order is preparing. Verify that the order belongs to the customer and ask for the complete replacement address. Once an order is shipped or delivered, an address change requires an administrator decision and must not be attempted automatically.',
      ],
      [
        'orders',
        'Track a delivery',
        'Use the customer’s order reference to look up its current status. If a tracking reference is available, share it with the customer. Do not promise a delivery date that is not present in the verified order record.',
      ],
      [
        'billing',
        'Download your monthly invoice',
        'Open Account settings, choose Billing, then Invoice history. Select the relevant month and choose Download PDF. The billing administrator can access all invoices for the business. If an invoice is missing, provide the month and invoice reference for an administrator to review.',
      ],
      [
        'billing',
        'Duplicate payments and refund requests',
        'Payment disputes, duplicate charges, and refund approvals require an administrator decision. Collect the order or invoice reference, the date, and the amount. Never request a full card number or security code. The AI must not issue refunds or claim that a payment has been reversed.',
      ],
    ];
    for (const [slug, title, content] of articles)
      if (
        !(await tx.query('SELECT id FROM knowledge_articles WHERE title=$1', [title])).rows.length
      )
        await tx.query('INSERT INTO knowledge_articles(agent_id,title,content) VALUES($1,$2,$3)', [
          agent(slug),
          title,
          content,
        ]);
    await tx.query(
      "INSERT INTO store_orders(id,customer_id,status,address,tracking,total_cents) VALUES('RD-2048',$1,'preparing','12 Oak Lane, Kuala Lumpur 50450',NULL,12900),('RD-2049',$1,'shipped','12 Oak Lane, Kuala Lumpur 50450','MY-482901',8900),('RD-2050',$2,'delivered','8 Maple Street, Petaling Jaya 46000','MY-482905',15900) ON CONFLICT(id) DO NOTHING",
      [user('customer@relaydesk.demo'), user('olivia@relaydesk.demo')],
    );
    const examples = [
      [
        'Please update the delivery address for RD-2048',
        'The order is going to my old office. Please change the delivery address. New address: 24 Cedar Avenue, Kuala Lumpur 50480',
        'orders',
        'high',
        'customer@relaydesk.demo',
      ],
      [
        'Charged twice for the same subscription',
        'There are two charges of RM129 for the same subscription on my statement. Please investigate this duplicate payment.',
        'billing',
        'urgent',
        'olivia@relaydesk.demo',
      ],
      [
        'How do I download a monthly invoice?',
        'Our accountant needs a PDF copy of our monthly invoice. Where can I download an invoice for last month?',
        'billing',
        'normal',
        'noah@relaydesk.demo',
      ],
      [
        'Change the address for order RD-2049',
        'Please update the address for order RD-2049. New address: 30 Lake Road, Kuala Lumpur 50480',
        'orders',
        'high',
        'customer@relaydesk.demo',
      ],
      [
        'How do I reset my password?',
        'I forgot my password and need to reset it. Can you explain the account recovery steps?',
        'support',
        'normal',
        'amara@relaydesk.demo',
      ],
      [
        'Help connecting our online store',
        'We need to connect our online store integration. Can you explain the setup steps for a business administrator?',
        'support',
        'low',
        'customer@relaydesk.demo',
      ],
      [
        'Please change my delivery address',
        'I recently moved office and want to change my delivery address. Can you help me update my order?',
        'orders',
        'normal',
        'customer@relaydesk.demo',
      ],
    ];
    for (const [subject, description, slug, priority, email] of examples) {
      if ((await tx.query('SELECT id FROM tickets WHERE subject=$1', [subject])).rows.length)
        continue;
      const hours = { low: 48, normal: 24, high: 8, urgent: 2 }[priority]!;
      const { rows } = await tx.query(
        "INSERT INTO tickets(subject,description,customer_id,priority,ai_agent_id,response_due_at,created_at) VALUES($1,$2,$3,$4,$5,now()+$6*interval '1 hour',now()-interval '25 minutes') RETURNING id",
        [subject, description, user(email), priority, agent(slug), hours],
      );
      await tx.query(
        "INSERT INTO activities(ticket_id,actor_id,kind,detail) VALUES($1,$2,'created','created this demo ticket')",
        [rows[0].id, user(email)],
      );
      await enqueueTx(tx, rows[0].id, 'demo');
    }
    // Existing records are preserved. Legacy work is explicitly returned for administrator routing.
    await tx.query(
      "UPDATE tickets SET status='open' WHERE status='in_progress' AND NOT EXISTS(SELECT 1 FROM ai_runs WHERE ticket_id=tickets.id)",
    );
  });
  // Only finish labelled demo jobs during seeding; never spend provider tokens here.
  const pending = Number(
    (await db.query("SELECT count(*) n FROM ai_runs WHERE status='queued' AND mode='demo'")).rows[0]
      .n,
  );
  for (let i = 0; i < pending; i++) {
    const next = (
      await db.query("SELECT mode FROM ai_runs WHERE status='queued' ORDER BY created_at LIMIT 1")
    ).rows[0];
    if (next?.mode !== 'demo') break;
    await processNextRun(db);
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const db = createDatabase();
  try {
    await migrate(db);
    await seed(db);
    console.log('Local sample workspace ready. Password: ' + demoPassword);
  } finally {
    await db.close();
  }
}
