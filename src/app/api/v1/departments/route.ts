import { withApi } from "@/lib/api";
import { createDepartment, listDepartments } from "@/modules/org/service";
import { createDepartmentSchema, type CreateDepartmentInput } from "@/modules/org/validators";

export const runtime = "nodejs";

export const GET = withApi({}, async ({ ctx }) => listDepartments(ctx));

export const POST = withApi<CreateDepartmentInput>(
  {
    permission: "department.manage",
    body: createDepartmentSchema,
    rateLimit: "mutation",
    status: 201,
  },
  async ({ ctx, body }) => createDepartment(ctx, body),
);
