import { visibleSections } from "@/components/app-shell/nav";
import { SidebarNav } from "@/components/app-shell/sidebar";
import { Topbar } from "@/components/app-shell/topbar";
import { requireSession } from "@/lib/page";

/**
 * The authenticated shell.
 *
 * The session is resolved once here, server-side, and the sidebar is built
 * from the caller's permission set — so a manager and an HR admin get
 * different navigation from the same code with no role checks anywhere.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  const sections = visibleSections(session.permissions);

  return (
    <div className="flex min-h-svh">
      <aside className="bg-muted/30 hidden w-64 shrink-0 border-r p-4 lg:block">
        <SidebarNav sections={sections} companyName={session.company.name} />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          sections={sections}
          companyName={session.company.name}
          email={session.email}
          firstName={session.firstName}
          lastName={session.lastName}
          roles={session.roles}
        />
        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">
          <div className="mx-auto w-full max-w-6xl">{children}</div>
        </main>
      </div>
    </div>
  );
}
