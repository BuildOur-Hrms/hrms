import { withApi } from "@/lib/api";
import { deleteTemplate, getTemplate, updateTemplate } from "@/modules/checklists/service";
import {
  idParamSchema,
  updateTemplateSchema,
  type UpdateTemplateInput,
} from "@/modules/checklists/validators";

export const runtime = "nodejs";

type Params = { id: string };

export const GET = withApi<Record<string, never>, Record<string, never>, Params>(
  { permission: "onboarding.view_all", params: idParamSchema },
  async ({ ctx, params }) => getTemplate(ctx, params.id),
);

export const PATCH = withApi<UpdateTemplateInput, Record<string, never>, Params>(
  {
    permission: "onboarding.manage",
    params: idParamSchema,
    body: updateTemplateSchema,
    rateLimit: "mutation",
  },
  async ({ ctx, params, body }) => updateTemplate(ctx, params.id, body),
);

export const DELETE = withApi<Record<string, never>, Record<string, never>, Params>(
  { permission: "onboarding.manage", params: idParamSchema, rateLimit: "mutation" },
  async ({ ctx, params }) => deleteTemplate(ctx, params.id),
);
