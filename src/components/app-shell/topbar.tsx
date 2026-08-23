"use client";

import { ChevronDown, LogOut, Menu, Moon, Sun, UserCircle } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { useState } from "react";
import { toast } from "sonner";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { ApiError, api } from "@/lib/api-client";
import { fullName, initials } from "@/lib/utils";

import { NotificationBell } from "./notification-bell";
import type { NavSection } from "./nav";
import { SidebarNav } from "./sidebar";

export function Topbar({
  sections,
  companyName,
  email,
  firstName,
  lastName,
  roles,
}: {
  sections: NavSection[];
  companyName: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  roles: readonly string[];
}) {
  const router = useRouter();
  const { resolvedTheme, setTheme } = useTheme();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const display = firstName ? fullName(firstName, lastName) : email;

  async function signOut() {
    setSigningOut(true);
    try {
      await api.post("/auth/logout");
    } catch (error) {
      // A 401 here means the session is already gone — expired, or revoked in
      // another tab. That is the outcome sign-out was asking for, so treat it
      // as success. Failing loudly would leave somebody stuck behind a dead
      // cookie with a button that can never work.
      const alreadySignedOut = error instanceof ApiError && error.isUnauthenticated;
      if (!alreadySignedOut) {
        toast.error("Could not sign out. Try again.");
        setSigningOut(false);
        return;
      }
    }

    router.replace("/login");
    router.refresh();
  }

  return (
    <header className="bg-background/95 supports-[backdrop-filter]:bg-background/80 sticky top-0 z-30 flex h-14 items-center gap-2 border-b px-4 backdrop-blur">
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetTrigger
          render={
            <Button
              variant="ghost"
              size="icon"
              className="lg:hidden"
              aria-label="Open navigation"
            />
          }
        >
          <Menu className="size-5" />
        </SheetTrigger>
        <SheetContent side="left" className="bg-sidebar w-72 p-4">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <SidebarNav
            sections={sections}
            companyName={companyName}
            onNavigate={() => setMobileOpen(false)}
          />
        </SheetContent>
      </Sheet>

      <div className="flex-1" />

      <NotificationBell />

      <Button
        variant="ghost"
        size="icon"
        aria-label="Toggle theme"
        onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
      >
        <Sun className="size-4 dark:hidden" />
        <Moon className="hidden size-4 dark:block" />
      </Button>

      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button variant="ghost" className="gap-1.5 px-2" aria-label="Account menu" />}
        >
          <Avatar className="size-7">
            <AvatarFallback className="text-xs">
              {initials(firstName ?? email, lastName)}
            </AvatarFallback>
          </Avatar>
          {/* The name is worth the width even on a phone: an unlabelled circle
              does not read as "this is you, and sign-out lives here". */}
          <span className="max-w-24 truncate text-sm sm:max-w-40">{display}</span>
          {/* And a chevron, so it reads as a menu rather than an avatar. */}
          <ChevronDown className="text-muted-foreground size-3.5" aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60">
          <DropdownMenuLabel className="font-normal">
            <p className="truncate text-sm font-medium">{display}</p>
            <p className="text-muted-foreground truncate text-xs">{email}</p>
            {roles.length > 0 ? (
              <p className="text-muted-foreground mt-1 truncate text-xs">
                {roles.map((r) => r.replace(/_/g, " ")).join(", ")}
              </p>
            ) : null}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem nativeButton={false} render={<Link href="/me/profile" />}>
            <UserCircle className="size-4" />
            My profile
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {/* `onClick`, not `onSelect`. Base UI's MenuItem has no onSelect —
              that is Radix's API — and React quietly binds it as the DOM text
              selection handler instead, so the item renders fine and simply
              never fires. */}
          <DropdownMenuItem onClick={() => void signOut()} disabled={signingOut}>
            <LogOut className="size-4" />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}
