import { Link, useLocation } from "wouter";
import { Calendar, Plus } from "lucide-react";

type EventType = "rotating" | "fixed_partner";

export function EventsNav({ eventType }: { eventType: EventType }) {
  const [location] = useLocation();

  const formatTabs: { value: EventType; label: string }[] = [
    { value: "rotating", label: "Rotating Partners" },
    { value: "fixed_partner", label: "Fixed-Partner" },
  ];

  const newHref = `/admin/events/${eventType}/new`;
  const newActive = location === newHref;

  return (
    <div className="bg-white border-b border-border">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <nav className="flex items-center gap-1 h-10">
          {formatTabs.map(t => {
            const href = `/admin/events/${t.value}`;
            const active = !newActive && eventType === t.value;
            return (
              <Link key={t.value} href={href}>
                <span
                  data-testid={`events-nav-${t.value}`}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                    active
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted"
                  }`}
                >
                  <Calendar className="w-4 h-4" />
                  {t.label}
                </span>
              </Link>
            );
          })}
          <Link href={newHref}>
            <span
              data-testid="events-nav-new-event"
              className={`flex items-center gap-2 px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                newActive
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted"
              }`}
            >
              <Plus className="w-4 h-4" />
              New Event
            </span>
          </Link>
        </nav>
      </div>
    </div>
  );
}
