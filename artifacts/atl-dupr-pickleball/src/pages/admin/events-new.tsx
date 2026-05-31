import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useListEvents, useCreateEvent, getListEventsQueryKey, getGetEventsSummaryQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { AdminNav } from "@/components/admin-nav";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { format, addDays, addWeeks, addMonths } from "date-fns";
import { ChevronLeft, Calendar } from "lucide-react";
import { Link } from "wouter";

function toLocalDateTimeString(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function generateRecurrenceDates(startDate: Date, frequency: string, occurrences: number): Date[] {
  const dates: Date[] = [startDate];
  for (let i = 1; i < occurrences; i++) {
    const prev = dates[dates.length - 1];
    if (frequency === "daily") dates.push(addDays(prev, 1));
    else if (frequency === "weekly") dates.push(addWeeks(prev, 1));
    else dates.push(addMonths(prev, 1));
  }
  return dates;
}

const defaultForm = {
  name: "",
  description: "",
  startDatetime: "",
  endDatetime: "",
  locationName: "",
  locationAddress: "",
  formatType: "rotating",
  ratingTypeRequired: true,
  minParticipants: 8,
  maxParticipants: 24,
  waitlistEnabled: true,
  requireApproval: false,
  signupStartDatetime: "",
  signupEndDatetime: "",
};

export default function AdminEventNew() {
  const { isAuthenticated, isLoading } = useAuth();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) setLocation("/login");
  }, [isLoading, isAuthenticated]);

  const { data: allEvents } = useListEvents({}, { query: { queryKey: getListEventsQueryKey({}) } });

  const [form, setForm] = useState(defaultForm);
  const [cloneFrom, setCloneFrom] = useState<string>("none");
  const [recurrenceEnabled, setRecurrenceEnabled] = useState(false);
  const [recurrenceFrequency, setRecurrenceFrequency] = useState("weekly");
  const [recurrenceOccurrences, setRecurrenceOccurrences] = useState(4);

  const createEvent = useCreateEvent();

  function setField(key: string, value: any) {
    setForm(f => ({ ...f, [key]: value }));
  }

  function handleClone(eventIdStr: string) {
    setCloneFrom(eventIdStr);
    if (eventIdStr === "none" || !allEvents) return;
    const ev = allEvents.find(e => String(e.id) === eventIdStr);
    if (!ev) return;
    setForm({
      name: ev.name + " (Copy)",
      description: ev.description ?? "",
      startDatetime: "",
      endDatetime: "",
      locationName: ev.locationName,
      locationAddress: ev.locationAddress ?? "",
      formatType: ev.formatType,
      ratingTypeRequired: ev.ratingTypeRequired,
      minParticipants: ev.minParticipants,
      maxParticipants: ev.maxParticipants,
      waitlistEnabled: ev.waitlistEnabled,
      requireApproval: ev.requireApproval,
      signupStartDatetime: "",
      signupEndDatetime: "",
    });
  }

  const recurrenceDates = recurrenceEnabled && form.startDatetime
    ? generateRecurrenceDates(new Date(form.startDatetime), recurrenceFrequency, recurrenceOccurrences)
    : [];

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const payload = {
      name: form.name,
      description: form.description || null,
      startDatetime: new Date(form.startDatetime).toISOString(),
      endDatetime: new Date(form.endDatetime).toISOString(),
      locationName: form.locationName,
      locationAddress: form.locationAddress || null,
      formatType: form.formatType as "rotating" | "fixed_partner",
      ratingTypeRequired: form.ratingTypeRequired,
      minParticipants: Number(form.minParticipants),
      maxParticipants: Number(form.maxParticipants),
      waitlistEnabled: form.waitlistEnabled,
      requireApproval: form.requireApproval,
      signupStartDatetime: new Date(form.signupStartDatetime).toISOString(),
      signupEndDatetime: new Date(form.signupEndDatetime).toISOString(),
    };

    try {
      await createEvent.mutateAsync({ data: payload });
      queryClient.invalidateQueries({ queryKey: getListEventsQueryKey({}) });
      queryClient.invalidateQueries({ queryKey: getGetEventsSummaryQueryKey() });
      toast({ title: "Event created!" });
      setLocation("/admin/events");
    } catch {
      toast({ title: "Failed to create event", variant: "destructive" });
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <AdminNav />
      <main className="max-w-2xl mx-auto px-4 sm:px-6 py-6">
        <Link href="/admin/events" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4">
          <ChevronLeft className="w-4 h-4" />
          Back to Events
        </Link>
        <h1 className="text-xl font-bold text-foreground mb-6">Create New Event</h1>

        <div className="bg-card border border-card-border rounded-lg p-5 mb-4">
          <Label className="mb-1.5 block">Clone from existing event</Label>
          <Select value={cloneFrom} onValueChange={handleClone}>
            <SelectTrigger data-testid="select-clone-event">
              <SelectValue placeholder="Select event to clone..." />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">None — start fresh</SelectItem>
              {allEvents?.map(ev => (
                <SelectItem key={ev.id} value={String(ev.id)}>{ev.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="bg-card border border-card-border rounded-lg p-5 space-y-4">
            <h2 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">Event Details</h2>
            <div className="space-y-1.5">
              <Label htmlFor="name">Event Name *</Label>
              <Input
                id="name"
                data-testid="input-event-name"
                value={form.name}
                onChange={e => setField("name", e.target.value)}
                required
                placeholder="Saturday Morning Round Robin"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                data-testid="input-event-description"
                value={form.description}
                onChange={e => setField("description", e.target.value)}
                rows={3}
                placeholder="Tell participants what to expect..."
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="start">Start Date & Time *</Label>
                <Input
                  id="start"
                  data-testid="input-event-start"
                  type="datetime-local"
                  value={form.startDatetime}
                  onChange={e => setField("startDatetime", e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="end">End Date & Time *</Label>
                <Input
                  id="end"
                  data-testid="input-event-end"
                  type="datetime-local"
                  value={form.endDatetime}
                  onChange={e => setField("endDatetime", e.target.value)}
                  required
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="location-name">Location Name *</Label>
              <Input
                id="location-name"
                data-testid="input-event-location-name"
                value={form.locationName}
                onChange={e => setField("locationName", e.target.value)}
                required
                placeholder="Chastain Park Tennis Center"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="location-address">Location Address</Label>
              <Input
                id="location-address"
                data-testid="input-event-location-address"
                value={form.locationAddress}
                onChange={e => setField("locationAddress", e.target.value)}
                placeholder="4000 Damascus Dr NW, Atlanta, GA 30342"
              />
            </div>
          </div>

          <div className="bg-card border border-card-border rounded-lg p-5 space-y-4">
            <h2 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">Format & Settings</h2>
            <div className="space-y-1.5">
              <Label>Format Type *</Label>
              <Select value={form.formatType} onValueChange={v => setField("formatType", v)}>
                <SelectTrigger data-testid="select-format-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="rotating">Rotating Partners</SelectItem>
                  <SelectItem value="fixed_partner">Fixed-Partner</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="min">Min Participants</Label>
                <Input
                  id="min"
                  data-testid="input-min-participants"
                  type="number"
                  min={2}
                  value={form.minParticipants}
                  onChange={e => setField("minParticipants", e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="max">Max Participants</Label>
                <Input
                  id="max"
                  data-testid="input-max-participants"
                  type="number"
                  min={2}
                  value={form.maxParticipants}
                  onChange={e => setField("maxParticipants", e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>DUPR Rating Required</Label>
                <Switch
                  data-testid="switch-rating-required"
                  checked={form.ratingTypeRequired}
                  onCheckedChange={v => setField("ratingTypeRequired", v)}
                />
              </div>
              <div className="flex items-center justify-between">
                <Label>Enable Waitlist</Label>
                <Switch
                  data-testid="switch-waitlist"
                  checked={form.waitlistEnabled}
                  onCheckedChange={v => setField("waitlistEnabled", v)}
                />
              </div>
              <div className="flex items-center justify-between">
                <Label>Require Approval</Label>
                <Switch
                  data-testid="switch-approval"
                  checked={form.requireApproval}
                  onCheckedChange={v => setField("requireApproval", v)}
                />
              </div>
            </div>
          </div>

          <div className="bg-card border border-card-border rounded-lg p-5 space-y-4">
            <h2 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">Signup Window</h2>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="signup-start">Signup Opens *</Label>
                <Input
                  id="signup-start"
                  data-testid="input-signup-start"
                  type="datetime-local"
                  value={form.signupStartDatetime}
                  onChange={e => setField("signupStartDatetime", e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="signup-end">Signup Closes *</Label>
                <Input
                  id="signup-end"
                  data-testid="input-signup-end"
                  type="datetime-local"
                  value={form.signupEndDatetime}
                  onChange={e => setField("signupEndDatetime", e.target.value)}
                  required
                />
              </div>
            </div>
          </div>

          <div className="bg-card border border-card-border rounded-lg p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-semibold text-foreground">Repeating Event</h2>
                <p className="text-xs text-muted-foreground mt-0.5">Generate multiple instances of this event</p>
              </div>
              <Switch
                data-testid="switch-recurrence"
                checked={recurrenceEnabled}
                onCheckedChange={setRecurrenceEnabled}
              />
            </div>
            {recurrenceEnabled && (
              <>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label>Frequency</Label>
                    <Select value={recurrenceFrequency} onValueChange={setRecurrenceFrequency}>
                      <SelectTrigger data-testid="select-recurrence-frequency">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="daily">Daily</SelectItem>
                        <SelectItem value="weekly">Weekly</SelectItem>
                        <SelectItem value="monthly">Monthly</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Number of Occurrences</Label>
                    <Input
                      data-testid="input-recurrence-count"
                      type="number"
                      min={2}
                      max={52}
                      value={recurrenceOccurrences}
                      onChange={e => setRecurrenceOccurrences(Number(e.target.value))}
                    />
                  </div>
                </div>
                {recurrenceDates.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Preview Dates</p>
                    <div className="flex flex-wrap gap-2">
                      {recurrenceDates.map((d, i) => (
                        <Badge key={i} variant="outline" className="text-xs font-mono">
                          <Calendar className="w-3 h-3 mr-1" />
                          {format(d, "MMM d, yyyy")}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          <div className="flex gap-3">
            <Button type="submit" data-testid="button-submit-event" disabled={createEvent.isPending} className="flex-1">
              {createEvent.isPending ? "Creating..." : "Create Event"}
            </Button>
            <Link href="/admin/events">
              <Button type="button" variant="outline">Cancel</Button>
            </Link>
          </div>
        </form>
      </main>
    </div>
  );
}
