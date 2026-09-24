import { useSyncExternalStore } from "react";

// Which market chart pop-up is open (if any). Any panel can open one.
export interface ChartTarget {
  symbol: string;
  name: string;
}

let target: ChartTarget | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const openChart = (symbol: string, name: string) => {
  target = { symbol, name };
  emit();
};

export const closeChart = () => {
  target = null;
  emit();
};

export const useChartTarget = () =>
  useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => target,
  );
