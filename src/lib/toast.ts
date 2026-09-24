import { useSyncExternalStore } from "react";

export interface Toast {
  id: number;
  message: string;
  kind: "info" | "error";
}

let toasts: Toast[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function toast(message: string, kind: Toast["kind"] = "info") {
  const id = nextId++;
  toasts = [...toasts.slice(-3), { id, message, kind }];
  emit();
  setTimeout(() => dismissToast(id), kind === "error" ? 6000 : 3000);
}

export function dismissToast(id: number) {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

export function useToasts() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => toasts,
  );
}
