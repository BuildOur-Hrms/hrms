/**
 * CSV, safe to open in a spreadsheet.
 *
 * Two problems, and the second is the one that matters.
 *
 * Quoting is ordinary: a field containing a comma, a quote or a newline is
 * wrapped and its quotes doubled.
 *
 * Formula injection is not. Excel, LibreOffice and Google Sheets all treat a
 * cell beginning `=`, `+`, `-`, `@`, tab or carriage return as a formula, so a
 * person who types `=cmd|'/c calc'!A1` into their own reason field has written
 * code that runs on the machine of whoever opens the export. The value is
 * still theirs and must survive intact, so it is prefixed with a single quote
 * — the spreadsheet convention for "this is text" — rather than stripped.
 *
 * docs/09-security.md §14 lists CSV injection among the suites that must exist.
 */

export interface CsvColumn<T> {
  key: string;
  label: string;
  /** Defaults to reading `key` off the row. */
  value?: (row: T) => unknown;
}

const NEEDS_QUOTING = /[",\r\n]/;
const LOOKS_LIKE_A_FORMULA = /^[=+\-@\t\r]/;

export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";

  const raw = value instanceof Date ? value.toISOString() : String(value);
  const safe = LOOKS_LIKE_A_FORMULA.test(raw) ? `'${raw}` : raw;

  return NEEDS_QUOTING.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv<T>(columns: readonly CsvColumn<T>[], rows: readonly T[]): string {
  const header = columns.map((column) => csvCell(column.label)).join(",");

  const body = rows.map((row) =>
    columns
      .map((column) =>
        csvCell(column.value ? column.value(row) : (row as Record<string, unknown>)[column.key]),
      )
      .join(","),
  );

  // CRLF and a trailing newline: what every spreadsheet expects, and what
  // stops the last row being dropped by the stricter parsers.
  return [header, ...body].join("\r\n") + "\r\n";
}

/**
 * A filename that cannot escape the header it is going into.
 *
 * Anything but letters, digits, dash and dot becomes a dash — a quote or a
 * newline here would let a value chosen elsewhere rewrite the response
 * headers.
 */
export function csvFilename(base: string, date = new Date()): string {
  const stamp = date.toISOString().slice(0, 10);
  const safe = base.replace(/[^A-Za-z0-9.-]+/g, "-").slice(0, 60);
  return `${safe}-${stamp}.csv`;
}
