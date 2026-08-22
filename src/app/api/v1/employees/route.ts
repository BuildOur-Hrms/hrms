import { list, withApi } from "@/lib/api";
import { createEmployee, listEmployees } from "@/modules/employees/service";
import {
  createEmployeeSchema,
  listEmployeesSchema,
  type CreateEmployeeInput,
  type ListEmployeesInput,
} from "@/modules/employees/validators";

export const runtime = "nodejs";

/**
 * GET /api/v1/employees
 *
 * No permission is declared: the service resolves the caller's widest scope
 * (`view_all` / `view_team` / `view_own`) and filters accordingly, throwing
 * 403 if they hold none of them. Declaring one here would make a manager's
 * team list a 403 instead of a scoped result.
 */
export const GET = withApi<Record<string, never>, ListEmployeesInput>(
  { query: listEmployeesSchema },
  async ({ ctx, query }) => {
    const result = await listEmployees(ctx, query);
    return list(result.data, result.meta);
  },
);

export const POST = withApi<CreateEmployeeInput>(
  {
    permission: "employee.create",
    body: createEmployeeSchema,
    rateLimit: "mutation",
    status: 201,
  },
  async ({ ctx, body }) => createEmployee(ctx, body),
);
