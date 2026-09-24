import { useMutation, useQuery, useQueryClient, type QueryKey } from "@tanstack/react-query";
import type {
  Application,
  Block,
  CalendarResponse,
  EmailResponse,
  GoogleStatus,
  MarketsResponse,
  NewBlock,
  PickVerdict,
  PicksResponse,
  PortfolioEvent,
  SavedPick,
  Settings,
  StocksResponse,
  TasksResponse,
} from "../../shared/types";
import { api } from "./api";
import { toast } from "./toast";

const MIN = 60_000;

export const keys = {
  google: ["google"] as const,
  email: ["email"] as const,
  calendar: (from: number, to: number) => ["calendar", from, to] as const,
  tasks: ["tasks"] as const,
  blocks: (from: number, to: number) => ["blocks", from, to] as const,
  settings: ["settings"] as const,
  stocks: ["stocks"] as const,
  jobs: ["jobs"] as const,
  picks: (day: string) => ["picks", day] as const,
  saved: ["saved"] as const,
  portfolioEvents: ["portfolio-events"] as const,
};

export const useGoogleStatus = () => useQuery({ queryKey: keys.google, queryFn: () => api.get<GoogleStatus>("/google/status") });
export const useSettings = () => useQuery({ queryKey: keys.settings, queryFn: () => api.get<Settings>("/settings") });

export const useEmail = () => useQuery({ queryKey: keys.email, queryFn: () => api.get<EmailResponse>("/email"), refetchInterval: 3 * MIN, retry: false });

export const useCalendar = (from: number, to: number) =>
  useQuery({ queryKey: keys.calendar(from, to), queryFn: () => api.get<CalendarResponse>(`/calendar?from=${from}&to=${to}`), refetchInterval: 5 * MIN });

export const useTasks = () => useQuery({ queryKey: keys.tasks, queryFn: () => api.get<TasksResponse>("/tasks"), refetchInterval: 2 * MIN });

export const useBlocks = (from: number, to: number) =>
  useQuery({ queryKey: keys.blocks(from, to), queryFn: () => api.get<Block[]>(`/blocks?from=${from}&to=${to}`) });

export const useStocks = () => useQuery({ queryKey: keys.stocks, queryFn: () => api.get<StocksResponse>("/stocks"), refetchInterval: MIN });
export const useMarkets = () => useQuery({ queryKey: ["markets"], queryFn: () => api.get<MarketsResponse>("/markets"), refetchInterval: MIN });
export const usePortfolioEvents = () =>
  useQuery({ queryKey: keys.portfolioEvents, queryFn: () => api.get<PortfolioEvent[]>("/portfolio/events"), refetchInterval: 5 * MIN });
export const useJobs = () => useQuery({ queryKey: keys.jobs, queryFn: () => api.get<Application[]>("/jobs") });
export const usePicks = (day: string) => useQuery({ queryKey: keys.picks(day), queryFn: () => api.get<PicksResponse>(`/picks?day=${day}`), staleTime: 30 * MIN });
export const useSaved = (enabled: boolean) => useQuery({ queryKey: keys.saved, queryFn: () => api.get<SavedPick[]>("/picks/saved"), enabled });

/** Mutation that toasts failures and refreshes the given query prefixes afterwards. */
export function useAction<TVars, TResult = unknown>(fn: (vars: TVars) => Promise<TResult>, invalidate: QueryKey[], successMessage?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onError: (e: Error) => toast(e.message, "error"),
    onSuccess: () => successMessage && toast(successMessage),
    onSettled: () => Promise.all(invalidate.map((queryKey) => qc.invalidateQueries({ queryKey }))),
  });
}

export const blockApi = {
  create: (b: NewBlock | NewBlock[]) => api.post<Block[]>("/blocks", Array.isArray(b) ? { blocks: b } : b),
  update: ({ id, ...patch }: { id: string } & Partial<Pick<Block, "title" | "start" | "end" | "done">>) => api.patch<Block>(`/blocks/${id}`, patch),
  remove: (id: string) => api.del(`/blocks/${id}`),
};

export const taskApi = {
  create: (t: { title: string; due?: string | null; estimateMin?: number | null; target?: "google" | "local" }) => api.post<{ key: string }>("/tasks", t),
  update: ({ key, ...patch }: { key: string; done?: boolean; title?: string; due?: string | null; estimateMin?: number | null }) =>
    api.patch(`/tasks/${encodeURIComponent(key)}`, patch),
  remove: (key: string) => api.del(`/tasks/${encodeURIComponent(key)}`),
};

export const pickApi = {
  feedback: (f: { itemId: string; verdict: PickVerdict; title: string; url?: string }) => api.post("/picks/feedback", f),
  unsave: (p: { itemId: string }) => api.del(`/picks/saved/${encodeURIComponent(p.itemId)}`),
};
