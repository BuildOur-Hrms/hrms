"use client";

/**
 * Last resort: this replaces the root layout, so it renders when the failure
 * happened before or inside the shell itself. It cannot use any of the app's
 * providers or components — by the time this runs, the tree they live in is
 * gone — so the markup and styling here are deliberately standalone.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100svh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "Inter, system-ui, -apple-system, 'Segoe UI', sans-serif",
          background: "#FCFBF9",
          color: "#171717",
        }}
      >
        <main style={{ maxWidth: 420, padding: 24, textAlign: "center" }}>
          <h1 style={{ fontSize: 20, fontWeight: 600, margin: "0 0 8px" }}>
            BuildOur AI HRMS could not start
          </h1>
          <p style={{ fontSize: 14, lineHeight: 1.6, color: "#6F6A65", margin: "0 0 20px" }}>
            Something failed before the application could load. Reloading may fix it; if not, the
            reference below identifies it in the server logs.
          </p>
          {error.digest ? (
            <p
              style={{
                fontFamily: "ui-monospace, monospace",
                fontSize: 12,
                color: "#6F6A65",
                margin: "0 0 20px",
              }}
            >
              reference {error.digest}
            </p>
          ) : null}
          <button
            onClick={reset}
            style={{
              border: 0,
              borderRadius: 8,
              padding: "9px 18px",
              fontSize: 14,
              fontWeight: 500,
              background: "#C95A12",
              color: "#fff",
              cursor: "pointer",
            }}
          >
            Reload
          </button>
        </main>
      </body>
    </html>
  );
}
