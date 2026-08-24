import { withApi } from "@/lib/api";
import { createTemplate, listTemplates } from "@/modules/checklists/service";
import {
  createTemplateSchema,
  listTemplatesSchema,
  type CreateTemplateInput,
  type ListTemplatesInput,
} from "@/modules/checklists/validators";

export const runtime = "nodejs";

/** The checklists a company has written, for arriving and for leaving. */
export const GET = withApi<Record<string, never>, ListTemplatesInput>(
  { permission: "onboarding.view_all", query: listTemplatesSchema },
  async ({ ctx, query }) => listTemplates(ctx, query),
);

export const POST = withApi<CreateTemplateInput>(
  {
    permission: "onboarding.manage",
    body: createTemplateSchema,
    rateLimit: "mutation",
    status: 201,
  },
  async ({ ctx, body }) => createTemplate(ctx, body),
);
