import { withApi } from "@/lib/api";
import { getCompany, updateCompany } from "@/modules/org/service";
import { updateCompanySchema, type UpdateCompanyInput } from "@/modules/org/validators";

export const runtime = "nodejs";

/** GET /api/v1/companies/current — any authenticated user. */
export const GET = withApi({}, async ({ ctx }) => getCompany(ctx));

/** PATCH /api/v1/companies/current */
export const PATCH = withApi<UpdateCompanyInput>(
  { permission: "company.manage", body: updateCompanySchema, rateLimit: "mutation" },
  async ({ ctx, body }) => updateCompany(ctx, body),
);
