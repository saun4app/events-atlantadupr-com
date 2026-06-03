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
import { NumericInput } from "@/components/numeric-input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { format, addDays, addWeeks, addMonths } from "date-fns";
import { ChevronLeft, Calendar, ChevronDown } from "lucide-react";
import { Link } from "wouter";

interface DefaultLocation { id: string; name: string; address: string; memberFee?: number; nonMemberFee?: number; courtFeeEnabled?: boolean; }
interface SkillLevel { text: string; level: number; }
interface DuprRatingConfig { enabled: boolean; minAllowed: number; maxAllowed: number; defaultMin: number; defaultMax: number; defaultNrAllowed: boolean; }
interface SelfNumericConfig { enabled: boolean; minAllowed: number; maxAllowed: number; defaultMin: number; defaultMax: number; }
interface SelfSkillConfig { enabled: boolean; levels: SkillLevel[]; defaultMinLevel: number; defaultMaxLevel: number; }
interface RatingRequirementsConfig { dupr: DuprRatingConfig; selfNumeric: SelfNumericConfig; selfSkill: SelfSkillConfig; }

const DEFAULT_RRC: RatingRequirementsConfig = {
  dupr: { enabled: true, minAllowed: 2.0, maxAllowed: 8.0, defaultMin: 2.0, defaultMax: 4.0, defaultNrAllowed: false },
  selfNumeric: { enabled: true, minAllowed: 2.0, maxAllowed: 6.0, defaultMin: 2.0, defaultMax: 4.0 },
  selfSkill: { enabled: true, levels: [], defaultMinLevel: 1, defaultMaxLevel: 3 },
};

