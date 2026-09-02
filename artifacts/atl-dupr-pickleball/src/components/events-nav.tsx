import { Link, useLocation } from "wouter";
import {
  EventType,
  getEventsNavigationItems,
  isNavigationItemActive,
} from "@/lib/site-nav";

export function EventsNav({ eventType }: { eventType: EventType }) {
  const [location] = useLocation();
  const navigationItems = getEventsNavigationItems(eventType);
  const newItem = navigationItems.find((item) => item.match.type === "exact");
  if (!newItem) {
    throw new Error("Invalid app-config/site-nav.json: events navigation has no exact new-event item");
  }

  return (
    <div className="bg-white border-b border-border">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <nav className="flex items-center gap-1 h-10">
          {navigationItems.filter((item) => item !== newItem).map((item) => {
            const active = !isNavigationItemActive(newItem, location)
              && isNavigationItemActive(item, location);
            return (
              <Link key={item.id} href={item.href}>
                <span
                  data-testid={`events-nav-${item.testId}`}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                    active
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted"
                  }`}
                >
                  <item.icon className="w-4 h-4" />
                  {item.label}
                </span>
              </Link>
            );
          })}
          <Link href={newItem.href}>
            <span
              data-testid="events-nav-new-event"
              className={`flex items-center gap-2 px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                isNavigationItemActive(newItem, location)
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted"
              }`}
            >
              <newItem.icon className="w-4 h-4" />
              {newItem.label}
            </span>
          </Link>
        </nav>
      </div>
    </div>
  );
}
