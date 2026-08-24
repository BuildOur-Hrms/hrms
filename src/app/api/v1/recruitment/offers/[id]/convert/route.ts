import { withApi } from "@/lib/api";
import { convertToEmployee } from "@/modules/recruitment/service";
import { convertSchema, idParamSchema, type ConvertInput } from "@/modules/recruitment/validators";

export const runtime = "nodejs";

type Params = { id: string };

/**
 * An accepted offer becomes a person on the payroll.
 *
 * Needs `employee.create` as well as the right to edit the pipeline, both
 * checked in the service: this is the one endpoint in recruitment that writes
 * into the employee table.
 */
export const POST = withApi<ConvertInput, Record<string, never>, Params>(
  { body: convertSchema, params: idParamSchema, rateLimit: "mutation", status: 201 },
  async ({ ctx, body, params }) => convertToEmployee(ctx, params.id, body),
);
