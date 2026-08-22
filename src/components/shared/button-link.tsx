import Link from "next/link";
import type { ComponentProps } from "react";

import { Button } from "@/components/ui/button";

/**
 * A link that looks like a button.
 *
 * Base UI's `Button` assumes it renders a real `<button>` (`nativeButton`
 * defaults to true). Handing it `render={<Link />}` produces an `<a>`, which
 * silently drops native button semantics — it warns at runtime, and the result
 * behaves incorrectly for keyboard and assistive-technology users.
 *
 * The correct pairing is `nativeButton={false}` alongside the link render, and
 * getting that wrong is easy to repeat, so it lives here once rather than at
 * ten call sites.
 */
export function ButtonLink({
  href,
  children,
  ...props
}: { href: string } & Omit<ComponentProps<typeof Button>, "render" | "nativeButton">) {
  return (
    <Button {...props} nativeButton={false} render={<Link href={href} />}>
      {children}
    </Button>
  );
}
