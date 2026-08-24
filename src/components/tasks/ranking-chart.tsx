"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { AXIS_STYLE, ChartLegend, ChartTooltip, GRID_STROKE, SERIES } from "./chart-parts";

/**
 * Where everyone stands this month.
 *
 * Horizontal bars, sorted by the assigned figure, because the question is a
 * ranking and names read better along the left edge than rotated under a
 * vertical axis.
 *
 * Two series side by side rather than one bar tinted by value. Tinting would
 * double-encode length as colour — spending the only free channel on something
 * the bar already says — and it would hide the split that makes the assigned
 * number worth trusting in the first place.
 */

export interface RankingRow {
  id: string;
  name: string;
  assigned: number;
  self: number;
  /** Shown in the tooltip: an average over two tasks is not the same claim. */
  taskCount: number;
}

/** Roughly what two grouped bars plus their gap need, per person. */
const ROW_HEIGHT = 34;

export function RankingChart({ rows }: { rows: RankingRow[] }) {
  const height = Math.max(160, rows.length * ROW_HEIGHT + 32);

  return (
    <div>
      <ChartLegend className="mb-3" />
      <ResponsiveContainer width="100%" height={height}>
        <BarChart
          data={rows}
          layout="vertical"
          margin={{ top: 4, right: 16, bottom: 4, left: 4 }}
          barGap={2}
        >
          <CartesianGrid stroke={GRID_STROKE} strokeWidth={1} horizontal={false} />
          <XAxis
            type="number"
            domain={[0, 100]}
            ticks={[0, 25, 50, 75, 100]}
            tickFormatter={(value: number) => `${value}%`}
            {...AXIS_STYLE}
          />
          <YAxis type="category" dataKey="name" width={132} {...AXIS_STYLE} />
          <Tooltip
            cursor={{ fill: "var(--muted)", fillOpacity: 0.4 }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const row = payload[0]?.payload as RankingRow;
              return (
                <ChartTooltip
                  title={row.name}
                  rows={[
                    {
                      label: SERIES.assigned.label,
                      value: row.assigned,
                      color: SERIES.assigned.color,
                    },
                    { label: SERIES.self.label, value: row.self, color: SERIES.self.color },
                  ]}
                  footer={`${row.taskCount} task${row.taskCount === 1 ? "" : "s"} this month`}
                />
              );
            }}
          />
          {Object.values(SERIES).map((series) => (
            <Bar
              key={series.key}
              dataKey={series.key}
              name={series.label}
              fill={series.color}
              // Rounded at the value end only, anchored to the baseline.
              radius={[0, 4, 4, 0]}
              maxBarSize={10}
              isAnimationActive={false}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