function toLocalDateTimeString(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function toDatetimeLocalInTz(date: Date, tz: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hour12: false,
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

function getRrc(settings: any): RatingRequirementsConfig {
  const rrc = (settings as any)?.ratingRequirementsConfig ?? DEFAULT_RRC;
  return {
    dupr: { ...DEFAULT_RRC.dupr, ...(rrc.dupr ?? {}) },
    selfNumeric: { ...DEFAULT_RRC.selfNumeric, ...(rrc.selfNumeric ?? {}) },
    selfSkill: { ...DEFAULT_RRC.selfSkill, ...(rrc.selfSkill ?? {}) },
  };
}

function getDefaultRatingType(rrc: RatingRequirementsConfig): string {
  if (rrc.dupr.enabled) return "dupr";
  if (rrc.selfNumeric.enabled) return "self_numeric";
  if (rrc.selfSkill.enabled) return "self_skill";
  return "none";
}

function getDefaultRatingConfig(type: string, rrc: RatingRequirementsConfig): any {
  if (type === "dupr") return { min: rrc.dupr.defaultMin, max: rrc.dupr.defaultMax, nrAllowed: rrc.dupr.defaultNrAllowed };
  if (type === "self_numeric") return { min: rrc.selfNumeric.defaultMin, max: rrc.selfNumeric.defaultMax };
  if (type === "self_skill") return { minLevel: rrc.selfSkill.defaultMinLevel, maxLevel: rrc.selfSkill.defaultMaxLevel };
  return null;
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
    teamFormat: "rotating" as "rotating" | "fixed_partner",
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
    requireApproval: "none" as "none" | "all" | "nr_only",
    signupStartDatetime: "",
    signupEndDatetime: "",
    courtFeeEnabled: false,
    memberFee: 0,
    nonMemberFee: 0,
    contactEmail: "",
  });

  const [ratingConfig, setRatingConfig] = useState<any>(null);
  const [cloneFrom, setCloneFrom] = useState<string>("none");
  const [descriptionGeneration, setDescriptionGeneration] = useState(0);
  const [nameOpen, setNameOpen] = useState(false);
  const [recurrenceEnabled, setRecurrenceEnabled] = useState(false);
  const [recurrenceFrequency, setRecurrenceFrequency] = useState("weekly");
  const [recurrenceOccurrences, setRecurrenceOccurrences] = useState(4);
  const [selectedDates, setSelectedDates] = useState<Set<string>>(new Set());

  const createEvent = useCreateEvent();

  const defaultEventNames = (settings?.defaultEventNames as string[] | undefined) ?? [];
  const defaultLocations: DefaultLocation[] = (settings?.defaultLocations as DefaultLocation[] | undefined) ?? [];
  const eventContactEmails: string[] = (settings as any)?.eventContactEmails ?? [];
  const rrc = getRrc(settings);
  const enabledRatingTypes = [
    { key: "none", label: "No Rating Required" },
    ...(rrc.dupr.enabled ? [{ key: "dupr", label: "DUPR Rating" }] : []),
    ...(rrc.selfNumeric.enabled ? [{ key: "self_numeric", label: "Self-Rating (Numeric)" }] : []),
    ...(rrc.selfSkill.enabled ? [{ key: "self_skill", label: "Self-Rating (Skill Level)" }] : []),
  ];

  useEffect(() => {
    if (settings && !defaultsApplied.current && cloneFrom === "none") {
      defaultsApplied.current = true;
      const tz = settings.defaultTimezone || "America/New_York";
      const nowInTz = toDatetimeLocalInTz(new Date(), tz);
      const rrc = getRrc(settings);
      const defaultType = getDefaultRatingType(rrc);
      setDescriptionGeneration(g => g + 1);
      setForm(f => ({
        ...f,
        minParticipants: settings.minParticipants,
        maxParticipants: settings.maxParticipants,
        description: settings.rotatingPartnersDescription || "",
        signupStartDatetime: nowInTz,
        ratingTypeRequired: defaultType,
      }));
      setRatingConfig(getDefaultRatingConfig(defaultType, rrc));
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

  function handleRatingTypeChange(type: string) {
    setField("ratingTypeRequired", type);
    const rrc = getRrc(settings);
    setRatingConfig(getDefaultRatingConfig(type, rrc));
  }

  function handleFormatChange(newFormat: "rotating" | "fixed_partner") {
    const oldFormat = form.teamFormat;
    setForm(f => {
      const next = { ...f, teamFormat: newFormat };
      if (settings) {
        const oldMin = oldFormat === "rotating" ? settings.minParticipants : settings.minTeams;
        const oldMax = oldFormat === "rotating" ? settings.maxParticipants : settings.maxTeams;
        const newMin = newFormat === "rotating" ? settings.minParticipants : settings.minTeams;
        const newMax = newFormat === "rotating" ? settings.maxParticipants : settings.maxTeams;
        if (f.minParticipants === oldMin) next.minParticipants = newMin;
        if (f.maxParticipants === oldMax) next.maxParticipants = newMax;
        if (!descriptionEdited.current) {
          const oldDesc = (oldFormat === "rotating" ? settings.rotatingPartnersDescription : settings.fixedPartnerDescription) || "";
          const newDesc = (newFormat === "rotating" ? settings.rotatingPartnersDescription : settings.fixedPartnerDescription) || "";
          if (f.description === oldDesc || f.description === "") next.description = newDesc;
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
      teamFormat: ev.teamFormat as "rotating" | "fixed_partner",
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
      requireApproval: (ev.requireApproval as any) || "none",
      signupStartDatetime: "",
      signupEndDatetime: "",
      courtFeeEnabled: (ev as any).courtFeeEnabled ?? false,
      memberFee: (ev as any).memberFee ?? 0,
      nonMemberFee: (ev as any).nonMemberFee ?? 0,
      contactEmail: (ev as any).contactEmail ?? "",
    });
    setRatingConfig((ev as any).ratingConfig ?? getDefaultRatingConfig(ev.ratingTypeRequired, getRrc(settings)));
  }

  function handleLocationChange(val: string) {
    const matched = defaultLocations.find(l => l.name === val);
    if (matched) {
      setForm(f => ({ ...f, locationName: val, locationAddress: matched.address, courtFeeEnabled: matched.courtFeeEnabled ?? false, memberFee: matched.memberFee ?? 0, nonMemberFee: matched.nonMemberFee ?? 0 }));
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
    } catch { return null; }
  }

  const isFixed = form.teamFormat === "fixed_partner";
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
      teamFormat: form.teamFormat,
      ratingTypeRequired: form.ratingTypeRequired,
      ratingConfig: form.ratingTypeRequired !== "none" ? ratingConfig : null,
      minParticipants: Number(form.minParticipants),
      maxParticipants: Number(form.maxParticipants),
      waitlistEnabled: form.waitlistEnabled,
      requireApproval: form.requireApproval,
      signupStartDatetime: new Date(form.signupStartDatetime).toISOString(),
      signupEndDatetime: new Date(form.signupEndDatetime).toISOString(),
      courtFeeEnabled: form.courtFeeEnabled,
      memberFee: form.memberFee,
      nonMemberFee: form.nonMemberFee,
      contactEmail: form.contactEmail || null,
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
            <SelectTrigger data-testid="select-clone-event"><SelectValue placeholder="Select event to clone..." /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">None — start fresh</SelectItem>
              {allEvents?.map(ev => <SelectItem key={ev.id} value={String(ev.id)}>{ev.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">

          {/* Event Details */}
          <div className="bg-card border border-card-border rounded-lg p-5 space-y-4">
            <h2 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">Event Details</h2>

            {/* Team Format */}
            <div className="space-y-1.5">
              <Label>Team Format *</Label>
              <Select value={form.teamFormat} onValueChange={v => handleFormatChange(v as "rotating" | "fixed_partner")}>
                <SelectTrigger data-testid="select-format-type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="rotating">Rotating Partners</SelectItem>
                  <SelectItem value="fixed_partner">Fixed-Partner</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Event Name combobox */}
            <div className="space-y-1.5">
              <Label htmlFor="name">Event Name *</Label>
              <div className="relative">
                <Input
                  id="name" data-testid="input-event-name" value={form.name}
                  onChange={e => { setField("name", e.target.value); setNameOpen(true); }}
                  onFocus={() => setNameOpen(true)}
                  onBlur={() => setTimeout(() => setNameOpen(false), 150)}
                  required placeholder="Saturday Morning Round Robin" autoComplete="off"
                  className={defaultEventNames.length > 0 ? "pr-8" : ""}
                />
                {defaultEventNames.length > 0 && (
                  <button type="button" tabIndex={-1} onMouseDown={e => { e.preventDefault(); setNameOpen(o => !o); }} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                    <ChevronDown className="w-4 h-4" />
                  </button>
                )}
                {nameOpen && (() => {
                  const filtered = defaultEventNames.filter(n => !form.name || n.toLowerCase().includes(form.name.toLowerCase()));
                  return filtered.length > 0 ? (
                    <div className="absolute z-50 w-full mt-1 bg-popover border border-border rounded-md shadow-md overflow-hidden">
                      <div className="max-h-52 overflow-y-auto py-1">
                        {filtered.map((name, i) => (
                          <button key={i} type="button" onMouseDown={e => { e.preventDefault(); setField("name", name); setNameOpen(false); }} className="w-full text-left px-3 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground">
                            {name}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null;
                })()}
              </div>
            </div>

            {/* Description */}
            <div className="space-y-1.5">
              <Label>Description *</Label>
              <RichTextEditor
                key={`${form.teamFormat}-${descriptionGeneration}`}
                data-testid="input-event-description" value={form.description}
                onChange={v => { descriptionEdited.current = true; setField("description", v); }}
                placeholder="Tell participants what to expect..."
              />
            </div>

            {/* Start / End */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="start">Start Date & Time *</Label>
                <Input id="start" data-testid="input-event-start" type="datetime-local" value={form.startDatetime} onChange={e => setField("startDatetime", e.target.value)} required />
                {dtDow(form.startDatetime) && <p className="text-xs text-muted-foreground">{dtDow(form.startDatetime)}</p>}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="end">
                  End Date & Time *
                  {!endEdited.current && settings?.defaultEventDurationHours && (
                    <span className="ml-1.5 text-xs font-normal text-muted-foreground">(auto: {settings.defaultEventDurationHours}h after start)</span>
                  )}
                </Label>
                <Input id="end" data-testid="input-event-end" type="datetime-local" value={form.endDatetime} onChange={e => { endEdited.current = true; setField("endDatetime", e.target.value); }} required />
                {dtDow(form.endDatetime) && <p className="text-xs text-muted-foreground">{dtDow(form.endDatetime)}</p>}
              </div>
            </div>

            {/* Location */}
            <div className="space-y-1.5">
              <Label htmlFor="location-name">Location Name *</Label>
              <div className="relative">
                <Input id="location-name" list="default-locations-list" data-testid="input-event-location-name" value={form.locationName} onChange={e => handleLocationChange(e.target.value)} required placeholder="Chastain Park Tennis Center" autoComplete="off" />
                <datalist id="default-locations-list">
                  {defaultLocations.map(loc => <option key={loc.id} value={loc.name} />)}
                </datalist>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="location-address">Location Address *</Label>
              <Input id="location-address" data-testid="input-event-location-address" value={form.locationAddress} onChange={e => setField("locationAddress", e.target.value)} required placeholder="4000 Damascus Dr NW, Atlanta, GA 30342" />
            </div>

            {/* Contact Email */}
            {eventContactEmails.length > 0 && (
              <div className="space-y-1.5">
                <Label>Contact Email</Label>
                <Select value={form.contactEmail || "__none__"} onValueChange={v => setField("contactEmail", v === "__none__" ? "" : v)}>
                  <SelectTrigger data-testid="select-contact-email"><SelectValue placeholder="Select a contact email..." /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">None</SelectItem>
                    {eventContactEmails.map(email => (
                      <SelectItem key={email} value={email}>{email}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">Shown on the event page for participant questions.</p>
              </div>
            )}
          </div>

          {/* Format & Settings */}
          <div className="bg-card border border-card-border rounded-lg p-5 space-y-4">
            <h2 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">Format & Settings</h2>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="min">{minLabel} *</Label>
                <NumericInput id="min" data-testid="input-min-participants" min={1} required value={form.minParticipants} onChange={v => setField("minParticipants", v)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="max">{maxLabel} *</Label>
                <NumericInput id="max" data-testid="input-max-participants" min={1} required value={form.maxParticipants} onChange={v => setField("maxParticipants", v)} />
              </div>
            </div>

            {/* Rating Requirement */}
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>Rating Requirement</Label>
                <Select value={form.ratingTypeRequired} onValueChange={handleRatingTypeChange}>
                  <SelectTrigger data-testid="select-rating-required"><SelectValue placeholder="Select requirement..." /></SelectTrigger>
                  <SelectContent>
                    {enabledRatingTypes.map(opt => <SelectItem key={opt.key} value={opt.key}>{opt.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              {/* DUPR config */}
              {form.ratingTypeRequired === "dupr" && ratingConfig && (
                <div className="rounded-md border border-border bg-muted/30 p-3 space-y-3">
                  <p className="text-xs font-medium text-muted-foreground">DUPR Rating Range</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs">Min Rating</Label>
                      <NumericInput data-testid="input-rating-min" step={0.1} min={rrc.dupr.minAllowed} max={rrc.dupr.maxAllowed} value={ratingConfig.min} onChange={v => setRatingConfig((c: any) => ({ ...c, min: v }))} />
                      <p className="text-xs text-muted-foreground">Range: {rrc.dupr.minAllowed}–{rrc.dupr.maxAllowed}</p>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Max Rating</Label>
                      <NumericInput data-testid="input-rating-max" step={0.1} min={rrc.dupr.minAllowed} max={rrc.dupr.maxAllowed} value={ratingConfig.max} onChange={v => setRatingConfig((c: any) => ({ ...c, max: v }))} />
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <input type="checkbox" id="nr-allowed" className="w-4 h-4 accent-primary" checked={!!ratingConfig.nrAllowed} onChange={e => setRatingConfig((c: any) => ({ ...c, nrAllowed: e.target.checked }))} />
                    <label htmlFor="nr-allowed" className="text-sm cursor-pointer">Allow NR (Not Rated) players</label>
                  </div>
                </div>
              )}

              {/* Self-Numeric config */}
              {form.ratingTypeRequired === "self_numeric" && ratingConfig && (
                <div className="rounded-md border border-border bg-muted/30 p-3 space-y-3">
                  <p className="text-xs font-medium text-muted-foreground">Self-Rating Numeric Range</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs">Min Rating</Label>
                      <NumericInput data-testid="input-rating-min" step={0.1} min={rrc.selfNumeric.minAllowed} max={rrc.selfNumeric.maxAllowed} value={ratingConfig.min} onChange={v => setRatingConfig((c: any) => ({ ...c, min: v }))} />
                      <p className="text-xs text-muted-foreground">Range: {rrc.selfNumeric.minAllowed}–{rrc.selfNumeric.maxAllowed}</p>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Max Rating</Label>
                      <NumericInput data-testid="input-rating-max" step={0.1} min={rrc.selfNumeric.minAllowed} max={rrc.selfNumeric.maxAllowed} value={ratingConfig.max} onChange={v => setRatingConfig((c: any) => ({ ...c, max: v }))} />
                    </div>
                  </div>
                </div>
              )}

              {/* Self-Skill config */}
              {form.ratingTypeRequired === "self_skill" && ratingConfig && rrc.selfSkill.levels.length > 0 && (
                <div className="rounded-md border border-border bg-muted/30 p-3 space-y-2">
                  <Label className="text-xs font-medium text-muted-foreground">Accepted Skill Level Range</Label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <Select value={String(ratingConfig.minLevel ?? rrc.selfSkill.defaultMinLevel)} onValueChange={v => setRatingConfig((c: any) => ({ ...c, minLevel: Number(v) }))}>
                      <SelectTrigger data-testid="select-skill-min-level"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {[...rrc.selfSkill.levels].sort((a, b) => a.level - b.level).map(lv => (
                          <SelectItem key={lv.level} value={String(lv.level)}>{lv.text}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select value={String(ratingConfig.maxLevel ?? rrc.selfSkill.defaultMaxLevel)} onValueChange={v => setRatingConfig((c: any) => ({ ...c, maxLevel: Number(v) }))}>
                      <SelectTrigger data-testid="select-skill-max-level"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {[...rrc.selfSkill.levels].sort((a, b) => a.level - b.level).map(lv => (
                          <SelectItem key={lv.level} value={String(lv.level)}>{lv.text}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <p className="text-xs text-muted-foreground">Players at these levels can register.</p>
                </div>
              )}
              {form.ratingTypeRequired === "self_skill" && rrc.selfSkill.levels.length === 0 && (
                <p className="text-xs text-amber-600">No skill levels defined in Settings yet. Add skill levels in App Settings before creating skill-level events.</p>
              )}

              <div className="flex items-center justify-between">
                <Label>Enable Waitlist</Label>
                <Switch data-testid="switch-waitlist" checked={form.waitlistEnabled} onCheckedChange={v => setField("waitlistEnabled", v)} />
              </div>
              <div className="space-y-1.5">
                <Label>Require Approval</Label>
                <Select data-testid="select-approval" value={form.requireApproval} onValueChange={v => setField("requireApproval", v as any)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No Approval</SelectItem>
                    <SelectItem value="all">All Players</SelectItem>
                    <SelectItem value="nr_only">NR Players Only</SelectItem>
                  </SelectContent>
                </Select>
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
              <Switch data-testid="switch-court-fee-enabled" checked={form.courtFeeEnabled} onCheckedChange={v => setField("courtFeeEnabled", v)} />
            </div>
            {form.courtFeeEnabled && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="member-fee">Member Fee ($)</Label>
                  <NumericInput id="member-fee" data-testid="input-member-fee" min={0} step={0.01} value={form.memberFee} onChange={v => setField("memberFee", v)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="non-member-fee">Non-Member Fee ($)</Label>
                  <NumericInput id="non-member-fee" data-testid="input-non-member-fee" min={0} step={0.01} value={form.nonMemberFee} onChange={v => setField("nonMemberFee", v)} />
                </div>
              </div>
            )}
          </div>

          {/* Signup Window */}
          <div className="bg-card border border-card-border rounded-lg p-5 space-y-4">
            <h2 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">Signup Window</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="signup-start">Signup Opens *</Label>
                <Input id="signup-start" data-testid="input-signup-start" type="datetime-local" value={form.signupStartDatetime} onChange={e => setField("signupStartDatetime", e.target.value)} required />
                {dtDow(form.signupStartDatetime) && <p className="text-xs text-muted-foreground">{dtDow(form.signupStartDatetime)}</p>}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="signup-end">
                  Signup Closes *
                  <span className="ml-1.5 text-xs font-normal text-muted-foreground">(auto: 12h before start)</span>
                </Label>
                <Input id="signup-end" data-testid="input-signup-end" type="datetime-local" value={form.signupEndDatetime} onChange={e => { signupEndEdited.current = true; setField("signupEndDatetime", e.target.value); }} required />
                {dtDow(form.signupEndDatetime) && <p className="text-xs text-muted-foreground">{dtDow(form.signupEndDatetime)}</p>}
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
              <Switch data-testid="switch-recurrence" checked={recurrenceEnabled} onCheckedChange={setRecurrenceEnabled} />
            </div>
            {recurrenceEnabled && (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label>Frequency</Label>
                    <Select value={recurrenceFrequency} onValueChange={setRecurrenceFrequency}>
                      <SelectTrigger data-testid="select-recurrence-frequency"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="daily">Daily</SelectItem>
                        <SelectItem value="weekly">Weekly</SelectItem>
                        <SelectItem value="monthly">Monthly</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Number of Occurrences</Label>
                    <NumericInput data-testid="input-recurrence-count" min={1} max={52} value={recurrenceOccurrences} onChange={v => setRecurrenceOccurrences(Math.max(1, v))} />
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
                          <label key={i} className="flex items-center gap-3 px-4 py-2.5 bg-background hover:bg-muted/30 cursor-pointer transition-colors" data-testid={`recurrence-date-${i}`}>
                            <Checkbox checked={checked} onCheckedChange={() => toggleDate(iso)} data-testid={`recurrence-checkbox-${i}`} />
                            <Calendar className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                            <span className="text-sm font-mono">{format(d, "EEE, MMM d, yyyy 'at' h:mm a")}</span>
                          </label>
                        );
                      })}
                    </div>
                    {selectedDates.size === 0 && <p className="text-xs text-amber-600">No additional dates selected — only the main event will be created.</p>}
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
            <Link href="/admin/events"><Button type="button" variant="outline">Cancel</Button></Link>
          </div>
        </form>
      </main>
    </div>
  );
}
