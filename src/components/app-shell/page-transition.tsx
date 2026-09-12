"use client";

import { usePathname } from "next/navigation";

/**
 * The content area, arriving.
 *
 * Keyed on the path so that React discards the old subtree and the animation
 * runs again on every navigation. Keying on anything coarser would play it
 * once per session; keying on anything finer — the full URL, say — would
 * replay it when only a query parameter moved, which is a filter being applied
 * rather than a page being reached, and re-animating there would be motion
 * that lies about what happened.
 *
 * A client component purely to read the path. The children stay server
 * components: they are passed through as a prop, not imported here, so
 * nothing below this point is pulled across the boundary.
 */
export function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div key={pathname} className="motion-rise">
      {children}
    </div>
  );
}
