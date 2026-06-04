import { Link, useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { Calendar, Plus, SlidersHorizontal } from "lucide-react";

export function EventsNav() {
  const [location] = useLocation();
  const { user } = useAuth();

  const allowedSetupRoles = ["admin", "event_organizer", "event_captain", "court_leader"];
  const showSetup = allowedSetupRoles.includes(user?.role ?? "");

  const links = [
    { href: "/admin/events", label: "Events", icon: Calendar, exact: true },
    { href: "/admin/events/new", label: "New Event", icon: Plus, exact: false },
    ...(showSetup ? [{ href: "/admin/events/setup", label: "Event Setup", icon: SlidersHorizontal, exact: false }] : []),
  ];

  return (
    <div className="bg-white border-b border-border">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <nav className="flex items-center gap-1 h-10">
          {links.map(l => {
            const Icon = l.icon;
            const active = l.exact ? location === l.href : location.startsWith(l.href);
            return (
              <Link key={l.href} href={l.href}>
                <span
                  data-testid={`events-nav-${l.label.toLowerCase().replace(/ /g, "-")}`}
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
    </div>
  );
}
