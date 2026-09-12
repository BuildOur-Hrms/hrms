import { BrandMark } from "@/components/brand/logo";

/**
 * Shell for the unauthenticated screens. Deliberately minimal: no navigation,
 * nothing that hints at what exists behind the login.
 *
 * "Minimal" is about what it discloses, not about how it looks. A sign-in page
 * is the only screen someone sees before they trust the thing with their
 * salary, so it gets a warm wash behind the card and lets the mark, the
 * wordmark and the form arrive in that order — the sequence reads as the page
 * composing itself rather than as three elements that happened to load.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-background relative flex min-h-svh flex-col items-center justify-center overflow-hidden px-4 py-12">
      {/*
       * Brand light from above, at a twelfth strength. Enough to keep a mostly
       * empty page from reading as an error state; far too faint to compete
       * with the one thing on it that matters.
       */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-80 bg-[radial-gradient(60%_100%_at_50%_0%,color-mix(in_oklch,var(--brand),transparent_92%),transparent)]"
      />

      <div className="motion-stagger relative w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <BrandMark className="size-11" />
          <div>
            <h1 className="text-lg font-semibold tracking-tight">
              BuildOur AI <span className="text-brand">HRMS</span>
            </h1>
            <p className="text-muted-foreground text-sm">Employee lifecycle management</p>
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}
