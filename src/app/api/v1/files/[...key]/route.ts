import { NextResponse } from "next/server";

import { withApi } from "@/lib/api";
import { env } from "@/lib/env";
import { storage } from "@/lib/storage";
import { UPLOAD_POLICY } from "@/lib/storage/policy";
import { canRead, type Viewer } from "@/modules/documents/rules";
import { resolveScope } from "@/lib/permissions";
import type { RequestContext } from "@/lib/context";

export const runtime = "nodejs";

type Params = { key: string[] };

/**
 * The local storage driver's endpoint.
 *
 * With `STORAGE_PROVIDER=local` there is no bucket to sign against, so the
 * driver hands out URLs pointing back here and this route stands in for one.
 * It exists so an upload flow can be built and exercised before anybody has
 * provisioned storage — the same bargain `EMAIL_PROVIDER=console` makes.
 *
 * Two things replace the signature, and it took an unpleasant reading of this
 * file to see that one of them was missing.
 *
 * The first is the driver check below. Next mounts a route file whatever the
 * configuration says, and both handlers reach for the `storage` singleton —
 * which is the *S3* driver in production. Without the guard this was a
 * session-authenticated read/write channel into the real bucket, so it is the
 * first thing either handler does.
 *
 * The second is the document itself. A company-prefix comparison says the key
 * belongs to this tenant; it does not say the caller may read what is at the
 * other end of it, and keys are handed to the browser in upload and download
 * URLs. So every request resolves the key to its row and asks the same
 * question the service asks — `canRead` for a fetch, "still pending and still
 * yours" for a store. A key that names no row is refused, which fails closed
 * for any upload category wired up after this was written.
 */

function keyFor(ctx: { companyId: string }, parts: string[]): string | null {
  const key = parts.join("/");
  if (!key.startsWith(`${ctx.companyId}/`)) return null;
  // Belt and braces. Keys are server-generated and cannot contain traversal,
  // but this is where a URL segment becomes a storage key.
  if (key.includes("..")) return null;
  return key;
}

/** This route speaks for the local driver only. Anything else is not here. */
function wrongDriver(): boolean {
  return env.STORAGE_PROVIDER !== "local";
}

const notFound = () => NextResponse.json({ error: "Not found" }, { status: 404 });

function viewerOf(ctx: RequestContext): Viewer {
  const scope = resolveScope(ctx, "documents");
  return { employeeId: ctx.employeeId, scope, canManage: scope === "all" };
}

export const PUT = withApi<unknown, Record<string, never>, Params>(
  { rateLimit: "mutation" },
  async ({ ctx, params, req }) => {
    if (wrongDriver()) return notFound();

    const key = keyFor(ctx, params.key);
    if (!key) return notFound();

    /*
     * Only into a document that is still waiting for its bytes.
     *
     * `confirmUpload` reads the stored object and checks its first bytes are
     * the type that was declared. If this endpoint kept accepting writes
     * afterwards, that check would cover only whatever happened to be there
     * at the moment it ran — and HR's later "verified" stamp would be
     * attesting to bytes that had since been swapped.
     */
    const document = await ctx.db.document.findFirst({
      where: { fileKey: key },
      select: { id: true, status: true, uploadedBy: true },
    });
    if (!document || document.status !== "pending") return notFound();
    if (document.uploadedBy !== ctx.userId && resolveScope(ctx, "documents") !== "all") {
      return notFound();
    }

    const contentType = req.headers.get("content-type") ?? "application/octet-stream";
    const body = Buffer.from(await req.arrayBuffer());

    // The same ceiling the presign would have signed in. Locally nothing else
    // enforces it, and an upload path with no limit is one worth having in
    // development precisely so the limit gets exercised.
    if (body.byteLength > UPLOAD_POLICY.document.maxBytes) {
      return NextResponse.json({ error: "Too large" }, { status: 413 });
    }

    await storage.put(key, body, contentType);
    return NextResponse.json({ ok: true });
  },
);

export const GET = withApi<Record<string, never>, Record<string, never>, Params>(
  {},
  async ({ ctx, params }) => {
    if (wrongDriver()) return notFound();

    const key = keyFor(ctx, params.key);
    if (!key) return notFound();

    const document = await ctx.db.document.findFirst({
      where: { fileKey: key },
      select: {
        id: true,
        name: true,
        contentType: true,
        employeeId: true,
        status: true,
        category: { select: { managerVisible: true } },
        employee: { select: { managerId: true } },
      },
    });
    if (!document) return notFound();

    const allowed = canRead(viewerOf(ctx), {
      employeeId: document.employeeId,
      ownerManagerId: document.employee?.managerId ?? null,
      categoryManagerVisible: document.category.managerVisible,
      status: document.status as "pending" | "active" | "expired" | "archived",
    });
    if (!allowed) return notFound();

    try {
      const body = await storage.get(key);
      return new NextResponse(new Uint8Array(body), {
        headers: {
          "Content-Type": "application/octet-stream",
          // Never rendered inline: whatever is in there, the browser should
          // save it rather than run it in the app's own origin.
          "Content-Disposition": "attachment",
          "Cache-Control": "no-store, max-age=0",
        },
      });
    } catch {
      return notFound();
    }
  },
);
