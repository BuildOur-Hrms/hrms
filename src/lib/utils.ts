import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Initials for avatar fallbacks. */
export function initials(first: string, last?: string | null): string {
  const a = first.trim().charAt(0);
  const b = last?.trim().charAt(0) ?? "";
  return (a + b).toUpperCase() || "?";
}

export function fullName(first: string, last?: string | null): string {
  return [first, last].filter(Boolean).join(" ");
}

/** `2024-03-07` for a Date, in UTC — dates in this system are calendar days. */
export function toDateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Parse a `YYYY-MM-DD` calendar day into the UTC midnight Prisma stores. */
export function fromDateOnly(s: string): Date {
  return new Date(`${s}T00:00:00.000Z`);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
