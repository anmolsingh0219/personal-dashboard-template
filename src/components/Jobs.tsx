import { Briefcase, ExternalLink, Mail, Plus, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { STAGES, type Application, type Stage } from "../../shared/types";
import { api } from "../lib/api";
import { useDashEvent } from "../lib/events";
import { keys, useAction, useJobs } from "../lib/queries";
import { daysUntil, relDay, ymd } from "../lib/time";
import { Card, Empty, ErrorNote, Loading } from "./ui";

export const STAGE_LABEL: Record<Stage, string> = { saved: "Saved", applied: "Applied", oa: "OA", interview: "Interview", offer: "Offer", rejected: "Rejected" };
const FOLLOW_UP_DAYS = 14;

type Filter = "active" | Stage;

const jobApi = {
  create: (a: Partial<Application>) => api.post<Application>("/jobs", a),
  update: ({ id, ...patch }: Partial<Application> & { id: string }) => api.patch<Application>(`/jobs/${id}`, patch),
  remove: (id: string) => api.del(`/jobs/${id}`),
};

export function Jobs({ now }: { now: number }) {
  const jobs = useJobs();
  const [filter, setFilter] = useState<Filter>("active");
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const create = useAction(jobApi.create, [keys.jobs]);
  const update = useAction(jobApi.update, [keys.jobs]);
  const remove = useAction(jobApi.remove, [keys.jobs]);

  useDashEvent("dash:add-job", () => setAdding(true));

  const all = jobs.data ?? [];
  const counts = Object.fromEntries(STAGES.map((s) => [s, all.filter((a) => a.stage === s).length])) as Record<Stage, number>;
  const shown = all
    .filter((a) => (filter === "active" ? a.stage !== "rejected" : a.stage === filter))
    .sort((a, b) => urgency(b, now) - urgency(a, now) || b.updatedAt - a.updatedAt);
  const active = all.length - counts.rejected;

  return (
    <Card
      id="jobs"
      title="Applications"
      icon={Briefcase}
      count={active}
      fill
      className="xl:flex-[1.3]"
      actions={
        <button className="icon-btn" onClick={() => setAdding(!adding)} title="Add application" aria-label="Add application">
          <Plus className="size-4" />
        </button>
      }
      toolbar={
        <>
          {adding && (
            <AddForm
              onCancel={() => setAdding(false)}
              onSubmit={(a) => {
                create.mutate(a);
                setAdding(false);
              }}
            />
          )}
          {all.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1 text-xs">
              <FilterChip active={filter === "active"} onClick={() => setFilter("active")} label="Active" count={active} />
              {STAGES.map((s) => (
                <FilterChip key={s} active={filter === s} onClick={() => setFilter(s)} label={STAGE_LABEL[s]} count={counts[s]} />
              ))}
            </div>
          )}
        </>
      }
    >
      {jobs.isPending ? (
        <Loading />
      ) : jobs.error ? (
        <ErrorNote error={jobs.error} />
      ) : all.length === 0 ? (
        <Empty>
          Track every role you apply to.{" "}
          <button className="text-accent hover:underline" onClick={() => setAdding(true)}>
            Add the first one
          </button>
        </Empty>
      ) : shown.length === 0 ? (
        <Empty>Nothing in {filter === "active" ? "progress" : STAGE_LABEL[filter]}.</Empty>
      ) : (
        <ul className="-mx-2 max-h-[420px] divide-y divide-line/60 overflow-y-auto xl:max-h-none xl:overflow-visible">
          {shown.map((a) => (
            <AppRow
              key={a.id}
              app={a}
              now={now}
              open={open === a.id}
              onToggle={() => setOpen(open === a.id ? null : a.id)}
              onChange={(patch) => update.mutate({ id: a.id, ...patch })}
              onDelete={() => remove.mutate(a.id)}
            />
          ))}
        </ul>
      )}
    </Card>
  );
}

/** Next steps due soon and stale applications float to the top. */
function urgency(a: Application, now: number) {
  if (a.nextStepOn) return 100 - Math.min(99, Math.max(-99, daysUntil(a.nextStepOn, now)));
  return needsFollowUp(a, now) ? 50 : 0;
}

function needsFollowUp(a: Application, now: number) {
  return a.stage === "applied" && !a.nextStep && a.appliedOn !== null && -daysUntil(a.appliedOn, now) >= FOLLOW_UP_DAYS;
}

function FilterChip({ active, onClick, label, count }: { active: boolean; onClick: () => void; label: string; count: number }) {
  return (
    <button onClick={onClick} className={`rounded-md px-2 py-1 font-medium transition ${active ? "bg-raised text-ink" : "text-muted hover:text-ink"}`}>
      {label} <span className="tabular opacity-70">{count}</span>
    </button>
  );
}

