import { useQueryClient } from "@tanstack/react-query";
import { AlarmClock, Check, Copy, ExternalLink, Mail, Reply } from "lucide-react";
import { useState } from "react";
import type { EmailResponse, EmailThread } from "../../shared/types";
import { api } from "../lib/api";
import { keys, useAction, useEmail, useGoogleStatus } from "../lib/queries";
import { addDays, ago, fmtTime, startOfDay } from "../lib/time";
import { toast } from "../lib/toast";
import { Card, Empty, ErrorNote, GoogleConnect, isCode, Loading, RefreshButton } from "./ui";

type Tab = "reply" | "waiting";

export function Inbox({ now }: { now: number }) {
  const qc = useQueryClient();
  const google = useGoogleStatus();
  const email = useEmail();
  const [tab, setTab] = useState<Tab>("reply");
  const notConnected = isCode(email.error, "google_not_connected");

  const dismiss = useAction(
    ({ thread, snoozeUntil }: { thread: EmailThread; snoozeUntil?: number }) => api.post(`/email/${thread.threadId}/dismiss`, { lastMessageId: thread.lastMessageId, snoozeUntil }),
    [],
  );

  function hide(thread: EmailThread, snoozeUntil?: number) {
    qc.setQueryData<EmailResponse>(keys.email, (old) =>
      old && { ...old, needsReply: old.needsReply.filter((t) => t.threadId !== thread.threadId), waitingOn: old.waitingOn.filter((t) => t.threadId !== thread.threadId) },
    );
    dismiss.mutate({ thread, snoozeUntil });
  }

  const refresh = useAction(() => api.get<EmailResponse>("/email?refresh=1").then((d) => qc.setQueryData(keys.email, d)), []);

  const needsReply = email.data?.needsReply ?? [];
  const waitingOn = email.data?.waitingOn ?? [];
  const list = tab === "reply" ? needsReply : waitingOn;
  const tomorrowMorning = addDays(startOfDay(now), 1) + 8 * 3_600_000;

  return (
    <Card
      id="inbox"
      title="Email"
      icon={Mail}
      count={needsReply.length}
      fill
      className="xl:flex-[1.4]"
      toolbar={
        email.data && (
          <div className="mb-2 flex items-center gap-1 text-xs" role="tablist">
            <TabButton active={tab === "reply"} onClick={() => setTab("reply")} label="Needs reply" count={needsReply.length} />
            <TabButton active={tab === "waiting"} onClick={() => setTab("waiting")} label="Waiting on" count={waitingOn.length} />
            {email.data.source === "claude" && (
              <span className="ml-auto text-muted" title="Refreshed by the scheduled Claude task">
                via Claude · {fmtTime(email.data.fetchedAt)}
                {startOfDay(email.data.fetchedAt) !== startOfDay(now) && `, ${new Date(email.data.fetchedAt).toLocaleDateString([], { weekday: "short" })}`}
              </span>
            )}
          </div>
        )
      }
      actions={
        email.data && (
          <>
            <span className="mr-1 hidden max-w-40 truncate text-xs text-muted sm:inline">{email.data.account}</span>
            <RefreshButton onClick={() => refresh.mutate()} busy={email.isFetching || refresh.isPending} />
          </>
        )
      }
    >
      {email.isPending ? (
        <Loading />
      ) : notConnected ? (
        <div className="space-y-3 py-4 text-center">
          <p className="text-sm text-ink-2">
            Nothing here yet. The scheduled Claude task fills this in at 9:30 AM, 1 PM and 5 PM, or you can connect Google directly for live updates.
          </p>
          {google.data?.configured && <GoogleConnect />}
        </div>
      ) : (
        <>
          {email.error ? (
            <ErrorNote error={email.error}>
              {isCode(email.error, "google_not_connected") || isCode(email.error, "scope_missing") ? (
                <GoogleConnect label="Reconnect Google" />
              ) : (
                <p className="text-xs text-muted">If this says access is blocked, your school or company may not allow third-party Gmail access. See README → "If your Google Workspace blocks Gmail".</p>
              )}
            </ErrorNote>
          ) : list.length === 0 ? (
            <Empty>{tab === "reply" ? "Inbox zero on replies." : "Nobody owes you a reply."}</Empty>
          ) : (
            <ul className="-mx-2 max-h-[440px] divide-y divide-line/60 overflow-y-auto xl:max-h-none xl:overflow-visible">
              {list.map((t) => (
                <ThreadRow key={t.threadId} thread={t} now={now} waiting={tab === "waiting"} onDone={() => hide(t)} onSnooze={() => hide(t, tomorrowMorning)} />
              ))}
            </ul>
          )}
        </>
      )}
    </Card>
  );
}

