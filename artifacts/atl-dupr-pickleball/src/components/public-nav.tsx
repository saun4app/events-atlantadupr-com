import { Link } from "wouter";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";

export function PublicNav() {
  const { isAuthenticated, user } = useAuth();

  return (
    <header className="bg-primary text-primary-foreground sticky top-0 z-40 shadow-md">
      <div className="max-w-5xl mx-auto px-4 sm:px-6">
        <div className="flex items-center justify-between h-16">
          <Link href="/" className="flex items-center">
            <img src="/logo-transparent.png" alt="Atlanta DUPR Pickleball" className="h-14 w-auto" />
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
