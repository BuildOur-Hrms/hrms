"use client";

import dynamic from "next/dynamic";

import { Skeleton } from "@/components/ui/skeleton";

/**
 * The charts, fetched when they are needed rather than with the page.
 *
 * Recharts is about a hundred kilobytes, and it was being loaded by every
 * visitor to the task screens whether or not a chart was ever drawn — on
 * `/hr/tasks` and `/team/tasks` it was roughly a third of everything the
 * browser downloaded before the page could be used.
 *
 * The placeholder is the same height as the chart it stands in for, so the
 * page does not jump when the real one arrives. That is the whole reason the
 * fallback is a sized skeleton and not a spinner.
 *
 * `ssr: false` because a chart has nothing useful to say on the server: it is
 * measured against the width of its container, which does not exist yet.
 */

export const TrendChart = dynamic(() => import("./trend-chart").then((m) => m.TrendChart), {
  ssr: false,
  loading: () => <Skeleton className="h-[220px] w-full" />,
});

export const RankingChart = dynamic(() => import("./ranking-chart").then((m) => m.RankingChart), {
  ssr: false,
  loading: () => <Skeleton className="h-[220px] w-full" />,
});

export type { TrendPoint } from "./trend-chart";
export type { RankingRow } from "./ranking-chart";
