import { z } from 'zod';
export const roles = ['customer', 'support', 'admin'] as const;
export const priorities = ['low', 'normal', 'high', 'urgent'] as const;
export const statuses = [
  'open',
  'in_progress',
  'waiting',
  'review',
  'blocked',
  'resolved',
] as const;
export type Role = (typeof roles)[number];
export type Priority = (typeof priorities)[number];
export type Status = (typeof statuses)[number];
export type AiMode = 'demo' | 'live' | 'unavailable';
export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
}
export interface Agent {
  id: string;
  slug: string;
  name: string;
  specialty: string;
  description: string;
  instructions: string;
  enabled: boolean;
  color: string;
  open: number;
  review: number;
  closed: number;
  articles: number;
}
export interface Article {
  id: string;
  agentId: string;
  title: string;
  content: string;
  enabled: boolean;
  updatedAt: string;
  agentName: string;
}
export interface Ticket {
  id: string;
  number: number;
  subject: string;
  description: string;
  priority: Priority;
  status: Status;
  customerId: string;
  customerName: string;
  customerEmail: string;
  assigneeId: string | null;
  assigneeName: string | null;
  agentSlug: string | null;
  createdAt: string;
  updatedAt: string;
  firstResponseAt: string | null;
  resolvedAt: string | null;
  responseDueAt: string;
  overdue: boolean;
  revision: number;
  reviewedBy: string | null;
  closureReason: string | null;
}
export interface Message {
  id: string;
  ticketId: string;
  authorId: string;
  authorName: string;
  authorRole: Role | 'ai';
  body: string;
  internal: boolean;
  createdAt: string;
  clientMessageId: string;
}
export interface Activity {
  id: string;
  actorName: string;
  kind: string;
  detail: string;
  createdAt: string;
}
export interface RunStep {
  name: string;
  detail: string;
  status: 'complete' | 'blocked';
}
export interface AiRun {
  requiresApproval: boolean;
  id: string;
  agentName: string;
  status: string;
  mode: AiMode;
  revision: number;
  steps: RunStep[];
  error: string | null;
  inputTokens: number;
  outputTokens: number;
  createdAt: string;
  completedAt: string | null;
}
export interface Review {
  id: string;
  revision: number;
  state: string;
  summary: string;
  evidence: string[];
  sources: { id: string; title: string }[];
  createdAt: string;
  reviewerName: string | null;
  feedback: string | null;
}
export interface TicketDetail {
  draft: ResponseDraft | null;
  ticket: Ticket;
  messages: Message[];
  activities: Activity[];
  runs: AiRun[];
  review: Review | null;
}
export interface Report {
  open: number;
  unassigned: number;
  overdue: number;
  resolved: number;
  review: number;
  blocked: number;
  working: number;
  waiting: number;
  avgFirstResponseMinutes: number | null;
  avgResolutionMinutes: number | null;
  avgProposalMinutes: number | null;
  reviewed: number;
  approved: number;
  inputTokens: number;
  outputTokens: number;
  workload: { id: string; name: string; open: number; resolved: number; review: number }[];
  trend: { day: string; created: number; resolved: number }[];
}
export const loginSchema = z.object({
  email: z.email().max(254),
  password: z.string().min(1).max(128),
});
export const registerSchema = loginSchema.extend({
  name: z.string().trim().min(2).max(80),
  password: z.string().min(10).max(128),
});
export const createTicketSchema = z.object({
  subject: z.string().trim().min(5).max(160),
  description: z.string().trim().min(10).max(10000),
  priority: z.enum(priorities).default('normal'),
  customerId: z.uuid().optional(),
  agentId: z.uuid().optional(),
});
export const messageSchema = z.object({
  body: z.string().trim().min(1).max(5000),
  internal: z.boolean().default(false),
  clientMessageId: z.uuid(),
});
export const updateTicketSchema = z
  .object({
    priority: z.enum(priorities).optional(),
    agentId: z.uuid().nullable().optional(),
    expectedRevision: z.number().int().nonnegative(),
  })
  .refine((v) => v.priority !== undefined || v.agentId !== undefined, 'Choose a field to update');
export const reviewSchema = z.object({
  reviewId: z.uuid(),
  expectedRevision: z.number().int().nonnegative(),
  decision: z.enum(['approve', 'revise']),
  feedback: z.string().trim().max(2000).default(''),
});
export const agentSchema = z.object({
  enabled: z.boolean().optional(),
  instructions: z.string().trim().min(20).max(4000).optional(),
});
export const articleSchema = z.object({
  agentId: z.uuid(),
  title: z.string().trim().min(3).max(160),
  content: z.string().trim().min(20).max(12000),
  enabled: z.boolean().default(true),
});
export const roleSchema = z.object({ role: z.enum(roles) });
export const uuidSchema = z.uuid();
export interface PerformanceReport {
  window: { days: number; mode: 'all' | AiMode; from: string; to: string; generatedAt: string };
  tickets: {
    opened: number;
    closed: number;
    responses: number;
    onTime: number;
    late: number;
    firstResponse: Timing;
    closure: Timing;
  };
  runs: {
    total: number;
    completed: number;
    failed: number;
    cancelled: number;
    queued: number;
    running: number;
    review: number;
    waiting: number;
    blocked: number;
    unknown: number;
    inputTokens: number;
    outputTokens: number;
    verifiedActions: number;
    demo: number;
    live: number;
    unavailable: number;
    duration: Timing;
  };
  reviews: {
    proposed: number;
    pending: number;
    stale: number;
    approved: number;
    rejected: number;
    wait: Timing;
  };
  backlog: {
    total: number;
    unassigned: number;
    overdue: number;
    review: number;
    blocked: number;
    oldestMinutes: number | null;
    ages: { label: string; count: number }[];
    priorities: { priority: Priority; count: number; overdue: number }[];
  };
  agents: {
    id: string;
    name: string;
    enabled: boolean;
    active: number;
    review: number;
    runs: number;
    completed: number;
    failed: number;
    proposals: number;
    approved: number;
    rejected: number;
    tokens: number;
    avgRunMinutes: number | null;
  }[];
  trend: {
    day: string;
    opened: number;
    closed: number;
    completed: number;
    failed: number;
    approved: number;
    rejected: number;
    inputTokens: number;
    outputTokens: number;
  }[];
}
export interface Timing {
  count: number;
  average: number | null;
  p50: number | null;
  p95: number | null;
}
export interface ResponseDraft {
  id: string;
  runId: string;
  agentName: string;
  body: string;
  createdAt: string;
  action: { type: 'none' | 'update_address'; orderId: string | null; address: string | null };
}
export const responseDraftSchema = z.object({
  note: z.string().trim().max(2000).default(''),
  draftId: z.uuid(),
  expectedRevision: z.number().int().nonnegative(),
  decision: z.enum(['send', 'discard']),
  body: z.string().trim().min(1).max(5000).optional(),
});

export const createUserSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z
    .email()
    .max(254)
    .transform((v) => v.toLowerCase()),
  password: z.string().min(12).max(128),
  role: z.enum(roles),
});
