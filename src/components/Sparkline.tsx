/** Intraday line with the previous close as a dashed baseline. Colored by direction; always shown next to a signed % change. */
export function Sparkline({ values, baseline, up }: { values: number[]; baseline: number | null; up: boolean }) {
  if (values.length < 2) return <span className="block h-6 w-16" />;
  const W = 64;
  const H = 24;
  const all = baseline ? [...values, baseline] : values;
  const min = Math.min(...all);
  const max = Math.max(...all);
  const y = (v: number) => H - 2 - ((v - min) / (max - min || 1)) * (H - 4);
  const d = values.map((v, i) => `${i ? "L" : "M"}${((i / (values.length - 1)) * W).toFixed(1)},${y(v).toFixed(1)}`).join("");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-6 w-16" aria-hidden>
      {baseline && <line x1={0} x2={W} y1={y(baseline)} y2={y(baseline)} stroke="var(--color-axis)" strokeDasharray="2 2" strokeWidth={1} />}
      <path d={d} fill="none" stroke={up ? "var(--color-good)" : "var(--color-bad)"} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
