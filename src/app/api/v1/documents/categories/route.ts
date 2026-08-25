import { withApi } from "@/lib/api";
import { createCategory, listCategories } from "@/modules/documents/service";
import { categorySchema, type CategoryInput } from "@/modules/documents/validators";

export const runtime = "nodejs";

/**
 * The kinds of document a company keeps.
 *
 * `documents.view_own` is the floor: somebody uploading their own certificate
 * has to know which categories exist before they can pick one.
 */
export const GET = withApi({ permission: "documents.view_own" }, async ({ ctx }) =>
  listCategories(ctx),
);

export const POST = withApi<CategoryInput>(
  { permission: "documents.manage", body: categorySchema, rateLimit: "mutation", status: 201 },
  async ({ ctx, body }) => createCategory(ctx, body),
);
