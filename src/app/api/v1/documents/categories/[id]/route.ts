import { withApi } from "@/lib/api";
import { updateCategory } from "@/modules/documents/service";
import { categorySchema, idParamSchema } from "@/modules/documents/validators";

export const runtime = "nodejs";

type Params = { id: string };

const patchSchema = categorySchema.partial().omit({ code: true });
type Body = import("zod").z.infer<typeof patchSchema>;

export const PATCH = withApi<Body, Record<string, never>, Params>(
  {
    permission: "documents.manage",
    params: idParamSchema,
    body: patchSchema,
    rateLimit: "mutation",
  },
  async ({ ctx, params, body }) => updateCategory(ctx, params.id, body),
);
