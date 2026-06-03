import { Link } from "wouter";
import { useListEvents, useGetEventsSummary, useGetSettings, getListEventsQueryKey, getGetEventsSummaryQueryKey } from "@workspace/api-client-react";
import { PublicNav } from "@/components/public-nav";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { MapPin, Calendar, Users, Clock, WrenchIcon, DollarSign } from "lucide-react";
import { format, isPast, isFuture } from "date-fns";

function teamFormat(t: string) {
  return t === "fixed_partner" ? "Fixed-Partner" : "Rotating Partners";
}

function signupStatus(event: { signupStartDatetime: string; signupEndDatetime: string; status: string }) {
  const now = new Date();
  const start = new Date(event.signupStartDatetime);
  const end = new Date(event.signupEndDatetime);
  if (event.status === "ended" || event.status === "closed") return { label: "Registration Closed", color: "secondary" as const };
  if (isFuture(start)) return { label: `Opens ${format(start, "EEE, MMM d")}`, color: "secondary" as const };
  if (isPast(end)) return { label: "Signup Closed", color: "secondary" as const };
  return { label: "Open for Signup", color: "default" as const };
}

function EventCard({ event }: { event: any }) {
  const sig = signupStatus(event);
  return (
    <Link href={`/events/${event.id}`} data-testid={`card-event-${event.id}`}>
      <div className="bg-card border border-card-border rounded-lg p-5 hover:shadow-md transition-all cursor-pointer hover:border-primary/40 group">
        <div className="flex items-start justify-between gap-3 mb-3">
          <h2 className="font-semibold text-foreground text-base leading-snug group-hover:text-primary transition-colors">
            {event.name}
          </h2>
          <div className="flex flex-col items-end gap-1 shrink-0">
            <Badge
              variant={sig.color === "default" ? "default" : "secondary"}
              className="text-xs whitespace-nowrap"
              data-testid={`status-signup-${event.id}`}
            >
              {sig.label}
            </Badge>
            <span className="text-xs font-medium text-muted-foreground">
              {event.ratingTypeRequired === "dupr" ? "DUPR Required"
                : event.ratingTypeRequired === "self_numeric" ? "Self-Rating Required"
                : event.ratingTypeRequired === "self_skill" ? "Skill Level Required"
                : "All Levels"}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm text-muted-foreground">
          <div className="flex items-center gap-1.5">
            <Calendar className="w-3.5 h-3.5 text-primary shrink-0" />
            {format(new Date(event.startDatetime), "EEE, MMM d")}
          </div>
          <div className="flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5 text-primary shrink-0" />
            {format(new Date(event.startDatetime), "h:mm a")} – {format(new Date(event.endDatetime), "h:mm a")}
          </div>
          <div className="flex items-center gap-1.5 col-span-2">
            <MapPin className="w-3.5 h-3.5 text-primary shrink-0" />
            {event.locationName}
          </div>
          <div className="flex items-center gap-1.5">
            <Users className="w-3.5 h-3.5 text-primary shrink-0" />
            {teamFormat(event.formatType)}
          </div>
          <div className="flex items-center gap-1.5">
            <Users className="w-3.5 h-3.5 text-primary shrink-0" />
            {event.confirmedCount ?? 0} / {event.maxParticipants} players
          </div>
          <div className="flex items-center gap-1.5 col-span-2">
            <DollarSign className="w-3.5 h-3.5 text-primary shrink-0" />
            {event.courtFeeEnabled
              ? <span>Court fee: Member ${event.memberFee % 1 === 0 ? event.memberFee : event.memberFee.toFixed(2)} / Non-member ${event.nonMemberFee % 1 === 0 ? event.nonMemberFee : event.nonMemberFee.toFixed(2)}</span>
              : <span>Free</span>
            }
          </div>
        </div>
      </div>
    </Link>
  );
}

export default function Home() {
  const { data: events, isLoading } = useListEvents(
    { upcoming: true },
    { query: { queryKey: getListEventsQueryKey({ upcoming: true }) } }
  );
  const { data: summary } = useGetEventsSummary({
    query: { queryKey: getGetEventsSummaryQueryKey() }
  });
  const { data: settings } = useGetSettings();

  if (settings?.maintenanceMode) {
    return (
      <div className="min-h-screen bg-background">
        <PublicNav />
        <div className="flex flex-col items-center justify-center min-h-[70vh] px-4 text-center">
          <WrenchIcon className="w-14 h-14 text-muted-foreground/40 mb-5" />
          <h1 className="text-2xl font-bold text-foreground mb-2">Site Under Maintenance</h1>
          <p className="text-muted-foreground max-w-md">
            This site is temporarily under maintenance. Please check back soon.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <PublicNav />

      <div className="bg-primary text-primary-foreground py-10 px-4">
        <div className="max-w-5xl mx-auto">
          <h1 className="text-3xl font-bold tracking-tight mb-1">Upcoming Events</h1>
          <p className="text-primary-foreground/80 text-sm">Atlanta DUPR Pickleball — competitive round robins for serious players</p>
          {summary && (
            <div className="flex gap-6 mt-4 text-sm">
              <div>
                <span className="font-bold text-xl">{summary.totalUpcoming}</span>
                <span className="text-primary-foreground/70 ml-1">upcoming</span>
              </div>
              <div>
                <span className="font-bold text-xl">{summary.openForSignup}</span>
                <span className="text-primary-foreground/70 ml-1">open for signup</span>
              </div>
              <div>
                <span className="font-bold text-xl">{summary.totalEvents}</span>
                <span className="text-primary-foreground/70 ml-1">total</span>
              </div>
            </div>
          )}
        </div>
      </div>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
        {isLoading ? (
          <div className="space-y-4">
            {[1, 2, 3].map(i => (
              <Skeleton key={i} className="h-36 w-full rounded-lg" />
            ))}
          </div>
        ) : events && events.length > 0 ? (
          <div className="space-y-4">
            {events.map(ev => <EventCard key={ev.id} event={ev} />)}
          </div>
        ) : (
          <div className="text-center py-16 text-muted-foreground">
            <Users className="w-12 h-12 mx-auto mb-3 opacity-20" />
            <p className="font-medium">No upcoming events</p>
            <p className="text-sm mt-1">Check back soon for new events.</p>
          </div>
        )}
      </main>
    </div>
  );
}
