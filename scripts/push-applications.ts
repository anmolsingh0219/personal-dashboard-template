// Adds or advances job applications found in Gmail.
//
//   node scripts/push-applications.ts list                  # current applications (to match against)
//   node scripts/push-applications.ts push <apps.json>      # apply updates
//
// Add --local to use the local dev database. Matching is by `id` when given, otherwise by
// company + role (case/punctuation-insensitive). Stages only move forward.

import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { normalizeName, parseEmailApplications, STAGE_RANK } from "../shared/applications.ts";
import type { Stage } from "../shared/types.ts";
import { d1, sqlString, target } from "./d1.ts";

interface Row {
  id: string;
  company: string;
  role: string;
  stage: Stage;
  applied_on: string | null;
  notes: string | null;
  last_email_at: number | null;
}

const q = (v: string | null) => (v === null ? "NULL" : sqlString(v));

function list() {
  const [rows] = d1<Row>("SELECT id, company, role, stage, applied_on, last_email_at FROM applications ORDER BY company");
  console.log(JSON.stringify(rows, null, 2));
}

function push(file: string) {
  const { applications } = parseEmailApplications(JSON.parse(readFileSync(resolve(file), "utf8")));
  const [rows] = d1<Row>("SELECT id, company, role, stage, applied_on, notes, last_email_at FROM applications");
  const byKey = new Map(rows.map((r) => [`${normalizeName(r.company)}|${normalizeName(r.role)}`, r]));
  const now = Date.now();
  const statements: string[] = [];
  let added = 0;
  let advanced = 0;
  let touched = 0;

  for (const a of applications) {
    const key = `${normalizeName(a.company)}|${normalizeName(a.role)}`;
    const existing = byKey.get(key);

    if (!existing) {
      const id = randomUUID();
      statements.push(
        `INSERT INTO applications (id, company, role, stage, url, location, notes, applied_on, next_step, next_step_on, created_at, updated_at, email_thread_id, email_url, last_email_at)
         VALUES (${q(id)}, ${q(a.company)}, ${q(a.role)}, ${q(a.stage)}, NULL, NULL, ${q(a.note)}, ${q(a.appliedOn)}, ${q(a.nextStep)}, ${q(a.nextStepOn)}, ${now}, ${now}, ${q(a.threadId)}, ${q(a.emailUrl)}, ${a.lastEmailAt})`,
      );
      byKey.set(key, { id, company: a.company, role: a.role, stage: a.stage, applied_on: a.appliedOn, notes: a.note, last_email_at: a.lastEmailAt });
      added++;
      continue;
    }

    // Older news than what's already recorded changes nothing.
    if (existing.last_email_at && a.lastEmailAt <= existing.last_email_at) continue;
    const stage = STAGE_RANK[a.stage] > STAGE_RANK[existing.stage] ? a.stage : existing.stage;
    const notes = a.note && !(existing.notes ?? "").includes(a.note) ? [existing.notes, a.note].filter(Boolean).join("\n") : existing.notes;
    statements.push(
      `UPDATE applications SET
         stage = ${q(stage)},
         applied_on = COALESCE(applied_on, ${q(a.appliedOn)}),
         next_step = ${a.nextStep ? q(a.nextStep) : "next_step"},
         next_step_on = ${a.nextStep ? q(a.nextStepOn) : "next_step_on"},
         notes = ${q(notes)},
         email_thread_id = ${q(a.threadId)}, email_url = ${q(a.emailUrl)}, last_email_at = ${a.lastEmailAt},
         updated_at = ${now}
       WHERE id = ${q(existing.id)}`,
    );
    if (stage !== existing.stage) advanced++;
    else touched++;
    Object.assign(existing, { stage, notes, last_email_at: a.lastEmailAt });
  }

  if (statements.length) d1(statements.join(";\n"));
  console.log(`Applications (${target}): ${added} added, ${advanced} moved to a later stage, ${touched} refreshed.`);
}

const [command, file] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
try {
  if (command === "list") list();
  else if (command === "push" && file) push(file);
  else {
    console.error("Usage: node scripts/push-applications.ts list | push <apps.json> [--local]");
    process.exit(2);
  }
} catch (e) {
  console.error(`Applications rejected: ${(e as Error).message}`);
  process.exit(1);
}
