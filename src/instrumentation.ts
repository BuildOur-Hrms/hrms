/**
 * Next.js calls this once per runtime at server start.
 *
 * The guard must use dot access on `process.env.NEXT_RUNTIME`: Next replaces
 * that exact expression with a literal per bundle, so the Edge build sees
 * `"edge" !== "nodejs"` and drops the import entirely. Written any other way
 * (bracket access, a local alias) the condition survives to runtime, the Edge
 * bundler follows the import, and the build fails trying to resolve
 * `child_process` for BullMQ.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { bootstrap } = await import("./lib/bootstrap");
    bootstrap();
  }
}
