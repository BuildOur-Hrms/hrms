import { withApi } from "@/lib/api";
import { listDocuments, requestUpload } from "@/modules/documents/service";
import {
  listDocumentsSchema,
  requestUploadSchema,
  type ListDocumentsInput,
  type RequestUploadInput,
} from "@/modules/documents/validators";

export const runtime = "nodejs";

/**
 * Documents this caller may see.
 *
 * No permission beyond the floor, because who may see which row is a rule
 * about the row — the service applies it and returns what survives.
 */
export const GET = withApi<Record<string, never>, ListDocumentsInput>(
  { permission: "documents.view_own", query: listDocumentsSchema },
  async ({ ctx, query }) => listDocuments(ctx, query),
);

/**
 * Ask for somewhere to put a file.
 *
 * `documents.create` is held by every employee: putting a certificate in
 * their own file is the commonest upload there is. Whose file, and whether
 * the category allows it, is settled in the service.
 */
export const POST = withApi<RequestUploadInput>(
  {
    permission: "documents.create",
    body: requestUploadSchema,
    rateLimit: "mutation",
    status: 201,
  },
  async ({ ctx, body }) => requestUpload(ctx, body),
);
