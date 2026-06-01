import { useState } from "react";
import { Link } from "wouter";
import {
  useListEvents, useDeleteEvent, useCloseEvent,
  getListEventsQueryKey, getGetEventsSummaryQueryKey
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { AdminNav } from "@/components/admin-nav";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/lib/auth";
import { useLocation } from "wouter";
import { useEffect } from "react";
import { format } from "date-fns";
import { Plus, Search, Trash2, Lock, Eye, Calendar, MapPin } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

function statusBadge(status: string) {
  if (status === "upcoming") return <Badge className="text-xs bg-primary/10 text-primary border-primary/20 border">Upcoming</Badge>;
  if (status === "closed") return <Badge variant="secondary" className="text-xs">Closed</Badge>;
  return <Badge variant="outline" className="text-xs text-muted-foreground">Ended</Badge>;
}

export default function AdminEvents() {
  const { isAuthenticated, isLoading, user, canAccessAdmin } = useAuth();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [search, setSearch] = useState("");
  const [deleteId, setDeleteId] = useState<number | null>(null);

  useEffect(() => {
    if (!isLoading && !isAuthenticated) setLocation("/login");
    if (!isLoading && isAuthenticated && !canAccessAdmin) setLocation("/");
  }, [isLoading, isAuthenticated, canAccessAdmin]);

  const { data: events, isLoading: evLoading } = useListEvents(
    {},
    { query: { queryKey: getListEventsQueryKey({}), refetchOnMount: "always" } }
  );

  const deleteEvent = useDeleteEvent();
  const closeEvent = useCloseEvent();

  const filtered = events?.filter(e =>
    !search || e.name.toLowerCase().includes(search.toLowerCase()) || e.locationName.toLowerCase().includes(search.toLowerCase())
  ) ?? [];

  function handleDelete() {
    if (deleteId === null) return;
    deleteEvent.mutate({ id: deleteId }, {
      onSuccess: () => {
        toast({ title: "Event deleted" });
        queryClient.invalidateQueries({ queryKey: getListEventsQueryKey({}) });
        queryClient.invalidateQueries({ queryKey: getGetEventsSummaryQueryKey() });
        setDeleteId(null);
      },
      onError: () => toast({ title: "Delete failed", variant: "destructive" }),
    });
  }

  function handleClose(id: number) {
    closeEvent.mutate({ id }, {
      onSuccess: () => {
        toast({ title: "Registration closed" });
        queryClient.invalidateQueries({ queryKey: getListEventsQueryKey({}) });
      },
      onError: () => toast({ title: "Failed to close", variant: "destructive" }),
    });
  }

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
              <div key={ev.id} data-testid={`card-event-${ev.id}`} className="bg-card border border-card-border rounded-lg p-4 flex items-center gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    {statusBadge(ev.status)}
                    <span className="text-xs text-muted-foreground">
                      {ev.formatType === "fixed_partner" ? "Fixed-Partner" : "Rotating"}
                    </span>
                  </div>
                  <h3 className="font-semibold text-foreground truncate">{ev.name}</h3>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
                    <span className="flex items-center gap-1"><Calendar className="w-3 h-3" />{format(new Date(ev.startDatetime), "EEE, MMM d, yyyy 'at' h:mm a")}</span>
                    <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{ev.locationName}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Link href={`/admin/events/${ev.id}`}>
                    <Button data-testid={`button-view-event-${ev.id}`} variant="outline" size="sm" className="gap-1">
                      <Eye className="w-3.5 h-3.5" />
                      Roster
                    </Button>
                  </Link>
                  {ev.status === "upcoming" && (
                    <Button
                      data-testid={`button-close-event-${ev.id}`}
                      variant="outline"
                      size="sm"
                      className="gap-1"
                      onClick={() => handleClose(ev.id)}
                      disabled={closeEvent.isPending}
                    >
                      <Lock className="w-3.5 h-3.5" />
                      Close
                    </Button>
                  )}
                  {(user?.role === "admin") && (
                    <Button
                      data-testid={`button-delete-event-${ev.id}`}
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive hover:bg-destructive/10"
                      onClick={() => setDeleteId(ev.id)}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      <AlertDialog open={deleteId !== null} onOpenChange={open => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this event?</AlertDialogTitle>
            <AlertDialogDescription>This will permanently delete the event and all its registrations. This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
            <AlertDialogAction data-testid="button-confirm-delete" onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete Event
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
