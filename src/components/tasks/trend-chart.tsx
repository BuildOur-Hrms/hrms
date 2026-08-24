"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  AXIS_STYLE,
  ChartLegend,
  ChartTooltip,
  GRID_STROKE,
  SERIES,
  monthLabel,
} from "./chart-parts";

/**
 * Completion month by month.
 *
 * A line, because the question is which way this is going — a bar chart of
 * twelve months answers "how much in March" and nobody asks that.
 *
 * The y-axis is pinned to 0–100 rather than fitted to the data. A percentage
 * chart that rescales itself makes a move from 71% to 74% look like a
 * transformation, which is exactly the flattery a figure tied to pay must not
 * offer.
 */

export interface TrendPoint {
  label: string;
  assigned: number;
  self: number;
  total?: number;
}

export function TrendChart({ data, height = 220 }: { data: TrendPoint[]; height?: number }) {
  const crossesYear = new Set(data.map((point) => point.label.slice(0, 4))).size > 1;

  return (
    <div>
      <ChartLegend className="mb-3" />
      <ResponsiveContainer width="100%" height={height}>
        {/* No negative left margin: pulling the plot left clips the leading
              digit off the axis labels, so 100% reads as 10%. */}
        <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
          {/* Horizontal only: the months are labelled, and vertical rules
              across a short series are noise pretending to be structure. */}
          <CartesianGrid stroke={GRID_STROKE} strokeWidth={1} vertical={false} />
          <XAxis
            dataKey="label"
            tickFormatter={(value: string) => monthLabel(value, crossesYear)}
            {...AXIS_STYLE}
          />
          <YAxis
            domain={[0, 100]}
            ticks={[0, 25, 50, 75, 100]}
            tickFormatter={(value: number) => `${value}%`}
            width={46}
            {...AXIS_STYLE}
          />
          <Tooltip
            cursor={{ stroke: GRID_STROKE, strokeWidth: 1 }}
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null;
              const point = payload[0]?.payload as TrendPoint;
              return (
                <ChartTooltip
                  title={monthLabel(String(label), true)}
                  rows={[
                    {
                      label: SERIES.assigned.label,
                      value: point.assigned,
                      color: SERIES.assigned.color,
                    },
                    { label: SERIES.self.label, value: point.self, color: SERIES.self.color },
                  ]}
                  footer={
                    point.total !== undefined
                      ? `${point.total} task${point.total === 1 ? "" : "s"} that month`
                      : undefined
                  }
                />
              );
            }}
          />
          {Object.values(SERIES).map((series) => (
            <Line
              key={series.key}
              type="monotone"
              dataKey={series.key}
              name={series.label}
              stroke={series.color}
              strokeWidth={2}
              // Big enough to hit, and ringed in the surface colour so two
              // points that overlap still read as two.
              dot={{ r: 4, fill: series.color, stroke: "var(--card)", strokeWidth: 2 }}
              activeDot={{ r: 6, fill: series.color, stroke: "var(--card)", strokeWidth: 2 }}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
