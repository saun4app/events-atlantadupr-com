import { Link } from "wouter";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";

export function PublicNav() {
  const { isAuthenticated, user } = useAuth();

  return (
    <header className="bg-primary text-primary-foreground sticky top-0 z-40 shadow-md">
      <div className="max-w-5xl mx-auto px-4 sm:px-6">
        <div className="flex items-center justify-between h-14">
          <Link href="/" className="flex items-center gap-2">
            <span className="w-2 h-6 bg-white/60 rounded-sm inline-block" />
            <span className="font-bold tracking-wide uppercase text-sm">Atlanta DUPR Pickleball</span>
          </Link>
          <div className="flex items-center gap-3">
            {isAuthenticated ? (
              <Link href="/admin/events">
                <Button
                  data-testid="link-admin"
                  size="sm"
                  variant="secondary"
                  className="text-xs font-semibold"
                >
                  Admin Panel
                </Button>
              </Link>
            ) : (
              <Link href="/login">
                <Button
                  data-testid="link-login"
                  size="sm"
                  variant="secondary"
                  className="text-xs font-semibold"
                >
                  Sign In
                </Button>
              </Link>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
