"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { BrandMark } from "@/components/brand/logo";
import { cn } from "@/lib/utils";

import { NAV_ICONS } from "./icons";
import type { NavSection } from "./nav";

export function SidebarNav({
  sections,
  companyName,
  onNavigate,
}: {
  sections: NavSection[];
  companyName: string;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex items-center gap-2.5 px-2 py-1">
        <BrandMark className="size-8 shrink-0" />
        <div className="min-w-0">
          <p className="truncate text-sm leading-tight font-semibold">{companyName}</p>
          <p className="text-muted-foreground text-xs leading-tight">BuildOur AI HRMS</p>
        </div>
      </div>

      <nav className="scrollbar-warm flex-1 space-y-5 overflow-y-auto">
        {sections.map((section, index) => (
          <div key={section.label || `section-${index}`} className="space-y-1">
            {section.label ? (
              <p className="text-muted-foreground px-3 text-[0.6875rem] font-semibold tracking-wider uppercase">
                {section.label}
              </p>
            ) : null}
            {section.items.map((item) => {
              // `startsWith` so a detail route keeps its list item highlighted,
              // guarded against `/team` also matching `/teams`.
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
              const Icon = NAV_ICONS[item.icon];
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={onNavigate}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors",
                    active
                      ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                      : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground",
                  )}
                >
                  <Icon
                    className={cn(
                      "size-4 shrink-0",
                      active ? "text-brand" : "text-muted-foreground",
                    )}
                  />
                  {item.label}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>
    </div>
  );
}
