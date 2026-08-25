import { withApi } from "@/lib/api";
import { downloadUrl } from "@/modules/documents/service";
import { idParamSchema } from "@/modules/documents/validators";

export const runtime = "nodejs";

type Params = { id: string };

/**
 * A short-lived link to the file.
 *
 * The permission check happens here and the URL lasts minutes. A link that
 * outlived its check would be a back door into the document store.
 *
 * Every one of these is written to the audit trail — who looked at somebody's
 * passport is the question that trail exists to answer.
 */
export const GET = withApi<Record<string, never>, Record<string, never>, Params>(
  { permission: "documents.view_own", params: idParamSchema },
  async ({ ctx, params }) => downloadUrl(ctx, params.id),
);
