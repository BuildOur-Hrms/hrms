"use client";

import type { ReactNode } from "react";

/**
 * The pieces both task charts are made of.
 *
 * Kept together so the two can never drift into disagreeing about what a
 * series is called or what colour it wears — which is the usual way a
 * dashboard starts lying quietly.
 *
 * The palette is two chart-grade steps of the brand orange and a blue, defined
 * in globals.css and validated there: inside the lightness band, above the
 * chroma floor, and 20.4 apart in OKLab under simulated protanopia against a
 * target of 8. Dark mode is re-stepped against the dark surface rather than
 * flipped.
 */

export const SERIES = {
  assigned: { key: "assigned", label: "Assigned", color: "var(--task-assigned)" },
  self: { key: "self", label: "Self-added", color: "var(--task-self)" },
} as const;

/** Recessive by design: one shade off the surface, solid, never dashed. */
export const AXIS_STYLE = {
  stroke: "var(--border)",
  fontSize: 11,
  tickLine: false,
  axisLine: false,
} as const;

export const GRID_STROKE = "var(--border)";

/**
 * A legend, always present when there are two series.
 *
 * Identity is never carried by colour alone — the swatch sits beside its name,
 * and the tooltip repeats both.
 */
export function ChartLegend({ className = "" }: { className?: string }) {
  return (
    <ul className={`text-muted-foreground flex flex-wrap items-center gap-4 text-xs ${className}`}>
      {Object.values(SERIES).map((series) => (
        <li key={series.key} className="flex items-center gap-1.5">
          <span
            aria-hidden
            className="size-2.5 rounded-[2px]"
            style={{ background: series.color }}
          />
          {series.label}
        </li>
      ))}
    </ul>
  );
}

export interface TooltipDatum {
  label: string;
  value: number;
  color: string;
}

/**
 * The hover layer.
 *
 * Text wears text tokens; the colour sits in a swatch beside it. A percentage
 * printed in orange on a white card is a legibility problem pretending to be a
 * design decision.
 */
export function ChartTooltip({
  title,
  rows,
  footer,
}: {
  title: string;
  rows: TooltipDatum[];
  footer?: ReactNode;
}) {
  return (
    <div className="bg-popover text-popover-foreground rounded-lg border p-2.5 text-xs shadow-md">
      <p className="mb-1.5 font-medium">{title}</p>
      <ul className="space-y-1">
        {rows.map((row) => (
          <li key={row.label} className="flex items-center gap-2">
            <span
              aria-hidden
              className="size-2 shrink-0 rounded-[2px]"
              style={{ background: row.color }}
            />
            <span className="text-muted-foreground">{row.label}</span>
            <span className="ml-auto font-medium tabular-nums">{row.value}%</span>
          </li>
        ))}
      </ul>
      {footer ? <p className="text-muted-foreground mt-1.5">{footer}</p> : null}
    </div>
  );
}

/** `2026-09` → `Sep`, with the year only when the window crosses one. */
export function monthLabel(label: string, showYear = false): string {
  const [year, month] = label.split("-");
  const name = new Date(Date.UTC(2000, Number(month) - 1, 1)).toLocaleString("en", {
    month: "short",
  });
  return showYear ? `${name} ${year?.slice(2)}` : name;
}
