import { withApi } from "@/lib/api";
import { createComponent, listComponents } from "@/modules/payroll/service";
import { componentSchema, type ComponentInput } from "@/modules/payroll/validators";

export const runtime = "nodejs";

/** The lines that can appear on a payslip. */
export const GET = withApi({ permission: "payroll.view_all" }, async ({ ctx }) =>
  listComponents(ctx),
);

export const POST = withApi<ComponentInput>(
  { permission: "payroll.manage", body: componentSchema, rateLimit: "mutation", status: 201 },
  async ({ ctx, body }) => createComponent(ctx, body),
);
