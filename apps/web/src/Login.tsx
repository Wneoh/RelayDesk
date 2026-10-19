import { Appearance } from './Appearance';
import { useState, type FormEvent } from 'react';
import {
  ArrowRight,
  ArrowUpRight,
  Bot,
  Check,
  CheckCheck,
  FileText,
  LockKeyhole,
  MessageSquare,
  ShieldCheck,
  Sparkles,
  Zap,
} from 'lucide-react';
import type { User, AiMode } from '@relaydesk/contracts';
import { post } from './api';
import { AgentIcon, Brand, Spinner } from './components';
export function Login({
  demo,
  mode,
  onLogin,
}: {
  demo: boolean;
  mode: AiMode;
  onLogin: (user: User) => void;
}) {
  const [register, setRegister] = useState(false),
    [email, setEmail] = useState(''),
    [password, setPassword] = useState(''),
    [name, setName] = useState(''),
    [busy, setBusy] = useState(''),
    [error, setError] = useState('');
  async function submit(e?: FormEvent, role?: 'admin' | 'support' | 'customer') {
    e?.preventDefault();
    setBusy(role || 'form');
    setError('');
    try {
      const result = await post<{ user: User }>(
        register ? '/auth/register' : '/auth/login',
        role
          ? { email: `${role}@relaydesk.demo`, password: 'RelayDesk!2026' }
          : { name, email, password },
      );
      onLogin(result.user);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  }
  return (
    <div className="auth-shell">
      <section className="auth-story">
        <Brand />
        <div className="auth-story-main">
          <span className="eyebrow light">
            <i />
            THE NEXT CHAPTER OF CUSTOMER SUPPORT
          </span>
          <h1>
            Your AI team.
            <br />
            Your final say.
          </h1>
          <p>
            Specialist agents do the legwork.
            <br />
            You bring the judgment that matters.
          </p>
          <div className="auth-workflow">
            <div className="workflow-request">
              <span>
                <MessageSquare size={17} />
                Customer request
              </span>
              <p>“Can you update my delivery address?”</p>
            </div>
            <div className="workflow-line" />
            <div className="workflow-agent">
              <AgentIcon slug="orders" />
              <div>
                <strong>Relay Orders</strong>
                <span>Investigate. Act. Verify.</span>
              </div>
              <span className="live-dot" />
            </div>
            <div className="workflow-checks">
              <span>
                <Check size={14} />
                Order ownership verified
              </span>
              <span>
                <Check size={14} />
                Address updated and checked
              </span>
            </div>
            <div className="workflow-line" />
            <div className="workflow-review">
              <ShieldCheck size={20} />
              <span>Ready for your review</span>
              <CheckCheck size={18} />
            </div>
          </div>
        </div>
        <div className="auth-story-footer">
          <span>
            <ShieldCheck size={16} />
            AI execution. Human accountability.
          </span>
          <span>01 / A BETTER WAY TO HELP</span>
        </div>
      </section>
      <section className="auth-form-side">
        <div className="auth-top">
          <Appearance />
          PURPOSE-BUILT FOR SMALL TEAMS <Sparkles size={14} />
        </div>
        <div className="auth-form">
          <span className="eyebrow">WELCOME TO YOUR WORKSPACE</span>
          <h2>{register ? 'Let’s get you supported.' : 'Less busywork.\nMore possibility.'}</h2>
          <p>
            {register
              ? 'Create an account to start a conversation.'
              : 'Sign in and let your support team get to work.'}
          </p>
          {error && (
            <div className="error-banner" role="alert">
              {error}
            </div>
          )}
          {demo && (
            <>
              <div className="demo-heading">
                <span className="pill">INTERACTIVE PREVIEW</span>
                <span>
                  {mode === 'demo'
                    ? 'Scripted demo · no model calls'
                    : mode === 'live'
                      ? 'Live AI connected'
                      : 'AI not configured'}
                </span>
              </div>
              <button
                className="demo-choice featured"
                onClick={() => void submit(undefined, 'admin')}
                disabled={!!busy}
              >
                <span className="choice-icon">
                  <ShieldCheck size={22} />
                </span>
                <span>
                  <strong>Enter admin workspace</strong>
                  <small>Manage your AI team and review resolutions</small>
                </span>
                {busy === 'admin' ? <Spinner /> : <ArrowRight size={19} />}
              </button>
              <button
                className="demo-choice"
                onClick={() => void submit(undefined, 'customer')}
                disabled={!!busy}
              >
                <span className="choice-icon customer">
                  <MessageSquare size={21} />
                </span>
                <span>
                  <strong>Try the customer experience</strong>
                  <small>Submit a ticket and follow the conversation</small>
                </span>
                {busy === 'customer' ? <Spinner /> : <ArrowUpRight size={18} />}
              </button>
              <button
                className="demo-choice"
                onClick={() => void submit(undefined, 'support')}
                disabled={!!busy}
              >
                <span className="choice-icon">
                  <CheckCheck size={22} />
                </span>
                <span>
                  <strong>Enter support workspace</strong>
                  <small>Review AI work and approve with a note</small>
                </span>
                {busy === 'support' ? <Spinner /> : <ArrowRight size={19} />}
              </button>
              <div className="divider">
                <span>or sign in with email</span>
              </div>
            </>
          )}
          <form onSubmit={submit}>
            {register && (
              <label>
                Your name
                <input
                  value={name}
                  autoComplete="name"
                  onChange={(e) => setName(e.target.value)}
                  minLength={2}
                  maxLength={80}
                  required
                />
              </label>
            )}
            <label>
              Email address
              <input
                type="email"
                autoComplete="email"
                placeholder="you@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </label>
            <label>
              Password
              <input
                type="password"
                autoComplete={register ? 'new-password' : 'current-password'}
                placeholder={register ? 'At least 10 characters' : 'Your password'}
                minLength={register ? 10 : 1}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </label>
            <button className="button primary full" disabled={!!busy}>
              {busy === 'form' ? <Spinner /> : register ? 'Create account' : 'Sign in'}
              <ArrowRight size={16} />
            </button>
          </form>
          {!demo && (
            <p className="auth-switch">
              {register ? 'Already have an account?' : 'Need help from the team?'}{' '}
              <button
                className="text-button"
                onClick={() => {
                  setRegister(!register);
                  setError('');
                }}
              >
                {register ? 'Sign in' : 'Create an account'}
              </button>
            </p>
          )}
          <div className="auth-secure">
            <LockKeyhole size={13} />
            Secure access. Private conversations.
          </div>
        </div>
        <div className="auth-bottom">
          <span>Thoughtfully automated. Always accountable.</span>
          <span>RELAYDESK / 2026</span>
        </div>
      </section>
    </div>
  );
}
