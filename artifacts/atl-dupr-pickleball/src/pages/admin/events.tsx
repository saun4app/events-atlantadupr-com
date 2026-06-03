import { useState } from "react";
import { Link } from "wouter";
import {
  useListEvents,
  getListEventsQueryKey,
} from "@workspace/api-client-react";
import { AdminNav } from "@/components/admin-nav";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/lib/auth";
import { useLocation } from "wouter";
import { useEffect } from "react";
import { format } from "date-fns";
import { Plus, Search, Calendar, MapPin } from "lucide-react";

function statusBadge(status: string) {
  if (status === "upcoming") return <Badge className="text-xs bg-primary/10 text-primary border-primary/20 border">Upcoming</Badge>;
  if (status === "closed") return <Badge variant="secondary" className="text-xs">Closed</Badge>;
  return <Badge variant="outline" className="text-xs text-muted-foreground">Ended</Badge>;
}

export default function AdminEvents() {
  const { isAuthenticated, isLoading, canAccessAdmin } = useAuth();
  const [, setLocation] = useLocation();

  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!isLoading && !isAuthenticated) setLocation("/login");
    if (!isLoading && isAuthenticated && !canAccessAdmin) setLocation("/");
  }, [isLoading, isAuthenticated, canAccessAdmin]);

  const { data: events, isLoading: evLoading } = useListEvents(
    {},
    { query: { queryKey: getListEventsQueryKey({}), refetchOnMount: "always" } }
  );

  const filtered = events?.filter(e =>
    !search || e.name.toLowerCase().includes(search.toLowerCase()) || e.locationName.toLowerCase().includes(search.toLowerCase())
  ) ?? [];

  return (
    <div className="min-h-screen bg-background">
      <AdminNav />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold text-foreground">Manage Events</h1>
            <p className="text-muted-foreground text-sm mt-0.5">{events?.length ?? 0} total events</p>
          </div>
          <Link href="/admin/events/new">
            <Button data-testid="button-create-event" className="gap-2">
              <Plus className="w-4 h-4" />
              New Event
            </Button>
          </Link>
        </div>

        <div className="mb-4 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            data-testid="input-search-events"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search events..."
            className="pl-9"
          />
        </div>

        {evLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map(i => <Skeleton key={i} className="h-28 w-full rounded-lg" />)}
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground">
            <Calendar className="w-10 h-10 mx-auto mb-3 opacity-20" />
            <p>No events found</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map(ev => (
              <Link key={ev.id} href={`/admin/events/${ev.id}`} className="block">
                <div
                  data-testid={`card-event-${ev.id}`}
                  className="bg-card border border-card-border rounded-lg p-4 flex flex-col sm:flex-row sm:items-center gap-3 cursor-pointer hover:border-primary/40 hover:shadow-sm transition-all"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      {statusBadge(ev.status)}
                      <span className="text-xs text-muted-foreground">
                        {ev.teamFormat === "fixed_partner" ? "Fixed-Partner" : "Rotating"}
                      </span>
                    </div>
                    <h3 className="font-semibold text-foreground truncate">{ev.name}</h3>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground mt-1">
                      <span className="flex items-center gap-1"><Calendar className="w-3 h-3" />{format(new Date(ev.startDatetime), "EEE, MMM d, yyyy 'at' h:mm a")}</span>
                      <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{ev.locationName}</span>
                    </div>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
