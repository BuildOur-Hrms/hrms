import { NextResponse } from "next/server";

import { withApi } from "@/lib/api";
import { confirmUpload } from "@/modules/documents/service";
import { idParamSchema } from "@/modules/documents/validators";

export const runtime = "nodejs";

type Params = { id: string };

/**
 * Finish an upload.
 *
 * Not a formality: this reads the stored object back and checks its first
 * bytes are the type that was declared. A presigned URL signs what the
 * browser said it would send, not what it actually sent.
 *
 * A rejection comes back from the service rather than being thrown, because
 * throwing would roll back the cleanup that goes with it — so the 422 is
 * built here instead, in the shape every other error uses.
 */
export const POST = withApi<Record<string, never>, Record<string, never>, Params>(
  { permission: "documents.create", params: idParamSchema, rateLimit: "mutation" },
  async ({ ctx, params }) => {
    const result = await confirmUpload(ctx, params.id);

    if (result.rejected) {
      return NextResponse.json(
        { error: { code: "BUSINESS_RULE", message: result.reason } },
        { status: 422 },
      );
    }
    return result.document;
  },
);
