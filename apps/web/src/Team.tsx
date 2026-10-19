import { useEffect, useState, type FormEvent } from 'react';
import { Plus, RotateCcw, ShieldCheck, UserRound, Users } from 'lucide-react';
import type { User } from '@relaydesk/contracts';
import { api, post } from './api';
import { Modal, Spinner, fullDate } from './components';
interface DeletedTicket {
  id: string;
  number: number;
  subject: string;
  deletedAt: string;
  deletedBy: string;
  note: string;
}
export function TeamPage({ users, onChanged }: { users: User[]; onChanged: () => void }) {
  const [adding, setAdding] = useState(false),
    [name, setName] = useState(''),
    [email, setEmail] = useState(''),
    [password, setPassword] = useState(''),
    [role, setRole] = useState<User['role']>('support'),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [deleted, setDeleted] = useState<DeletedTicket[]>([]),
    [tab, setTab] = useState('people');
  async function loadDeleted() {
    try {
      setDeleted((await api<{ tickets: DeletedTicket[] }>('/deleted-tickets')).tickets);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    if (tab === 'deleted') void loadDeleted();
  }, [tab]);
  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await post('/users', { name, email, password, role });
      setAdding(false);
      setName('');
      setEmail('');
      setPassword('');
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">WORKSPACE ADMINISTRATION</span>
          <h1>The right access. Clear accountability.</h1>
          <p>Manage people, protect your workspace, and recover deleted tickets.</p>
        </div>
        <button
          className="button primary"
          onClick={() => {
            setError('');
            setAdding(true);
          }}
        >
          <Plus size={17} />
          Add account
        </button>
      </div>
      <div className="report-tabs" role="tablist" aria-label="Administration">
        <button role="tab" aria-selected={tab === 'people'} onClick={() => setTab('people')}>
          People & access
        </button>
        <button role="tab" aria-selected={tab === 'deleted'} onClick={() => setTab('deleted')}>
          Deleted tickets
        </button>
      </div>
      {error && !adding && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}
      {tab === 'people' ? (
        <>
          <div className="role-cards">
            <article className="panel">
              <ShieldCheck size={23} />
              <h2>Admin</h2>
              <p>
                All ticket operations, account creation, agent configuration, knowledge management,
                and ticket deletion or recovery.
              </p>
            </article>
            <article className="panel">
              <Users size={23} />
              <h2>Support</h2>
              <p>
                Work across tickets, assign specialists, review responses, and approve resolutions.
                Every approval requires a private note.
              </p>
            </article>
            <article className="panel">
              <UserRound size={23} />
              <h2>Customer</h2>
              <p>
                Create and follow their own tickets. Internal notes, AI execution records, drafts,
                and approval notes remain private.
              </p>
            </article>
          </div>
          <section className="panel">
            <div className="section-heading">
              <h2>Workspace accounts</h2>
              <span className="outline-pill">{users.length} accounts</span>
            </div>
            <div className="report-table-scroll">
              <table className="report-table">
                <caption className="sr-only">Workspace accounts and access roles</caption>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Email</th>
                    <th>Role</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id}>
                      <th scope="row">{u.name}</th>
                      <td>{u.email}</td>
                      <td>
                        <span className={`role-badge role-${u.role}`}>
                          {u.role === 'admin'
                            ? 'Admin'
                            : u.role === 'support'
                              ? 'Support'
                              : 'Customer'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : (
        <section className="panel">
          <div className="section-heading">
            <div>
              <span className="section-kicker">RECOVERABLE · ADMIN ONLY</span>
              <h2>Deleted tickets</h2>
            </div>
          </div>
          <p className="report-panel-note">
            Deleting removes tickets from active work and cancels AI work. Restore an open ticket
            here to review it again; restoration does not rerun an agent.
          </p>
          {deleted.length ? (
            <div className="report-table-scroll">
              <table className="report-table">
                <caption className="sr-only">Recoverable deleted tickets</caption>
                <thead>
                  <tr>
                    <th>Ticket</th>
                    <th>Deleted by</th>
                    <th>Deleted at</th>
                    <th>Reason</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {deleted.map((t) => (
                    <tr key={t.id}>
                      <th scope="row">
                        <strong>
                          #{String(t.number).padStart(4, '0')} · {t.subject}
                        </strong>
                      </th>
                      <td>{t.deletedBy}</td>
                      <td>{fullDate(t.deletedAt)}</td>
                      <td>{t.note}</td>
                      <td>
                        <button
                          className="button secondary"
                          disabled={busy}
                          onClick={async () => {
                            setBusy(true);
                            setError('');
                            try {
                              await post(`/deleted-tickets/${t.id}/restore`);
                              await loadDeleted();
                              onChanged();
                            } catch (e) {
                              setError((e as Error).message);
                            } finally {
                              setBusy(false);
                            }
                          }}
                        >
                          <RotateCcw size={15} />
                          Restore ticket
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="report-panel-note">No deleted tickets.</p>
          )}
        </section>
      )}
      {adding && (
        <Modal title="Add workspace account" onClose={() => !busy && setAdding(false)}>
          <form className="stack-form" onSubmit={create}>
            {error && (
              <div className="error-banner" role="alert">
                {error}
              </div>
            )}
            <label>
              Full name
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                minLength={2}
                maxLength={80}
                autoComplete="name"
              />
            </label>
            <label>
              Email address
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
              />
            </label>
            <label>
              Role
              <select value={role} onChange={(e) => setRole(e.target.value as User['role'])}>
                <option value="support">Support</option>
                <option value="admin">Admin</option>
                <option value="customer">Customer</option>
              </select>
            </label>
            <label>
              Initial password
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={12}
                maxLength={128}
                autoComplete="new-password"
              />
            </label>
            <p className="form-note">
              Use at least 12 characters. Share sign-in details with the intended person through
              your own secure channel.
            </p>
            <button className="button primary" disabled={busy}>
              {busy ? <Spinner /> : <Plus size={16} />}Create account
            </button>
          </form>
        </Modal>
      )}
    </>
  );
}
