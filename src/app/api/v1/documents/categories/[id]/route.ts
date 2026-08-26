import { withApi } from "@/lib/api";
import { updateCategory } from "@/modules/documents/service";
import {
  idParamSchema,
  updateCategorySchema,
  type UpdateCategoryInput,
} from "@/modules/documents/validators";

export const runtime = "nodejs";

type Params = { id: string };

export const PATCH = withApi<UpdateCategoryInput, Record<string, never>, Params>(
  {
    permission: "documents.manage",
    params: idParamSchema,
    body: updateCategorySchema,
    rateLimit: "mutation",
  },
  async ({ ctx, params, body }) => updateCategory(ctx, params.id, body),
);
