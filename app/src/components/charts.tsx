import { useState } from 'react';
import clsx from 'clsx';

/**
 * Single-series charts (one hue = primary). Thin marks with a 4px rounded data end,
 * values in text tokens, hover tooltips, and a table view where the page needs one.
 */

export type BarDatum = { key: string; label: string; value: number; max: number; display: string; tooltip?: string };

/** Horizontal bars, each against its own maximum (e.g. question average out of marks). */
export function BarList({ data, className }: { data: BarDatum[]; className?: string }) {
  const [hover, setHover] = useState<string | null>(null);
  return (
    <ul className={clsx('space-y-4', className)}>
      {data.map((d) => {
        const pct = d.max ? Math.max(0, Math.min(1, d.value / d.max)) : 0;
        return (
          <li key={d.key} onMouseEnter={() => setHover(d.key)} onMouseLeave={() => setHover(null)} className="relative">
            <div className="mb-1.5 flex items-baseline justify-between gap-3 text-small">
              <span className="min-w-0 truncate text-ink">{d.label}</span>
              <span className="tnum shrink-0 font-semibold text-ink">{d.display}</span>
            </div>
            <div className="h-2.5 w-full rounded-r-[4px] bg-primary-tint">
              <div
                className={clsx('h-full rounded-r-[4px] bg-primary transition-[width] duration-500', hover === d.key && 'bg-primary-hover')}
                style={{ width: `${pct * 100}%` }}
              />
            </div>
            {hover === d.key && d.tooltip ? (
              <div className="pointer-events-none absolute -top-2 left-1/2 z-10 max-w-xs -translate-x-1/2 -translate-y-full rounded-ctl border border-line bg-surface px-3 py-2 text-caption text-ink shadow-pop">
                {d.tooltip}
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

export type ColumnDatum = { key: string; label: string; value: number; tooltip?: string; emphasis?: boolean };

/** Vertical columns from a shared baseline (e.g. marks distribution). */
export function ColumnChart({ data, height = 180, valueLabel = (v: number) => String(v) }: { data: ColumnDatum[]; height?: number; valueLabel?: (v: number) => string }) {
  const [hover, setHover] = useState<string | null>(null);
  const max = Math.max(1, ...data.map((d) => d.value));
  const plot = height - 24;
  return (
    <div className="w-full" role="img" aria-label={data.map((d) => `${d.label}: ${valueLabel(d.value)}`).join(', ')}>
      <div className="relative flex items-end justify-around gap-2 border-b border-line" style={{ height }}>
        {data.map((d) => {
          const h = (d.value / max) * plot;
          return (
            <div
              key={d.key}
              className="relative flex h-full flex-1 flex-col items-center justify-end"
              onMouseEnter={() => setHover(d.key)}
              onMouseLeave={() => setHover(null)}
            >
              <span className="tnum mb-1 text-caption font-semibold text-ink">{valueLabel(d.value)}</span>
              <div
                className={clsx('w-6 rounded-t-[4px] transition-[height] duration-500', d.emphasis ? 'bg-primary' : 'bg-primary/55', hover === d.key && 'bg-primary-hover')}
                style={{ height: Math.max(d.value ? 3 : 0, h) }}
              />
              {hover === d.key && d.tooltip ? (
                <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 w-max max-w-[180px] -translate-x-1/2 rounded-ctl border border-line bg-surface px-3 py-2 text-caption text-ink shadow-pop">
                  {d.tooltip}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex justify-around gap-2">
        {data.map((d) => (
          <span key={d.key} className={clsx('tnum flex-1 text-center text-caption', d.emphasis ? 'font-semibold text-ink' : 'text-muted')}>
            {d.label}
          </span>
        ))}
      </div>
    </div>
  );
}
