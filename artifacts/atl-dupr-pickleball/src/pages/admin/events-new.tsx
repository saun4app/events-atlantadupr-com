import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import {
  useListEvents, useCreateEvent, useGetSettings,
  getListEventsQueryKey, getGetEventsSummaryQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { AdminNav } from "@/components/admin-nav";
import { RichTextEditor } from "@/components/rich-text-editor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { format, addDays, addWeeks, addMonths } from "date-fns";
import { ChevronLeft, Calendar } from "lucide-react";
import { Link } from "wouter";

interface DefaultLocation { id: string; name: string; address: string; memberFee?: number; nonMemberFee?: number; courtFeeEnabled?: boolean; }
interface RatingRequirement { key: string; label: string; }

function toLocalDateTimeString(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function toDatetimeLocalInTz(date: Date, tz: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(date);
    const get = (type: string) => parts.find(p => p.type === type)?.value ?? "00";
    const hour = get("hour") === "24" ? "00" : get("hour");
    return `${get("year")}-${get("month")}-${get("day")}T${hour}:${get("minute")}`;
  } catch {
    return toLocalDateTimeString(date);
  }
}

function signupClosesDefault(startDatetime: string): string {
  if (!startDatetime) return "";
  const startMs = new Date(startDatetime).getTime();
  return toLocalDateTimeString(new Date(startMs - 12 * 60 * 60 * 1000));
}

function generateAdditionalDates(startDate: Date, frequency: string, count: number): Date[] {
  const dates: Date[] = [];
  for (let i = 1; i <= count; i++) {
    if (frequency === "daily") dates.push(addDays(startDate, i));
    else if (frequency === "weekly") dates.push(addWeeks(startDate, i));
    else dates.push(addMonths(startDate, i));
  }
  return dates;
}

export default function AdminEventNew() {
  const { isAuthenticated, isLoading, canAccessAdmin } = useAuth();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) setLocation("/login");
    if (!isLoading && isAuthenticated && !canAccessAdmin) setLocation("/");
  }, [isLoading, isAuthenticated, canAccessAdmin]);

  const { data: allEvents } = useListEvents({}, { query: { queryKey: getListEventsQueryKey({}) } });
  const { data: settings } = useGetSettings();

  const defaultsApplied = useRef(false);
  const signupEndEdited = useRef(false);
  const descriptionEdited = useRef(false);
  const endEdited = useRef(false);

  const [form, setForm] = useState({
    formatType: "rotating" as "rotating" | "fixed_partner",
    name: "",
    description: "",
    startDatetime: "",
    endDatetime: "",
    locationName: "",
    locationAddress: "",
    ratingTypeRequired: "none" as string,
    minParticipants: 8,
    maxParticipants: 24,
    waitlistEnabled: true,
    requireApproval: false,
    signupStartDatetime: "",
    signupEndDatetime: "",
    courtFeeEnabled: false,
    memberFee: 0,
    nonMemberFee: 0,
  });

  const [cloneFrom, setCloneFrom] = useState<string>("none");
  const [descriptionGeneration, setDescriptionGeneration] = useState(0);
  const [recurrenceEnabled, setRecurrenceEnabled] = useState(false);
  const [recurrenceFrequency, setRecurrenceFrequency] = useState("weekly");
  const [recurrenceOccurrences, setRecurrenceOccurrences] = useState(4);
  const [selectedDates, setSelectedDates] = useState<Set<string>>(new Set());

  const createEvent = useCreateEvent();

  const defaultEventNames = (settings?.defaultEventNames as string[] | undefined) ?? [];
  const defaultLocations: DefaultLocation[] = (settings?.defaultLocations as DefaultLocation[] | undefined) ?? [];
  const defaultRatingRequirements: RatingRequirement[] = (settings?.defaultRatingRequirements as RatingRequirement[] | undefined) ?? [];
  const ratingOptions: RatingRequirement[] = defaultRatingRequirements.length > 0
    ? defaultRatingRequirements
    : [
        { key: "dupr", label: "DUPR Required" },
        { key: "national", label: "National Rating Required" },
        { key: "none", label: "All Levels (No Rating Required)" },
      ];

  useEffect(() => {
    if (settings && !defaultsApplied.current && cloneFrom === "none") {
      defaultsApplied.current = true;
      const tz = settings.defaultTimezone || "America/New_York";
      const nowInTz = toDatetimeLocalInTz(new Date(), tz);
      const ratingReqs = (settings.defaultRatingRequirements as RatingRequirement[] | undefined) ?? [];
      const firstRatingKey = ratingReqs.length > 0 ? ratingReqs[0].key : "none";
      setDescriptionGeneration(g => g + 1);
      setForm(f => ({
        ...f,
        minParticipants: settings.minParticipants,
        maxParticipants: settings.maxParticipants,
        description: settings.rotatingPartnersDescription || "",
        signupStartDatetime: nowInTz,
        ratingTypeRequired: firstRatingKey,
      }));
    }
  }, [settings, cloneFrom]);

  useEffect(() => {
    if (form.startDatetime && !signupEndEdited.current) {
      setForm(f => ({ ...f, signupEndDatetime: signupClosesDefault(form.startDatetime) }));
    }
  }, [form.startDatetime]);

  useEffect(() => {
    if (form.startDatetime && !endEdited.current && settings) {
      const durationHours = (settings.defaultEventDurationHours as number | undefined) ?? 2;
      const startMs = new Date(form.startDatetime).getTime();
      const endDate = new Date(startMs + durationHours * 60 * 60 * 1000);
      setForm(f => ({ ...f, endDatetime: toLocalDateTimeString(endDate) }));
    }
  }, [form.startDatetime, settings]);

  const additionalDates = recurrenceEnabled && form.startDatetime
    ? generateAdditionalDates(new Date(form.startDatetime), recurrenceFrequency, recurrenceOccurrences)
    : [];

  const additionalDatesKey = additionalDates.map(d => d.toISOString()).join("|");
  useEffect(() => {
    if (additionalDates.length > 0) {
      setSelectedDates(new Set(additionalDates.map(d => d.toISOString())));
    } else {
      setSelectedDates(new Set());
    }
  }, [additionalDatesKey]);

  function setField<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm(f => ({ ...f, [key]: value }));
  }

  function handleFormatChange(newFormat: "rotating" | "fixed_partner") {
    const oldFormat = form.formatType;
    setForm(f => {
      const next = { ...f, formatType: newFormat };
      if (settings) {
        const oldMin = oldFormat === "rotating" ? settings.minParticipants : settings.minTeams;
        const oldMax = oldFormat === "rotating" ? settings.maxParticipants : settings.maxTeams;
        const newMin = newFormat === "rotating" ? settings.minParticipants : settings.minTeams;
        const newMax = newFormat === "rotating" ? settings.maxParticipants : settings.maxTeams;
        if (f.minParticipants === oldMin) next.minParticipants = newMin;
        if (f.maxParticipants === oldMax) next.maxParticipants = newMax;
        if (!descriptionEdited.current) {
          const oldDesc = (oldFormat === "rotating"
            ? settings.rotatingPartnersDescription
            : settings.fixedPartnerDescription) || "";
          const newDesc = (newFormat === "rotating"
            ? settings.rotatingPartnersDescription
            : settings.fixedPartnerDescription) || "";
          if (f.description === oldDesc || f.description === "") {
            next.description = newDesc;
          }
        }
      }
      return next;
    });
  }

  function handleClone(eventIdStr: string) {
    setCloneFrom(eventIdStr);
    if (eventIdStr === "none" || !allEvents) {
      defaultsApplied.current = false;
      descriptionEdited.current = false;
      signupEndEdited.current = false;
      endEdited.current = false;
      setDescriptionGeneration(g => g + 1);
      setForm(f => ({ ...f, name: "", description: "" }));
      return;
    }
    const ev = allEvents.find(e => String(e.id) === eventIdStr);
    if (!ev) return;
    descriptionEdited.current = true;
    setDescriptionGeneration(g => g + 1);
    signupEndEdited.current = false;
    endEdited.current = false;
    setForm({
      formatType: ev.formatType as "rotating" | "fixed_partner",
      name: ev.name + " (Copy)",
      description: ev.description ?? "",
      startDatetime: "",
      endDatetime: "",
      locationName: ev.locationName,
      locationAddress: ev.locationAddress ?? "",
      ratingTypeRequired: ev.ratingTypeRequired,
      minParticipants: ev.minParticipants,
      maxParticipants: ev.maxParticipants,
      waitlistEnabled: ev.waitlistEnabled,
      requireApproval: ev.requireApproval,
      signupStartDatetime: "",
      signupEndDatetime: "",
      courtFeeEnabled: (ev as any).courtFeeEnabled ?? false,
      memberFee: (ev as any).memberFee ?? 0,
      nonMemberFee: (ev as any).nonMemberFee ?? 0,
    });
  }

  function handleLocationChange(val: string) {
    const matched = defaultLocations.find(l => l.name === val);
    if (matched) {
      setForm(f => ({
        ...f,
        locationName: val,
        locationAddress: matched.address,
        courtFeeEnabled: matched.courtFeeEnabled ?? false,
        memberFee: matched.memberFee ?? 0,
        nonMemberFee: matched.nonMemberFee ?? 0,
      }));
    } else {
      setForm(f => ({ ...f, locationName: val, courtFeeEnabled: false, memberFee: 0, nonMemberFee: 0 }));
    }
  }

  function toggleDate(iso: string) {
    setSelectedDates(prev => {
      const next = new Set(prev);
      if (next.has(iso)) next.delete(iso);
      else next.add(iso);
      return next;
    });
  }

  function dtDow(val: string) {
    if (!val) return null;
    try {
      const d = new Date(val);
      if (isNaN(d.getTime())) return null;
      return format(d, "EEE, MMM d, yyyy 'at' h:mm a");
    } catch {
      return null;
    }
  }

  const isFixed = form.formatType === "fixed_partner";
  const minLabel = isFixed ? "Min Teams" : "Min Participants";
  const maxLabel = isFixed ? "Max Teams" : "Max Participants";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.description) {
      toast({ title: "Description is required", variant: "destructive" });
      return;
    }
    const payload: any = {
      name: form.name,
      description: form.description || null,
      startDatetime: new Date(form.startDatetime).toISOString(),
      endDatetime: new Date(form.endDatetime).toISOString(),
      locationName: form.locationName,
      locationAddress: form.locationAddress || null,
      formatType: form.formatType,
      ratingTypeRequired: form.ratingTypeRequired,
      minParticipants: Number(form.minParticipants),
      maxParticipants: Number(form.maxParticipants),
      waitlistEnabled: form.waitlistEnabled,
      requireApproval: form.requireApproval,
      signupStartDatetime: new Date(form.signupStartDatetime).toISOString(),
      signupEndDatetime: new Date(form.signupEndDatetime).toISOString(),
      courtFeeEnabled: form.courtFeeEnabled,
      memberFee: form.memberFee,
      nonMemberFee: form.nonMemberFee,
    };

    if (recurrenceEnabled && selectedDates.size > 0) {
      payload.recurrence = { dates: [...selectedDates].sort() };
    }

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

        {/* Clone from existing */}
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

          {/* Event Details */}
          <div className="bg-card border border-card-border rounded-lg p-5 space-y-4">
            <h2 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">Event Details</h2>

            {/* Format Type — first */}
            <div className="space-y-1.5">
              <Label>Format Type *</Label>
              <Select value={form.formatType} onValueChange={v => handleFormatChange(v as "rotating" | "fixed_partner")}>
                <SelectTrigger data-testid="select-format-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="rotating">Rotating Partners</SelectItem>
                  <SelectItem value="fixed_partner">Fixed-Partner</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Event Name — combobox via datalist */}
            <div className="space-y-1.5">
              <Label htmlFor="name">Event Name *</Label>
              <div className="relative">
                <Input
                  id="name"
                  list="default-event-names-list"
                  data-testid="input-event-name"
                  value={form.name}
                  onChange={e => setField("name", e.target.value)}
                  required
                  placeholder="Saturday Morning Round Robin"
                  autoComplete="off"
                />
                <datalist id="default-event-names-list">
                  {defaultEventNames.map((n, i) => (
                    <option key={i} value={n} />
                  ))}
                </datalist>
              </div>
            </div>

            {/* Description — RichTextEditor, pre-fills from settings */}
            <div className="space-y-1.5">
              <Label>Description *</Label>
              <RichTextEditor
                key={`${form.formatType}-${descriptionGeneration}`}
                data-testid="input-event-description"
                value={form.description}
                onChange={v => {
                  descriptionEdited.current = true;
                  setField("description", v);
                }}
                placeholder="Tell participants what to expect..."
              />
            </div>

            {/* Start / End */}
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
                {dtDow(form.startDatetime) && (
                  <p className="text-xs text-muted-foreground">{dtDow(form.startDatetime)}</p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="end">
                  End Date & Time *
                  {!endEdited.current && settings?.defaultEventDurationHours && (
                    <span className="ml-1.5 text-xs font-normal text-muted-foreground">(auto: {settings.defaultEventDurationHours}h after start)</span>
                  )}
                </Label>
                <Input
                  id="end"
                  data-testid="input-event-end"
                  type="datetime-local"
                  value={form.endDatetime}
                  onChange={e => {
                    endEdited.current = true;
                    setField("endDatetime", e.target.value);
                  }}
                  required
                />
                {dtDow(form.endDatetime) && (
                  <p className="text-xs text-muted-foreground">{dtDow(form.endDatetime)}</p>
                )}
              </div>
            </div>

            {/* Location — combobox via datalist, auto-fills address */}
            <div className="space-y-1.5">
              <Label htmlFor="location-name">Location Name *</Label>
              <div className="relative">
                <Input
                  id="location-name"
                  list="default-locations-list"
                  data-testid="input-event-location-name"
                  value={form.locationName}
                  onChange={e => handleLocationChange(e.target.value)}
                  required
                  placeholder="Chastain Park Tennis Center"
                  autoComplete="off"
                />
                <datalist id="default-locations-list">
                  {defaultLocations.map(loc => (
                    <option key={loc.id} value={loc.name} />
                  ))}
                </datalist>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="location-address">Location Address *</Label>
              <Input
                id="location-address"
                data-testid="input-event-location-address"
                value={form.locationAddress}
                onChange={e => setField("locationAddress", e.target.value)}
                required
                placeholder="4000 Damascus Dr NW, Atlanta, GA 30342"
              />
            </div>
          </div>

          {/* Format & Settings */}
          <div className="bg-card border border-card-border rounded-lg p-5 space-y-4">
            <h2 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">Format & Settings</h2>

            {/* Min/Max — labels change by format type */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="min">{minLabel} *</Label>
                <Input
                  id="min"
                  data-testid="input-min-participants"
                  type="number"
                  min={1}
                  required
                  value={form.minParticipants}
                  onChange={e => setField("minParticipants", Number(e.target.value))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="max">{maxLabel} *</Label>
                <Input
                  id="max"
                  data-testid="input-max-participants"
                  type="number"
                  min={1}
                  required
                  value={form.maxParticipants}
                  onChange={e => setField("maxParticipants", Number(e.target.value))}
                />
              </div>
            </div>

            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>Rating Requirement</Label>
                <Select value={form.ratingTypeRequired} onValueChange={v => setField("ratingTypeRequired", v)}>
                  <SelectTrigger data-testid="select-rating-required">
                    <SelectValue placeholder="Select requirement..." />
                  </SelectTrigger>
                  <SelectContent>
                    {ratingOptions.map(opt => (
                      <SelectItem key={opt.key} value={opt.key}>{opt.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
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

          {/* Court Fees */}
          <div className="bg-card border border-card-border rounded-lg p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">Court Fees</h2>
                <p className="text-xs text-muted-foreground mt-0.5">Optionally collect a court fee for this event.</p>
              </div>
              <Switch
                data-testid="switch-court-fee-enabled"
                checked={form.courtFeeEnabled}
                onCheckedChange={v => setField("courtFeeEnabled", v)}
              />
            </div>
            {form.courtFeeEnabled && (
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="member-fee">Member Fee ($)</Label>
                  <Input
                    id="member-fee"
                    data-testid="input-member-fee"
                    type="number"
                    min={0}
                    step={0.01}
                    value={form.memberFee}
                    onChange={e => setField("memberFee", Number(e.target.value))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="non-member-fee">Non-Member Fee ($)</Label>
                  <Input
                    id="non-member-fee"
                    data-testid="input-non-member-fee"
                    type="number"
                    min={0}
                    step={0.01}
                    value={form.nonMemberFee}
                    onChange={e => setField("nonMemberFee", Number(e.target.value))}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Signup Window */}
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
                {dtDow(form.signupStartDatetime) && (
                  <p className="text-xs text-muted-foreground">{dtDow(form.signupStartDatetime)}</p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="signup-end">
                  Signup Closes *
                  <span className="ml-1.5 text-xs font-normal text-muted-foreground">(auto: 12h before start)</span>
                </Label>
                <Input
                  id="signup-end"
                  data-testid="input-signup-end"
                  type="datetime-local"
                  value={form.signupEndDatetime}
                  onChange={e => {
                    signupEndEdited.current = true;
                    setField("signupEndDatetime", e.target.value);
                  }}
                  required
                />
                {dtDow(form.signupEndDatetime) && (
                  <p className="text-xs text-muted-foreground">{dtDow(form.signupEndDatetime)}</p>
                )}
              </div>
            </div>
          </div>

          {/* Repeating Event */}
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
                      min={1}
                      max={52}
                      value={recurrenceOccurrences}
                      onChange={e => setRecurrenceOccurrences(Math.max(1, Number(e.target.value)))}
                    />
                  </div>
                </div>

                {additionalDates.length > 0 && (
                  <div className="space-y-2">
                    <div>
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Additional Occurrences</p>
                      <p className="text-xs text-muted-foreground mt-0.5">Uncheck dates to exclude them from the series.</p>
                    </div>
                    <div className="rounded-md border border-border divide-y divide-border overflow-hidden">
                      {additionalDates.map((d, i) => {
                        const iso = d.toISOString();
                        const checked = selectedDates.has(iso);
                        return (
                          <label
                            key={i}
                            className="flex items-center gap-3 px-4 py-2.5 bg-background hover:bg-muted/30 cursor-pointer transition-colors"
                            data-testid={`recurrence-date-${i}`}
                          >
                            <Checkbox
                              checked={checked}
                              onCheckedChange={() => toggleDate(iso)}
                              data-testid={`recurrence-checkbox-${i}`}
                            />
                            <Calendar className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                            <span className="text-sm font-mono">{format(d, "EEE, MMM d, yyyy 'at' h:mm a")}</span>
                          </label>
                        );
                      })}
                    </div>
                    {selectedDates.size === 0 && (
                      <p className="text-xs text-amber-600">No additional dates selected — only the main event will be created.</p>
                    )}
                  </div>
                )}

                {recurrenceEnabled && !form.startDatetime && (
                  <p className="text-xs text-muted-foreground">Set a start date above to see recurrence dates.</p>
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
