import { Link, useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { useLogout } from "@workspace/api-client-react";
import { LogOut, Menu, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import {
  getAdminNavigationItems,
  isNavigationItemActive,
  navigationTestId,
} from "@/lib/site-nav";

export function AdminNav() {
  const { user, setAuthToken } = useAuth();
  const [location] = useLocation();
  const logout = useLogout();
  const [open, setOpen] = useState(false);

  const links = getAdminNavigationItems(
    user?.role,
    (user?.eventAssignments?.length ?? 0) > 0,
  );

  function handleLogout() {
    logout.mutate(undefined, {
      onSuccess: () => {
        setAuthToken(null);
      },
    });
  }

  return (
    <header className="bg-white border-b border-border sticky top-0 z-40 shadow-sm">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="flex items-center justify-between h-16">
          <div className="flex items-center gap-4">
            <Link href="/" className="flex items-center">
              <img
                src="/logo-transparent.png"
                alt="Atlanta DUPR Pickleball"
                className="h-12 w-auto"
              />
            </Link>
            <nav className="hidden md:flex items-center gap-1">
              {links.map((l) => {
                const active = isNavigationItemActive(l, location);
                return (
                  <Link key={l.href} href={l.href}>
                    <span
                      data-testid={navigationTestId(l)}
                      className={`flex items-center gap-2 px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                        active
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground hover:text-foreground hover:bg-muted"
                      }`}
                    >
                      <l.icon className="w-4 h-4" />
                      {l.label}
                    </span>
                  </Link>
                );
              })}
            </nav>
          </div>

          <div className="flex items-center gap-2">
            <span className="hidden sm:block text-xs text-muted-foreground">
              {user?.name}{" "}
              <span className="uppercase font-medium text-primary">
                ({user?.role?.replace("_", " ")})
              </span>
            </span>
            <Button
              data-testid="button-logout"
              variant="ghost"
              size="sm"
              onClick={handleLogout}
              className="gap-1.5 text-muted-foreground hover:text-destructive"
            >
              <LogOut className="w-4 h-4" />
              <span className="hidden sm:inline">Logout</span>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="md:hidden"
              onClick={() => setOpen((o) => !o)}
              aria-label="Toggle menu"
            >
              {open ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </Button>
          </div>
        </div>
      </div>

      {open && (
        <div className="md:hidden border-t border-border bg-white px-4 py-2 space-y-1">
          {links.map((l) => {
            const active = isNavigationItemActive(l, location);
            return (
              <Link key={l.href} href={l.href} onClick={() => setOpen(false)}>
                <span
                  data-testid={navigationTestId(l, true)}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded text-sm font-medium transition-colors ${
                    active
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted"
                  }`}
                >
                  <l.icon className="w-4 h-4" />
                  {l.label}
                </span>
              </Link>
            );
          })}
          <div className="pt-2 pb-1 border-t border-border mt-2">
            <span className="block text-xs text-muted-foreground px-3 pb-2">
              {user?.name}{" "}
              <span className="uppercase font-medium text-primary">
                ({user?.role?.replace("_", " ")})
              </span>
            </span>
          </div>
        </div>
      )}
    </header>
  );
}
