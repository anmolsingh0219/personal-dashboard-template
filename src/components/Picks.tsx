import { Bookmark, BookOpen, Eye, MessageSquare, ThumbsDown, X } from "lucide-react";
import { useState } from "react";
import type { PickVerdict, ReadPick } from "../../shared/types";
import { keys, pickApi, useAction, usePicks, useSaved } from "../lib/queries";
import { ymd } from "../lib/time";
import { Card, Empty, ErrorNote, Loading } from "./ui";

export function Picks({ now }: { now: number }) {
  const day = ymd(now);
  const picks = usePicks(day);
  const [showSaved, setShowSaved] = useState(false);
  const saved = useSaved(showSaved);
  const feedback = useAction(pickApi.feedback, [["picks"], keys.saved]);
  const unsave = useAction(pickApi.unsave, [keys.saved]);

  const rate = (item: ReadPick, verdict: PickVerdict) => feedback.mutate({ itemId: item.id, verdict, title: item.title, url: item.url });

  return (
    <Card id="picks" title="Something to read" icon={BookOpen} className="xl:shrink-0">
      {picks.isPending ? (
        <Loading rows={2} />
      ) : picks.error ? (
        <ErrorNote error={picks.error} />
      ) : picks.data.read ? (
        <Read pick={picks.data.read} busy={feedback.isPending} onRate={(v) => rate(picks.data.read!, v)} />
      ) : (
        <p className="text-sm text-muted">{picks.data.readNote}</p>
      )}

      <button className="mt-2 text-xs text-muted hover:text-ink" onClick={() => setShowSaved(!showSaved)} aria-expanded={showSaved}>
        {showSaved ? "Hide saved" : "Saved for later"}
      </button>
      {showSaved &&
        (saved.isPending ? (
          <Loading rows={2} />
        ) : saved.data?.length ? (
          <ul className="mt-2 space-y-1">
            {saved.data.map((s) => (
              <li key={s.itemId} className="group flex items-center gap-2 text-sm">
                <BookOpen className="size-3.5 shrink-0 text-muted" />
                {s.url ? (
                  <a href={s.url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate text-ink-2 hover:text-ink">
                    {s.title}
                  </a>
                ) : (
                  <span className="min-w-0 flex-1 truncate text-ink-2">{s.title}</span>
                )}
                <button className="icon-btn size-6" onClick={() => unsave.mutate(s)} aria-label={`Remove ${s.title} from saved`} title="Done with it">
                  <X className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <Empty>Nothing saved yet.</Empty>
        ))}
    </Card>
  );
}

function Read({ pick, onRate, busy }: { pick: ReadPick; onRate: (v: PickVerdict) => void; busy: boolean }) {
  return (
    <div>
      <a href={pick.url} target="_blank" rel="noreferrer" className="font-medium text-ink hover:underline">
        {pick.title}
      </a>
      <p className="mt-0.5 flex items-center gap-2 text-xs text-muted">
        <span>{pick.source}</span>
        <span className="tabular">{pick.points} points</span>
        <a href={pick.discussionUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 hover:text-ink">
          <MessageSquare className="size-3" /> <span className="tabular">{pick.comments}</span>
        </a>
      </p>
      <div className="mt-1.5 flex flex-wrap gap-0.5">
        <button className="btn-ghost px-2 py-1 text-xs" disabled={busy} onClick={() => onRate("save")}>
          <Bookmark className="size-3.5" /> Save
        </button>
        <button className="btn-ghost px-2 py-1 text-xs" disabled={busy} onClick={() => onRate("seen")}>
          <Eye className="size-3.5" /> Read it
        </button>
        <button className="btn-ghost px-2 py-1 text-xs" disabled={busy} onClick={() => onRate("skip")}>
          <ThumbsDown className="size-3.5" /> Not for me
        </button>
      </div>
    </div>
  );
}
