import { describe, expect, it } from "vitest";

import { csvCell, csvFilename, toCsv } from "@/lib/csv";

/**
 * The interesting half of this file is formula injection. A reason field is
 * free text somebody else typed, and a spreadsheet treats a leading `=` as
 * code — so an export is a way to run that code on the machine of whoever
 * opens it (docs/09-security.md §14).
 */

describe("cells", () => {
  it("passes ordinary text through untouched", () => {
    expect(csvCell("Ana Sharma")).toBe("Ana Sharma");
    expect(csvCell(42)).toBe("42");
  });

  it("quotes what would otherwise break the row", () => {
    expect(csvCell("Sharma, Ana")).toBe('"Sharma, Ana"');
    expect(csvCell('She said "no"')).toBe('"She said ""no"""');
    expect(csvCell("line one\nline two")).toBe('"line one\nline two"');
  });

  it("empties null and undefined rather than printing them", () => {
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
  });

  it("neutralises anything a spreadsheet would run", () => {
    for (const attack of ["=1+1", "+1+1", "-1+1", "@SUM(A1)", "=cmd|'/c calc'!A1", "\t=1+1"]) {
      const cell = csvCell(attack);
      // Prefixed, not stripped: the value is still the user's, and an export
      // that quietly edited it would be its own kind of wrong.
      expect(cell.replace(/^"/, "").startsWith("'")).toBe(true);
      expect(cell).toContain(attack.trim().slice(0, 4));
    }
  });

  it("still quotes a formula that also contains a comma", () => {
    expect(csvCell("=SUM(1,2)")).toBe(`"'=SUM(1,2)"`);
  });
});

describe("rows", () => {
  interface Row {
    name: string;
    days: number;
  }

  const columns = [
    { key: "name", label: "Employee" },
    { key: "days", label: "Days" },
    { key: "shouted", label: "Shouted", value: (r: Row) => r.name.toUpperCase() },
  ];

  it("writes a header and CRLF line endings", () => {
    const csv = toCsv<Row>(columns, [{ name: "Ana", days: 2 }]);
    expect(csv).toBe("Employee,Days,Shouted\r\nAna,2,ANA\r\n");
  });

  it("writes a header even with nothing to export", () => {
    expect(toCsv<Row>(columns, [])).toBe("Employee,Days,Shouted\r\n");
  });
});

describe("filenames", () => {
  it("stamps the date and strips anything that could break a header", () => {
    const name = csvFilename('audit"\nX-Evil: 1', new Date("2026-08-24T10:00:00.000Z"));
    expect(name).toBe("audit-X-Evil-1-2026-08-24.csv");
    expect(name).not.toMatch(/["\r\n]/);
  });
});
