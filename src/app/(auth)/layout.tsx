import { Building2 } from "lucide-react";

/**
 * Shell for the unauthenticated screens. Deliberately minimal: no navigation,
 * nothing that hints at what exists behind the login.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-muted/40 flex min-h-svh flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <div className="bg-primary text-primary-foreground flex size-11 items-center justify-center rounded-xl">
            <Building2 className="size-5" />
          </div>
          <div>
            <h1 className="text-lg font-semibold tracking-tight">HRMS</h1>
            <p className="text-muted-foreground text-sm">Employee lifecycle management</p>
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}