function AppRow({ app, now, open, onToggle, onChange, onDelete }: { app: Application; now: number; open: boolean; onToggle: () => void; onChange: (p: Partial<Application>) => void; onDelete: () => void }) {
  const applied = app.appliedOn ? -daysUntil(app.appliedOn, now) : null;
  const nextDue = app.nextStepOn ? daysUntil(app.nextStepOn, now) : null;
  const followUp = needsFollowUp(app, now);

  return (
    <li className="px-2 py-2.5">
      <div className="flex items-start gap-2">
        <button className="min-w-0 flex-1 text-left" onClick={onToggle} aria-expanded={open}>
          <p className="truncate text-sm font-medium text-ink">
            {app.company} <span className="font-normal text-ink-2">· {app.role}</span>
          </p>
          <p className="truncate text-xs text-muted">
            {applied !== null ? (applied === 0 ? "Applied today" : `Applied ${applied}d ago`) : "Not applied yet"}
            {app.location ? ` · ${app.location}` : ""}
          </p>
          {app.nextStep && (
            <p className={`truncate text-xs ${nextDue !== null && nextDue <= 0 ? "text-warn" : "text-ink-2"}`}>
              Next: {app.nextStep}
              {app.nextStepOn ? ` · ${relDay(app.nextStepOn, now)}` : ""}
            </p>
          )}
          {app.notes && !open && <p className="truncate text-xs text-muted">{app.notes.split("\n").at(-1)}</p>}
          {followUp && <span className="chip mt-1 text-warn">Follow up?</span>}
        </button>
        <select
          className="rounded-md border border-line bg-raised px-1.5 py-1 text-xs text-ink-2 outline-none focus:border-accent/70"
          value={app.stage}
          onChange={(e) => onChange({ stage: e.target.value as Stage })}
          aria-label={`Stage for ${app.company}`}
        >
          {STAGES.map((s) => (
            <option key={s} value={s}>
              {STAGE_LABEL[s]}
            </option>
          ))}
        </select>
        {app.emailUrl && (
          <a href={app.emailUrl} target="_blank" rel="noreferrer" className="icon-btn" aria-label="Open latest email" title="Open latest email">
            <Mail className="size-3.5" />
          </a>
        )}
        {app.url && (
          <a href={app.url} target="_blank" rel="noreferrer" className="icon-btn" aria-label="Open posting" title="Open posting">
            <ExternalLink className="size-3.5" />
          </a>
        )}
      </div>
      {open && <Details app={app} onChange={onChange} onDelete={onDelete} />}
    </li>
  );
}

function Details({ app, onChange, onDelete }: { app: Application; onChange: (p: Partial<Application>) => void; onDelete: () => void }) {
  const [nextStep, setNextStep] = useState(app.nextStep ?? "");
  const [nextStepOn, setNextStepOn] = useState(app.nextStepOn ?? "");
  const [notes, setNotes] = useState(app.notes ?? "");
  const [url, setUrl] = useState(app.url ?? "");
  const [appliedOn, setAppliedOn] = useState(app.appliedOn ?? "");

  function save(e: FormEvent) {
    e.preventDefault();
    onChange({ nextStep, nextStepOn: nextStepOn || null, notes, url: url || null, appliedOn: appliedOn || null });
  }

  return (
    <form onSubmit={save} className="mt-2 grid grid-cols-2 gap-2 rounded-xl bg-raised/40 p-2">
      <input className="input col-span-2 sm:col-span-1" placeholder="Next step (e.g. Recruiter call)" value={nextStep} onChange={(e) => setNextStep(e.target.value)} />
      <input className="input col-span-2 sm:col-span-1" type="date" value={nextStepOn} onChange={(e) => setNextStepOn(e.target.value)} aria-label="Next step date" />
      <input className="input col-span-2 sm:col-span-1" placeholder="Posting link" value={url} onChange={(e) => setUrl(e.target.value)} />
      <input className="input col-span-2 sm:col-span-1" type="date" value={appliedOn} onChange={(e) => setAppliedOn(e.target.value)} aria-label="Applied on" title="Applied on" />
      <textarea className="input col-span-2 min-h-16" placeholder="Notes: referral, contacts, salary range…" value={notes} onChange={(e) => setNotes(e.target.value)} />
      <div className="col-span-2 flex justify-between">
        <button type="button" className="btn-ghost hover:text-bad" onClick={onDelete}>
          <Trash2 className="size-3.5" /> Delete
        </button>
        <button className="btn-primary">Save</button>
      </div>
    </form>
  );
}

function AddForm({ onSubmit, onCancel }: { onSubmit: (a: Partial<Application>) => void; onCancel: () => void }) {
  const [company, setCompany] = useState("");
  const [role, setRole] = useState("");
  const [url, setUrl] = useState("");
  const [stage, setStage] = useState<Stage>("applied");

  return (
    <form
      className="mb-3 grid grid-cols-2 gap-2 rounded-xl border border-line bg-raised/40 p-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (company.trim() && role.trim()) onSubmit({ company, role, url: url.trim() || null, stage, appliedOn: stage === "saved" ? null : ymd(Date.now()) });
      }}
    >
      <input autoFocus className="input" placeholder="Company" value={company} onChange={(e) => setCompany(e.target.value)} onKeyDown={(e) => e.key === "Escape" && onCancel()} />
      <input className="input" placeholder="Role" value={role} onChange={(e) => setRole(e.target.value)} />
      <input className="input col-span-2 sm:col-span-1" placeholder="Posting link (optional)" value={url} onChange={(e) => setUrl(e.target.value)} />
      <select className="input col-span-2 sm:col-span-1" value={stage} onChange={(e) => setStage(e.target.value as Stage)} aria-label="Stage">
        {STAGES.map((s) => (
          <option key={s} value={s}>
            {STAGE_LABEL[s]}
          </option>
        ))}
      </select>
      <div className="col-span-2 flex justify-end gap-2">
        <button type="button" className="btn-ghost" onClick={onCancel}>
          Cancel
        </button>
        <button className="btn-primary" disabled={!company.trim() || !role.trim()}>
          Add
        </button>
      </div>
    </form>
  );
}
