import { cn } from "@/lib/utils";

/**
 * The BuildOur AI mark, inlined rather than served as an `<img>` so the tile
 * and the glyph can be recoloured from theme tokens — the sidebar wants the
 * brand orange, a monochrome context wants `currentColor`.
 */
export function BrandMark({
  className,
  variant = "brand",
}: {
  className?: string;
  variant?: "brand" | "mono";
}) {
  const tile = variant === "brand" ? "var(--brand)" : "currentColor";
  const glyph = variant === "brand" ? "var(--brand-foreground)" : "var(--background)";

  return (
    <svg
      viewBox="0 0 200 200"
      role="img"
      aria-label="BuildOur AI"
      className={cn("size-8", className)}
    >
      <rect width="200" height="200" rx="44" fill={tile} />
      <g transform="translate(34 34)" fill={glyph}>
        <rect x="60" y="0" width="12" height="12" rx="2.5" />
        <rect x="0" y="60" width="12" height="12" rx="2.5" />
        <rect x="120" y="60" width="12" height="12" rx="2.5" />
        <rect x="60" y="120" width="12" height="12" rx="2.5" />

        <rect x="12" y="12" width="24" height="12" rx="2.5" />
        <rect x="12" y="12" width="12" height="24" rx="2.5" />
        <rect x="108" y="12" width="24" height="12" rx="2.5" />
        <rect x="120" y="12" width="12" height="24" rx="2.5" />
        <rect x="108" y="120" width="24" height="12" rx="2.5" />
        <rect x="120" y="108" width="12" height="24" rx="2.5" />
        <rect x="12" y="120" width="24" height="12" rx="2.5" />
        <rect x="12" y="108" width="12" height="24" rx="2.5" />

        <rect x="49" y="49" width="22" height="10" rx="2.5" />
        <rect x="73" y="49" width="10" height="22" rx="2.5" />
        <rect x="61" y="73" width="22" height="10" rx="2.5" />
        <rect x="49" y="61" width="10" height="22" rx="2.5" />
      </g>
    </svg>
  );
}
