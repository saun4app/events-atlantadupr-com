import { useState } from "react";
import { Link } from "wouter";
import { useListEvents, useGetEventsSummary, useGetSettings, getListEventsQueryKey, getGetEventsSummaryQueryKey } from "@workspace/api-client-react";
import { PublicNav } from "@/components/public-nav";
import { Skeleton } from "@/components/ui/skeleton";
import { MapPin, Calendar, Users, Clock, WrenchIcon, DollarSign } from "lucide-react";
import { format } from "date-fns";

type EventType = "rotating" | "fixed_partner";

function teamFormat(t: string) {
  return t === "fixed_partner" ? "Fixed-Partner" : "Rotating Partners";
}

function EventCard({ event }: { event: any }) {
  return (
    <Link href={`/events/${event.teamFormat}/${event.id}`} data-testid={`card-event-${event.id}`}>
      <div className="bg-card border border-card-border rounded-lg p-5 hover:shadow-md transition-all cursor-pointer hover:border-primary/40 group">
        <div className="flex items-start justify-between gap-3 mb-3">
          <h2 className="font-semibold text-foreground text-base leading-snug group-hover:text-primary transition-colors">
            {event.name}
          </h2>
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
            <span className={
              event.locationName?.toLowerCase().includes("dill dinkers") ? "text-orange-500 font-medium" :
              event.locationName?.toLowerCase().includes("pickleball kingdom") ? "text-blue-500 font-medium" :
              event.locationName?.toLowerCase().includes("ace") ? "text-[#ed0973] font-medium" :
              event.locationName?.toLowerCase().includes("nickajack") ? "text-green-600 font-medium" :
              ""
            }>{event.locationName}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Users className="w-3.5 h-3.5 text-primary shrink-0" />
            {teamFormat(event.teamFormat)}
          </div>
          <div className="flex items-center gap-1.5">
            <Users className="w-3.5 h-3.5 text-primary shrink-0" />
            {event.teamFormat === "fixed_partner"
              ? `${event.confirmedTeams ?? 0} / ${event.maxTeams ?? 0} teams`
              : `${event.confirmedCount ?? 0} / ${event.maxParticipants} players`}
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

function isUpcoming(e: any): boolean {
  if (e.status === "ended" || e.status === "cancelled") return false;
  if (!e.endDatetime) return true;
  return new Date(e.endDatetime).getTime() >= Date.now();
}

export default function Home() {
  const [tab, setTab] = useState<EventType>("rotating");

  const { data: rotatingEvents, isLoading: rotLoading } = useListEvents("rotating", {
    query: { queryKey: getListEventsQueryKey("rotating") }
  });
  const { data: fixedEvents, isLoading: fixedLoading } = useListEvents("fixed_partner", {
    query: { queryKey: getListEventsQueryKey("fixed_partner") }
  });
  const { data: summary } = useGetEventsSummary({
    query: { queryKey: getGetEventsSummaryQueryKey() }
  });
  const { data: settings } = useGetSettings();

  const isLoading = tab === "rotating" ? rotLoading : fixedLoading;
  const events = ((tab === "rotating" ? rotatingEvents : fixedEvents) ?? []).filter(isUpcoming);

  const formatTabs: { value: EventType; label: string }[] = [
    { value: "rotating", label: "Rotating Partners" },
    { value: "fixed_partner", label: "Fixed-Partner" },
  ];

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

      <div className="bg-white py-10 px-4 border-b border-border">
        <div className="max-w-5xl mx-auto">
          <h1 className="text-3xl font-bold tracking-tight mb-1 text-foreground">{settings?.homeTitle || "Upcoming Events"}</h1>
          <p className="text-muted-foreground text-sm">{settings?.homeSubtitle || "Atlanta DUPR Pickleball — competitive round robins for serious players"}</p>
        </div>
      </div>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
        <div className="flex items-center gap-1 mb-6 border-b border-border">
          {formatTabs.map(t => {
            const active = tab === t.value;
            return (
              <button
                key={t.value}
                type="button"
                data-testid={`tab-${t.value}`}
                onClick={() => setTab(t.value)}
                className={`px-4 py-2 -mb-px text-sm font-medium border-b-2 transition-colors ${
                  active
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                {t.label}
              </button>
            );
          })}
        </div>
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
