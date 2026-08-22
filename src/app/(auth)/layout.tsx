import { BrandMark } from "@/components/brand/logo";

/**
 * Shell for the unauthenticated screens. Deliberately minimal: no navigation,
 * nothing that hints at what exists behind the login.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-background flex min-h-svh flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
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
