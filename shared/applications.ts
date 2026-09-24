// .ts extensions let Node run the scripts that import this file directly.
import { gmailThreadUrl } from "./brief.ts";
import { STAGES, type Stage } from "./types.ts";

// Validates application updates found in Gmail (by the scheduled Claude task, or the
// one-off import) before scripts/push-applications.ts writes them to D1.

/** Stages only move forward; rejected ranks last so a rejection always sticks. */
export const STAGE_RANK: Record<Stage, number> = { saved: 0, applied: 1, oa: 2, interview: 3, offer: 4, rejected: 5 };

export const normalizeName = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export interface EmailApplication {
  company: string;
  role: string;
  stage: Stage;
  appliedOn: string | null;
  nextStep: string | null;
  nextStepOn: string | null;
  note: string | null;
  threadId: string;
  emailUrl: string;
  lastEmailAt: number;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const ID = /^[0-9a-f]{8,32}$/i;

function text(v: unknown, path: string, max: number, required = false): string | null {
  if (v != null && typeof v !== "string") throw new Error(`${path} must be a string`);
  const t = (v ?? "").trim().slice(0, max);
  if (!t && required) throw new Error(`${path} is required`);
  return t || null;
}

function date(v: unknown, path: string): string | null {
  const d = text(v, path, 10);
  if (d && !DATE.test(d)) throw new Error(`${path} must be YYYY-MM-DD`);
  return d;
}

export function parseEmailApplications(input: unknown): { account: string; applications: EmailApplication[] } {
  if (!input || typeof input !== "object") throw new Error("File must be a JSON object");
  const { account, applications } = input as { account?: unknown; applications?: unknown };
  const acct = text(account, "account", 200, true)!.toLowerCase();
  if (!/^[^\s@]+@[^\s@]+$/.test(acct)) throw new Error("account must be an email address");
  if (!Array.isArray(applications)) throw new Error("applications must be an array");
  if (applications.length > 200) throw new Error("At most 200 applications per push");

  return {
    account: acct,
    applications: applications.map((raw, i) => {
      const a = (raw ?? {}) as Record<string, unknown>;
      const path = `applications[${i}]`;
      const stage = a.stage as Stage;
      if (!STAGES.includes(stage)) throw new Error(`${path}.stage must be one of ${STAGES.join(", ")}`);
      const threadId = text(a.threadId, `${path}.threadId`, 32, true)!;
      if (!ID.test(threadId)) throw new Error(`${path}.threadId is not a Gmail id`);
      const lastEmailAt = Number(a.lastEmailAt);
      if (!Number.isFinite(lastEmailAt) || lastEmailAt <= 0) throw new Error(`${path}.lastEmailAt must be epoch milliseconds`);
      return {
        company: text(a.company, `${path}.company`, 120, true)!,
        role: text(a.role, `${path}.role`, 160) ?? "Role not in email",
        stage,
        appliedOn: date(a.appliedOn, `${path}.appliedOn`),
        nextStep: text(a.nextStep, `${path}.nextStep`, 160),
        nextStepOn: date(a.nextStepOn, `${path}.nextStepOn`),
        note: text(a.note, `${path}.note`, 300),
        threadId,
        emailUrl: gmailThreadUrl(acct, threadId),
        lastEmailAt,
      };
    }),
  };
}
