import { NextResponse } from "next/server";

import { withApi } from "@/lib/api";
import { storage } from "@/lib/storage";
import { UPLOAD_POLICY } from "@/lib/storage/policy";

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
 * What replaces the signature is the session. A presigned S3 URL carries its
 * own authority and needs none; these carry none and so must be authenticated
 * like any other request. That is why both handlers sit inside `withApi`.
 *
 * The key is checked against the caller's company before anything is read or
 * written. Keys begin with the company id by construction, so this is a string
 * comparison rather than a lookup — and it is the whole reason the key is
 * built that way.
 */

function keyFor(ctx: { companyId: string }, parts: string[]): string | null {
  const key = parts.join("/");
  if (!key.startsWith(`${ctx.companyId}/`)) return null;
  // Belt and braces. Keys are server-generated and cannot contain traversal,
  // but this is where a URL segment becomes a storage key.
  if (key.includes("..")) return null;
  return key;
}

export const PUT = withApi<unknown, Record<string, never>, Params>(
  { rateLimit: "mutation" },
  async ({ ctx, params, req }) => {
    const key = keyFor(ctx, params.key);
    if (!key) return NextResponse.json({ error: "Not found" }, { status: 404 });

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
    const key = keyFor(ctx, params.key);
    if (!key) return NextResponse.json({ error: "Not found" }, { status: 404 });

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
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
  },
);
