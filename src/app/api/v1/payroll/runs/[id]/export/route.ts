import { NextResponse } from "next/server";

import { withApi } from "@/lib/api";
import { csvFilename } from "@/lib/csv";
import { exportRun } from "@/modules/payroll/service";
import { idParamSchema } from "@/modules/payroll/validators";

export const runtime = "nodejs";

type Params = { id: string };

/**
 * The handoff to whatever pays people.
 *
 * One row per person with the totals in minor units — what a finance system
 * imports. The component breakdown stays on the payslip, where the person it
 * concerns can read it.
 *
 * A separate permission from viewing, the same way the audit trail splits
 * them: reading pay on a screen leaves it in the system, and downloading it
 * does not.
 */
export const GET = withApi<Record<string, never>, Record<string, never>, Params>(
  { permission: "payroll.export", params: idParamSchema, rateLimit: "expensive" },
  async ({ ctx, params }) => {
    const csv = await exportRun(ctx, params.id);

    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${csvFilename("payroll")}"`,
        "Cache-Control": "no-store, max-age=0",
      },
    });
  },
);
