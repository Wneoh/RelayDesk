import { useEffect, useRef, type ReactNode } from 'react';
import { Bot, Inbox, LoaderCircle, MessageSquare, X } from 'lucide-react';
import type { Status, Priority } from '@relaydesk/contracts';
export const statusLabels: Record<Status, string> = {
  open: 'New',
  in_progress: 'AI working',
  waiting: 'Waiting for customer',
  review: 'Ready for review',
  blocked: 'Needs decision',
  resolved: 'Closed',
};
export const priorityLabels: Record<Priority, string> = {
  low: 'Low',
  normal: 'Normal',
  high: 'High',
  urgent: 'Urgent',
};
export const fullDate = (value: string) =>
  new Date(value).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
export const duration = (minutes: number | null) =>
  minutes === null
    ? '—'
    : minutes < 1
      ? minutes * 60 < 1
        ? '<1s'
        : `${Math.round(minutes * 60)}s`
      : minutes < 60
        ? `${Math.round(minutes)}m`
        : `${(minutes / 60).toFixed(1)}h`;
export function relative(value: string) {
  const m = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60000));
  return m < 1
    ? 'Just now'
    : m < 60
      ? `${m}m ago`
      : m < 1440
        ? `${Math.floor(m / 60)}h ago`
        : `${Math.floor(m / 1440)}d ago`;
}
export function Avatar({ name, small = false }: { name: string; small?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`avatar ${small ? 'small' : ''} tone-${name.charCodeAt(0) % 4}`}
    >
      {name
        .split(' ')
        .map((n) => n[0])
        .slice(0, 2)
        .join('')}
    </span>
  );
}
export function AgentIcon({
  slug = 'support',
  small = false,
}: {
  slug?: string | null;
  small?: boolean;
}) {
  return (
    <span className={`agent-icon ${slug || 'support'} ${small ? 'small' : ''}`}>
      <Bot size={small ? 16 : 23} />
    </span>
  );
}
export function StatusBadge({ status }: { status: Status }) {
  return (
    <span className={`badge status-${status}`}>
      <i />
      {statusLabels[status]}
    </span>
  );
}
export function PriorityBadge({ priority }: { priority: Priority }) {
  return (
    <span className={`priority priority-${priority}`}>
      <i />
      {priorityLabels[priority]}
    </span>
  );
}
export function Spinner() {
  return <LoaderCircle className="spin" size={18} />;
}
export function Empty({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="empty">
      <span>
        <Inbox size={28} />
      </span>
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}
export function Brand() {
  return (
    <div className="brand">
      <span className="brand-mark">
        <MessageSquare size={22} />
        <i />
      </span>
      relaydesk<span className="brand-ai">AI</span>
    </div>
  );
}
export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null),
    close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const old = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close.current();
      if (e.key === 'Tab') {
        const els = panel.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled),input,textarea,select',
        );
        if (!els?.length) return;
        const first = els[0],
          last = els[els.length - 1];
        if (
          e.shiftKey &&
          (document.activeElement === first || document.activeElement === panel.current)
        ) {
          e.preventDefault();
          last.focus();
        } else if (
          !e.shiftKey &&
          (document.activeElement === last || document.activeElement === panel.current)
        ) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', key);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', key);
      document.body.style.overflow = overflow;
      old?.focus();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panel}
        tabIndex={-1}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="modal-heading">
          <h2>{title}</h2>
          <button className="icon-button" onClick={onClose} aria-label="Close dialog">
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
