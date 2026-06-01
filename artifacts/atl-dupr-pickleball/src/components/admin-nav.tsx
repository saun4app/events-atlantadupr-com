import { Link, useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { useLogout, getGetMeQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Calendar, Users, Shield, LogOut, Menu, Settings, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState } from "react";

export function AdminNav() {
  const { user, isAdmin, setAuthToken } = useAuth();
  const [location] = useLocation();
  const queryClient = useQueryClient();
  const logout = useLogout();
  const [open, setOpen] = useState(false);

  const links = [
    { href: "/admin/events", label: "Manage Events", icon: Calendar, roles: ["admin", "event_organizer", "event_captain", "court_leader"] },
    { href: "/admin/members", label: "Manage Members", icon: Users, roles: ["admin"] },
    { href: "/admin/users", label: "Manage Users", icon: Shield, roles: ["admin"] },
    { href: "/admin/settings", label: "Settings", icon: Settings, roles: ["admin"] },
  ].filter(l => l.roles.includes(user?.role ?? ""));

  function handleLogout() {
    logout.mutate(undefined, {
      onSuccess: () => {
        localStorage.removeItem("authToken");
        setAuthToken(null);
        queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
      }
    });
  }

  return (
    <header className="bg-white border-b border-border sticky top-0 z-40 shadow-sm">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="flex items-center justify-between h-14">
          <div className="flex items-center gap-4">
            <Link href="/" className="flex items-center gap-2 font-bold text-primary text-sm tracking-wide uppercase">
              <span className="w-2 h-6 bg-primary rounded-sm inline-block" />
              ATL DUPR
            </Link>
            <nav className="hidden md:flex items-center gap-1">
              {links.map(l => {
                const Icon = l.icon;
                const active = location.startsWith(l.href);
                return (
                  <Link key={l.href} href={l.href}>
                    <span
                      data-testid={`nav-${l.label.toLowerCase().replace(/ /g, "-")}`}
                      className={`flex items-center gap-2 px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                        active
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground hover:text-foreground hover:bg-muted"
                      }`}
                    >
                      <Icon className="w-4 h-4" />
                      {l.label}
                    </span>
                  </Link>
                );
              })}
            </nav>
          </div>

          <div className="flex items-center gap-2">
            <span className="hidden sm:block text-xs text-muted-foreground">
              {user?.name} <span className="uppercase font-medium text-primary">({user?.role?.replace("_", " ")})</span>
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
              onClick={() => setOpen(o => !o)}
              aria-label="Toggle menu"
            >
              {open ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </Button>
          </div>
        </div>
      </div>

      {open && (
        <div className="md:hidden border-t border-border bg-white px-4 py-2 space-y-1">
          {links.map(l => {
            const Icon = l.icon;
            const active = location.startsWith(l.href);
            return (
              <Link key={l.href} href={l.href} onClick={() => setOpen(false)}>
                <span
                  data-testid={`nav-mobile-${l.label.toLowerCase().replace(/ /g, "-")}`}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded text-sm font-medium transition-colors ${
                    active
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted"
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {l.label}
                </span>
              </Link>
            );
          })}
          <div className="pt-2 pb-1 border-t border-border mt-2">
            <span className="block text-xs text-muted-foreground px-3 pb-2">
              {user?.name} <span className="uppercase font-medium text-primary">({user?.role?.replace("_", " ")})</span>
            </span>
          </div>
        </div>
      )}
    </header>
  );
}
