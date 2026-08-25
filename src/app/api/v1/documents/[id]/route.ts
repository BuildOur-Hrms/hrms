import { withApi } from "@/lib/api";
import { archiveDocument, getDocument, updateDocument } from "@/modules/documents/service";
import {
  idParamSchema,
  updateDocumentSchema,
  type UpdateDocumentInput,
} from "@/modules/documents/validators";

export const runtime = "nodejs";

type Params = { id: string };

export const GET = withApi<Record<string, never>, Record<string, never>, Params>(
  { permission: "documents.view_own", params: idParamSchema },
  async ({ ctx, params }) => getDocument(ctx, params.id),
);

export const PATCH = withApi<UpdateDocumentInput, Record<string, never>, Params>(
  {
    permission: "documents.view_own",
    params: idParamSchema,
    body: updateDocumentSchema,
    rateLimit: "mutation",
  },
  async ({ ctx, params, body }) => updateDocument(ctx, params.id, body),
);

/** Archived, never deleted. The file stays where it is. */
export const DELETE = withApi<Record<string, never>, Record<string, never>, Params>(
  { permission: "documents.view_own", params: idParamSchema, rateLimit: "mutation" },
  async ({ ctx, params }) => archiveDocument(ctx, params.id),
);
