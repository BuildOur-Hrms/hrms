"use client";

import { ChevronDown } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { BrandMark } from "@/components/brand/logo";
import { cn } from "@/lib/utils";

import { NAV_ICONS } from "./icons";
import type { NavItem, NavSection } from "./nav";

// `startsWith` so a detail route keeps its list item highlighted, guarded
// against `/team` also matching `/teams`.
function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

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

  /**
   * Which groups the reader has opened or closed by hand.
   *
   * Absent from the map means "follow the route": the group holding the current
   * page is open, the rest are shut. That keeps a sidebar of sixty-odd links
   * readable without making anyone hunt for where they already are, and a
   * deliberate toggle still wins over the default for as long as the shell is
   * mounted.
   */
  const [toggled, setToggled] = useState<Record<string, boolean>>({});

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex items-center gap-2.5 px-2 py-1">
        <BrandMark className="size-8 shrink-0" />
        <div className="min-w-0">
          <p className="truncate text-sm leading-tight font-semibold">{companyName}</p>
          <p className="text-muted-foreground text-xs leading-tight">BuildOur AI HRMS</p>
        </div>
      </div>

      <nav className="scrollbar-warm flex-1 space-y-1 overflow-y-auto">
        {sections.map((section, index) => {
          const holdsCurrentPage = section.items.some((item) => isActive(pathname, item.href));

          // The unlabelled group — Dashboard — has no header to click, so it
          // stays a plain list rather than a drawer that can never be shut.
          if (!section.label) {
            return (
              <div key={`section-${index}`} className="space-y-1 pb-2">
                {section.items.map((item) => (
                  <NavLink
                    key={item.href}
                    item={item}
                    active={isActive(pathname, item.href)}
                    onNavigate={onNavigate}
                  />
                ))}
              </div>
            );
          }

          return (
            <NavGroup
              key={section.label}
              section={section}
              pathname={pathname}
              open={toggled[section.label] ?? holdsCurrentPage}
              holdsCurrentPage={holdsCurrentPage}
              onToggle={() =>
                setToggled((previous) => ({
                  ...previous,
                  [section.label]: !(previous[section.label] ?? holdsCurrentPage),
                }))
              }
              onNavigate={onNavigate}
            />
          );
        })}
      </nav>
    </div>
  );
}

function NavGroup({
  section,
  pathname,
  open,
  holdsCurrentPage,
  onToggle,
  onNavigate,
}: {
  section: NavSection;
  pathname: string;
  open: boolean;
  holdsCurrentPage: boolean;
  onToggle: () => void;
  onNavigate?: () => void;
}) {
  const panelId = `nav-group-${section.label.toLowerCase().replace(/\s+/g, "-")}`;

  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={panelId}
        className={cn(
          "hover:bg-sidebar-accent/50 flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-[0.6875rem] font-semibold tracking-wider uppercase transition-colors",
          holdsCurrentPage && !open ? "text-foreground" : "text-muted-foreground",
          "hover:text-foreground",
        )}
      >
        <span className="truncate">{section.label}</span>
        <ChevronDown
          aria-hidden
          className={cn(
            "size-3.5 shrink-0 transition-transform duration-200",
            open && "rotate-180",
          )}
        />
      </button>

      <div
        id={panelId}
        className={cn(
          "grid transition-[grid-template-rows] duration-200 ease-out",
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
        )}
      >
        {/* `inert` keeps the collapsed links out of the tab order; the wrapper
            has to clip because a zero-height grid row does not. */}
        <div className="overflow-hidden" inert={!open}>
          <div className="space-y-1 pt-1 pb-2">
            {section.items.map((item) => (
              <NavLink
                key={item.href}
                item={item}
                active={isActive(pathname, item.href)}
                onNavigate={onNavigate}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function NavLink({
  item,
  active,
  onNavigate,
}: {
  item: NavItem;
  active: boolean;
  onNavigate?: () => void;
}) {
  const Icon = NAV_ICONS[item.icon];

  return (
    <Link
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
      <Icon className={cn("size-4 shrink-0", active ? "text-brand" : "text-muted-foreground")} />
      {item.label}
    </Link>
  );
}