function TabButton({ active, onClick, label, count }: { active: boolean; onClick: () => void; label: string; count: number }) {
  return (
    <button role="tab" aria-selected={active} onClick={onClick} className={`rounded-md px-2.5 py-1 font-medium transition ${active ? "bg-raised text-ink" : "text-muted hover:text-ink"}`}>
      {label} <span className="tabular text-muted">{count}</span>
    </button>
  );
}

function ThreadRow({ thread, now, waiting, onDone, onSnooze }: { thread: EmailThread; now: number; waiting: boolean; onDone: () => void; onSnooze: () => void }) {
  const [showReply, setShowReply] = useState(false);
  return (
    <li className="group relative px-2 py-2.5">
      <a href={thread.url} target="_blank" rel="noreferrer" className="block min-w-0 pr-2">
        <div className="flex items-baseline gap-2">
          {thread.unread && <span className="size-1.5 shrink-0 self-center rounded-full bg-accent" aria-label="Unread" />}
          <p className={`min-w-0 flex-1 truncate text-sm ${thread.unread ? "font-semibold text-ink" : "font-medium text-ink"}`}>
            {waiting ? `To ${thread.person.name}` : thread.person.name}
            {thread.messageCount > 1 && <span className="ml-1 text-xs font-normal text-muted tabular">{thread.messageCount}</span>}
          </p>
          <span className="shrink-0 text-xs text-muted tabular">{ago(thread.date, now)}</span>
        </div>
        <p className="truncate text-sm text-ink-2">{thread.subject}</p>
        <p className="truncate text-xs text-muted">{thread.snippet}</p>
      </a>
      <div className="mt-1.5 flex items-center gap-1">
        {thread.reasons.map((r) => (
          <span key={r} className="chip">
            {r}
          </span>
        ))}
        {thread.suggestedReply && (
          <button className="chip text-accent hover:text-ink" onClick={() => setShowReply(!showReply)} aria-expanded={showReply}>
            <Reply className="size-3" aria-hidden /> {showReply ? "Hide draft" : "Draft"}
          </button>
        )}
        <div className="ml-auto flex opacity-100 transition [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:group-focus-within:opacity-100">
          <a href={thread.url} target="_blank" rel="noreferrer" className="icon-btn" title="Open in Gmail" aria-label="Open in Gmail">
            <ExternalLink className="size-3.5" />
          </a>
          <button className="icon-btn" onClick={onSnooze} title="Snooze until tomorrow 8 AM" aria-label="Snooze">
            <AlarmClock className="size-3.5" />
          </button>
          <button className="icon-btn hover:text-good" onClick={onDone} title={waiting ? "Stop tracking" : "Done — hide until they write again"} aria-label="Done">
            <Check className="size-3.5" />
          </button>
        </div>
      </div>
      {showReply && thread.suggestedReply && <SuggestedReply text={thread.suggestedReply} url={thread.url} />}
    </li>
  );
}

function SuggestedReply({ text, url }: { text: string; url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="mt-2 rounded-lg border border-line bg-raised/50 p-2.5">
      <p className="text-sm whitespace-pre-wrap text-ink-2">{text}</p>
      <div className="mt-2 flex gap-1.5">
        <button
          className="btn-ghost px-2 py-1 text-xs"
          onClick={() =>
            navigator.clipboard.writeText(text).then(
              () => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              },
              () => toast("Couldn't copy. Select the text instead.", "error"),
            )
          }
        >
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />} {copied ? "Copied" : "Copy"}
        </button>
        <a href={url} target="_blank" rel="noreferrer" className="btn-ghost px-2 py-1 text-xs">
          <ExternalLink className="size-3.5" /> Reply in Gmail
        </a>
      </div>
    </div>
  );
}
