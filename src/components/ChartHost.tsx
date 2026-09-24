import { lazy, Suspense } from "react";
import { closeChart, useChartTarget } from "../lib/chartStore";

// The charting library is loaded only when a chart is first opened.
const MarketChartDialog = lazy(() => import("./MarketChartDialog"));

export function ChartHost() {
  const target = useChartTarget();
  if (!target) return null;
  return (
    <Suspense fallback={null}>
      <MarketChartDialog key={target.symbol} symbol={target.symbol} name={target.name} onClose={closeChart} />
    </Suspense>
  );
}
