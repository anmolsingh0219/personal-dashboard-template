import { useEffect, useRef } from "react";

// Tiny app-wide event bus so the command palette can trigger actions inside panels.
export type DashEvent = "dash:autoplan" | "dash:add-job" | "dash:add-holding" | "dash:focus-task";

export const emit = (name: DashEvent) => window.dispatchEvent(new Event(name));

export function useDashEvent(name: DashEvent, handler: () => void) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    const listener = () => ref.current();
    window.addEventListener(name, listener);
    return () => window.removeEventListener(name, listener);
  }, [name]);
}
