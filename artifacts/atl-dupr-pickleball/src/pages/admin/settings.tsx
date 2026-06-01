import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useGetSettings, useUpdateSettings, getGetSettingsQueryKey } from "@workspace/api-client-react";
import { AdminNav } from "@/components/admin-nav";
import { RichTextEditor } from "@/components/rich-text-editor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NumericInput } from "@/components/numeric-input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { Settings, Plus, Trash2, Pencil, MapPin, User, AlertTriangle, DollarSign } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const TIMEZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Phoenix",
  "America/Anchorage",
  "Pacific/Honolulu",
];

interface ContactPerson { name: string; email: string; }
interface DefaultLocation { id: string; name: string; address: string; memberFee?: number; nonMemberFee?: number; courtFeeEnabled?: boolean; }
interface SkillLevel { text: string; level: number; }
interface DuprRatingConfig { enabled: boolean; minAllowed: number; maxAllowed: number; defaultMin: number; defaultMax: number; defaultNrAllowed: boolean; }
interface SelfNumericConfig { enabled: boolean; minAllowed: number; maxAllowed: number; defaultMin: number; defaultMax: number; }
interface SelfSkillConfig { enabled: boolean; levels: SkillLevel[]; defaultMinLevel: number; defaultMaxLevel: number; }
interface RatingRequirementsConfig { dupr: DuprRatingConfig; selfNumeric: SelfNumericConfig; selfSkill: SelfSkillConfig; }

const DEFAULT_RATING_CONFIG: RatingRequirementsConfig = {
  dupr: { enabled: true, minAllowed: 2.0, maxAllowed: 8.0, defaultMin: 2.0, defaultMax: 4.0, defaultNrAllowed: false },
  selfNumeric: { enabled: true, minAllowed: 2.0, maxAllowed: 6.0, defaultMin: 2.0, defaultMax: 4.0 },
  selfSkill: { enabled: true, levels: [], defaultMinLevel: 1, defaultMaxLevel: 3 },
};

function genId() {
  return `loc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

type ContactDialog = { open: false } | { open: true; mode: "add" } | { open: true; mode: "edit"; index: number; data: ContactPerson };
type LocationDialog = { open: false } | { open: true; mode: "add" } | { open: true; mode: "edit"; index: number; data: DefaultLocation };

export default function AdminSettings() {
  const { isAuthenticated, isLoading, isAdmin } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) setLocation("/login");
    if (!isLoading && isAuthenticated && !isAdmin) setLocation("/admin/events");
  }, [isLoading, isAuthenticated, isAdmin]);

  const { data: settings, isLoading: settingsLoading } = useGetSettings();
  const updateSettings = useUpdateSettings();
  const queryClient = useQueryClient();

  const [form, setForm] = useState({
    defaultTimezone: "America/New_York",
    rotatingPartnersDescription: "",
    fixedPartnerDescription: "",
    minParticipants: 8,
    maxParticipants: 24,
    minTeams: 4,
    maxTeams: 12,
    contactPersons: [] as ContactPerson[],
    defaultLocations: [] as DefaultLocation[],
    maintenanceMode: false,
    defaultEventNames: [] as string[],
    eventRoles: [] as string[],
    defaultEventDurationHours: 2,
    ratingRequirementsConfig: DEFAULT_RATING_CONFIG as RatingRequirementsConfig,
  });
  const [dirty, setDirty] = useState(false);
  const lastSyncedSettings = useRef<typeof settings | null>(null);
  const [newEventName, setNewEventName] = useState("");
  const [editingEventNameIdx, setEditingEventNameIdx] = useState<number | null>(null);
  const [editEventNameValue, setEditEventNameValue] = useState("");
  const [deleteEventNameIdx, setDeleteEventNameIdx] = useState<number | null>(null);

  const [newEventRole, setNewEventRole] = useState("");
  const [editingEventRoleIdx, setEditingEventRoleIdx] = useState<number | null>(null);
  const [editEventRoleValue, setEditEventRoleValue] = useState("");
  const [deleteEventRoleIdx, setDeleteEventRoleIdx] = useState<number | null>(null);

  useEffect(() => {
    if (settings && settings !== lastSyncedSettings.current) {
      lastSyncedSettings.current = settings;
      const rrc = (settings as any).ratingRequirementsConfig ?? DEFAULT_RATING_CONFIG;
      setForm({
        defaultTimezone: settings.defaultTimezone,
        rotatingPartnersDescription: settings.rotatingPartnersDescription,
        fixedPartnerDescription: settings.fixedPartnerDescription,
        minParticipants: settings.minParticipants,
        maxParticipants: settings.maxParticipants,
        minTeams: settings.minTeams,
        maxTeams: settings.maxTeams,
        contactPersons: (settings.contactPersons as ContactPerson[]) ?? [],
        defaultLocations: (settings.defaultLocations as DefaultLocation[]) ?? [],
        maintenanceMode: settings.maintenanceMode ?? false,
        defaultEventNames: (settings.defaultEventNames as string[]) ?? [],
        eventRoles: ((settings as any).eventRoles as string[]) ?? [],
        defaultEventDurationHours: (settings.defaultEventDurationHours as number) ?? 2,
        ratingRequirementsConfig: {
          dupr: { ...DEFAULT_RATING_CONFIG.dupr, ...(rrc.dupr ?? {}) },
          selfNumeric: { ...DEFAULT_RATING_CONFIG.selfNumeric, ...(rrc.selfNumeric ?? {}) },
          selfSkill: { ...DEFAULT_RATING_CONFIG.selfSkill, ...(rrc.selfSkill ?? {}) },
        },
      });
    }
  }, [settings]);

  const autoSaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const formRef = useRef(form);
  formRef.current = form;

  function scheduleAutoSave() {
    if (autoSaveTimeoutRef.current) clearTimeout(autoSaveTimeoutRef.current);
    autoSaveTimeoutRef.current = setTimeout(() => {
      autoSaveTimeoutRef.current = null;
      updateSettings.mutate({ data: formRef.current as any }, {
        onSuccess: (data) => { queryClient.setQueryData(getGetSettingsQueryKey(), data); toast({ title: "Saved" }); setDirty(false); },
        onError: () => toast({ title: "Failed to save", variant: "destructive" }),
      });
    }, 300);
  }

  function update<K extends keyof typeof form>(key: K, value: (typeof form)[K], autoSave = false) {
    const nextForm = { ...form, [key]: value };
    setForm(nextForm);
    formRef.current = nextForm;
    setDirty(true);
    if (autoSave) scheduleAutoSave();
  }

  function updateRrc(section: "dupr" | "selfNumeric" | "selfSkill", patch: Record<string, any>, autoSave = false) {
    const nextForm = {
      ...form,
      ratingRequirementsConfig: {
        ...form.ratingRequirementsConfig,
        [section]: { ...form.ratingRequirementsConfig[section], ...patch },
      },
    };
    setForm(nextForm);
    formRef.current = nextForm;
    setDirty(true);
    if (autoSave) scheduleAutoSave();
  }

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    updateSettings.mutate({ data: formRef.current as any }, {
      onSuccess: (data) => {
        queryClient.setQueryData(getGetSettingsQueryKey(), data);
        toast({ title: "Settings saved" }); setDirty(false);
      },
      onError: (err: any) => {
        const msg = err?.response?.error ?? err?.message ?? JSON.stringify(err);
        console.error("[settings save error]", err);
        toast({ title: "Failed to save settings", description: msg, variant: "destructive" });
      },
    });
  }

  // ── Contact Persons ──────────────────────────────────────────
  const [contactDialog, setContactDialog] = useState<ContactDialog>({ open: false });
  const [contactForm, setContactForm] = useState({ name: "", email: "" });
  const [deleteContactIdx, setDeleteContactIdx] = useState<number | null>(null);

  function openAddContact() { setContactForm({ name: "", email: "" }); setContactDialog({ open: true, mode: "add" }); }
  function openEditContact(i: number) { setContactForm({ ...form.contactPersons[i] }); setContactDialog({ open: true, mode: "edit", index: i, data: form.contactPersons[i] }); }
  function closeContactDialog() { setContactDialog({ open: false }); }
  function saveContact(e: React.FormEvent) {
    e.preventDefault();
    if (!contactForm.name.trim() || !contactForm.email.trim()) return;
    if (contactDialog.open && contactDialog.mode === "add") {
      update("contactPersons", [...form.contactPersons, { name: contactForm.name.trim(), email: contactForm.email.trim() }], true);
    } else if (contactDialog.open && contactDialog.mode === "edit") {
      update("contactPersons", form.contactPersons.map((c, idx) =>
        idx === contactDialog.index ? { name: contactForm.name.trim(), email: contactForm.email.trim() } : c
      ), true);
    }
    setContactDialog({ open: false });
  }
  function confirmDeleteContact() {
    if (deleteContactIdx === null) return;
    update("contactPersons", form.contactPersons.filter((_, idx) => idx !== deleteContactIdx), true);
    setDeleteContactIdx(null);
  }

  // ── Default Locations ────────────────────────────────────────
  const [locationDialog, setLocationDialog] = useState<LocationDialog>({ open: false });
  const [locationForm, setLocationForm] = useState({ name: "", address: "", memberFee: 0, nonMemberFee: 0, courtFeeEnabled: false });
  const [deleteLocationIdx, setDeleteLocationIdx] = useState<number | null>(null);

  function openAddLocation() { setLocationForm({ name: "", address: "", memberFee: 0, nonMemberFee: 0, courtFeeEnabled: false }); setLocationDialog({ open: true, mode: "add" }); }
  function openEditLocation(i: number) {
    const loc = form.defaultLocations[i];
    setLocationForm({ name: loc.name, address: loc.address, memberFee: loc.memberFee ?? 0, nonMemberFee: loc.nonMemberFee ?? 0, courtFeeEnabled: loc.courtFeeEnabled ?? false });
    setLocationDialog({ open: true, mode: "edit", index: i, data: loc });
  }
  function closeLocationDialog() { setLocationDialog({ open: false }); }
  function saveLocation(e: React.FormEvent) {
    e.preventDefault();
    if (!locationForm.name.trim()) return;
    const locData: DefaultLocation = {
      id: locationDialog.open && locationDialog.mode === "edit" ? locationDialog.data.id : genId(),
      name: locationForm.name.trim(), address: locationForm.address.trim(),
      memberFee: locationForm.memberFee, nonMemberFee: locationForm.nonMemberFee, courtFeeEnabled: locationForm.courtFeeEnabled,
    };
    if (locationDialog.open && locationDialog.mode === "add") {
      update("defaultLocations", [...form.defaultLocations, locData], true);
    } else if (locationDialog.open && locationDialog.mode === "edit") {
      update("defaultLocations", form.defaultLocations.map((loc, idx) => idx === locationDialog.index ? locData : loc), true);
    }
    setLocationDialog({ open: false });
  }
  function confirmDeleteLocation() {
    if (deleteLocationIdx === null) return;
    update("defaultLocations", form.defaultLocations.filter((_, idx) => idx !== deleteLocationIdx), true);
    setDeleteLocationIdx(null);
  }

  // ── Skill Levels ─────────────────────────────────────────────
  const [newSkillText, setNewSkillText] = useState("");
  const [deleteSkillIdx, setDeleteSkillIdx] = useState<number | null>(null);
  const [editingSkillIdx, setEditingSkillIdx] = useState<number | null>(null);
  const [editSkillText, setEditSkillText] = useState("");

  function addSkillLevel() {
    const text = newSkillText.trim();
    if (!text) return;
    const levels = [...form.ratingRequirementsConfig.selfSkill.levels].sort((a, b) => a.level - b.level);
    const newLevel = levels.length + 1;
    updateRrc("selfSkill", { levels: [...levels, { text, level: newLevel }] }, true);
    setNewSkillText("");
  }

  function confirmDeleteSkillLevel() {
    if (deleteSkillIdx === null) return;
    const levels = [...form.ratingRequirementsConfig.selfSkill.levels].sort((a, b) => a.level - b.level);
    const filtered = levels.filter((_, idx) => idx !== deleteSkillIdx);
    const renumbered = filtered.map((l, i) => ({ ...l, level: i + 1 }));
    updateRrc("selfSkill", { levels: renumbered }, true);
    setDeleteSkillIdx(null);
    if (editingSkillIdx === deleteSkillIdx) setEditingSkillIdx(null);
  }

  function saveSkillLevelEdit() {
    if (editingSkillIdx === null) return;
    const text = editSkillText.trim();
    if (!text) return;
    const levels = [...form.ratingRequirementsConfig.selfSkill.levels].sort((a, b) => a.level - b.level);
    const updated = levels.map((l, idx) => idx === editingSkillIdx ? { ...l, text } : l);
    updateRrc("selfSkill", { levels: updated }, true);
    setEditingSkillIdx(null);
  }

  function moveSkillLevel(idx: number, dir: -1 | 1) {
    const levels = [...form.ratingRequirementsConfig.selfSkill.levels].sort((a, b) => a.level - b.level);
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= levels.length) return;
    [levels[idx], levels[newIdx]] = [levels[newIdx], levels[idx]];
    const renumbered = levels.map((l, i) => ({ ...l, level: i + 1 }));
    updateRrc("selfSkill", { levels: renumbered }, true);
  }

  const rrc = form.ratingRequirementsConfig;

  return (
    <div className="min-h-screen bg-background">
      <AdminNav />
      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-6">
        <div className="mb-6">
          <h1 className="text-xl font-bold text-foreground">App Settings</h1>
          <p className="text-muted-foreground text-sm mt-0.5">Configure site-wide defaults and event descriptions</p>
        </div>

        {settingsLoading ? (
          <div className="space-y-4">{[1,2,3].map(i => <Skeleton key={i} className="h-16 w-full" />)}</div>
        ) : (
          <form onSubmit={handleSave} className="space-y-8">

            {/* ── General ──────────────────────────────────── */}
            <section className="bg-card border border-card-border rounded-lg p-5 space-y-4">
              <h2 className="text-sm font-semibold text-foreground uppercase tracking-wide">General</h2>

              <div className="space-y-1.5">
                <Label htmlFor="timezone">Default Timezone</Label>
                <Select value={form.defaultTimezone} onValueChange={v => update("defaultTimezone", v)}>
                  <SelectTrigger id="timezone" data-testid="select-timezone"><SelectValue /></SelectTrigger>
                  <SelectContent>{TIMEZONES.map(tz => <SelectItem key={tz} value={tz}>{tz}</SelectItem>)}</SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">Used as the default timezone when displaying event times.</p>
              </div>

              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Rotating Partners</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="min-participants">Min Participants</Label>
                    <NumericInput id="min-participants" data-testid="input-min-participants" min={2} value={form.minParticipants} onChange={v => update("minParticipants", v)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="max-participants">Max Participants</Label>
                    <NumericInput id="max-participants" data-testid="input-max-participants" min={2} value={form.maxParticipants} onChange={v => update("maxParticipants", v)} />
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Fixed Partner</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="min-teams">Min Teams</Label>
                    <NumericInput id="min-teams" data-testid="input-min-teams" min={1} value={form.minTeams} onChange={v => update("minTeams", v)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="max-teams">Max Teams</Label>
                    <NumericInput id="max-teams" data-testid="input-max-teams" min={1} value={form.maxTeams} onChange={v => update("maxTeams", v)} />
                  </div>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="event-duration">Default Event Duration (hours)</Label>
                <NumericInput id="event-duration" data-testid="input-event-duration-hours" min={1} max={24} value={form.defaultEventDurationHours} onChange={v => update("defaultEventDurationHours", Math.max(1, v))} />
                <p className="text-xs text-muted-foreground">Used to auto-calculate the end time when creating new events.</p>
              </div>
            </section>

            {/* ── Event Format Descriptions ─────────────────── */}
            <section className="bg-card border border-card-border rounded-lg p-5 space-y-4">
              <h2 className="text-sm font-semibold text-foreground uppercase tracking-wide">Event Format Descriptions</h2>
              <p className="text-xs text-muted-foreground -mt-2">These descriptions are shown to participants during event registration.</p>
              <div className="space-y-1.5">
                <Label>Rotating Partners Format</Label>
                <RichTextEditor key="rotating" data-testid="editor-rotating-description" value={form.rotatingPartnersDescription} onChange={v => update("rotatingPartnersDescription", v)} placeholder="Describe how rotating partners events work..." />
              </div>
              <div className="space-y-1.5">
                <Label>Fixed Partner Format</Label>
                <RichTextEditor key="fixed" data-testid="editor-fixed-description" value={form.fixedPartnerDescription} onChange={v => update("fixedPartnerDescription", v)} placeholder="Describe how fixed partner events work..." />
              </div>
            </section>

            {/* ── Contact Persons ───────────────────────────── */}
            <section className="bg-card border border-card-border rounded-lg p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-semibold text-foreground uppercase tracking-wide">Contact Persons</h2>
                  <p className="text-xs text-muted-foreground mt-0.5">People participants can reach out to for help.</p>
                </div>
                <Button type="button" variant="outline" size="sm" className="gap-1.5" data-testid="button-add-contact" onClick={openAddContact}>
                  <Plus className="w-3.5 h-3.5" /> Add Contact
                </Button>
              </div>
              {form.contactPersons.length === 0 ? (
                <div className="text-center py-6 text-muted-foreground"><User className="w-8 h-8 mx-auto mb-2 opacity-20" /><p className="text-sm">No contact persons added yet.</p></div>
              ) : (
                <div className="divide-y divide-border rounded-md border border-border overflow-hidden">
                  {form.contactPersons.map((contact, i) => (
                    <div key={i} className="flex items-center gap-3 px-4 py-3 bg-background hover:bg-muted/30 transition-colors" data-testid={`contact-card-${i}`}>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">{contact.name}</p>
                        <p className="text-xs text-muted-foreground truncate">{contact.email}</p>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <Button type="button" variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground h-7 w-7 p-0" data-testid={`button-edit-contact-${i}`} onClick={() => openEditContact(i)}><Pencil className="w-3.5 h-3.5" /></Button>
                        <Button type="button" variant="ghost" size="sm" className="text-muted-foreground hover:text-destructive h-7 w-7 p-0" data-testid={`button-delete-contact-${i}`} onClick={() => setDeleteContactIdx(i)}><Trash2 className="w-3.5 h-3.5" /></Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* ── Default Locations ─────────────────────────── */}
            <section className="bg-card border border-card-border rounded-lg p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-semibold text-foreground uppercase tracking-wide">Default Locations</h2>
                  <p className="text-xs text-muted-foreground mt-0.5">Venue presets available when creating events.</p>
                </div>
                <Button type="button" variant="outline" size="sm" className="gap-1.5" data-testid="button-add-location" onClick={openAddLocation}>
                  <Plus className="w-3.5 h-3.5" /> Add Location
                </Button>
              </div>
              {form.defaultLocations.length === 0 ? (
                <div className="text-center py-6 text-muted-foreground"><MapPin className="w-8 h-8 mx-auto mb-2 opacity-20" /><p className="text-sm">No default locations added yet.</p></div>
              ) : (
                <div className="divide-y divide-border rounded-md border border-border overflow-hidden">
                  {form.defaultLocations.map((loc, i) => (
                    <div key={loc.id} className="flex items-center gap-3 px-4 py-3 bg-background hover:bg-muted/30 transition-colors" data-testid={`location-card-${i}`}>
                      <MapPin className="w-4 h-4 text-muted-foreground shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">{loc.name}</p>
                        <p className="text-xs text-muted-foreground truncate">{loc.address || "No address"}</p>
                        {loc.courtFeeEnabled && (
                          <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1"><DollarSign className="w-3 h-3" />Member ${loc.memberFee ?? 0} / Non-member ${loc.nonMemberFee ?? 0}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <Button type="button" variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground h-7 w-7 p-0" data-testid={`button-edit-location-${i}`} onClick={() => openEditLocation(i)}><Pencil className="w-3.5 h-3.5" /></Button>
                        <Button type="button" variant="ghost" size="sm" className="text-muted-foreground hover:text-destructive h-7 w-7 p-0" data-testid={`button-delete-location-${i}`} onClick={() => setDeleteLocationIdx(i)}><Trash2 className="w-3.5 h-3.5" /></Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* ── Default Event Names ───────────────────────── */}
            <section className="bg-card border border-card-border rounded-lg p-5 space-y-4">
              <div>
                <h2 className="text-sm font-semibold text-foreground uppercase tracking-wide">Default Event Names</h2>
                <p className="text-xs text-muted-foreground mt-0.5">Preset names available when creating new events.</p>
              </div>
              {form.defaultEventNames.length > 0 && (
                <div className="divide-y divide-border rounded-md border border-border overflow-hidden">
                  {form.defaultEventNames.map((name, i) => (
                    <div key={i} className="flex items-center gap-3 px-4 py-2.5 bg-background hover:bg-muted/30 transition-colors" data-testid={`event-name-row-${i}`}>
                      {editingEventNameIdx === i ? (
                        <>
                          <Input data-testid={`input-edit-event-name-${i}`} value={editEventNameValue} onChange={e => setEditEventNameValue(e.target.value)} className="flex-1 h-7 text-sm" onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); const v = editEventNameValue.trim(); if (v && !form.defaultEventNames.some((n, idx) => n === v && idx !== i)) { update("defaultEventNames", form.defaultEventNames.map((n, idx) => idx === i ? v : n), true); setEditingEventNameIdx(null); } } if (e.key === "Escape") setEditingEventNameIdx(null); }} autoFocus />
                          <Button type="button" variant="ghost" size="sm" className="text-primary h-7 px-2 shrink-0 text-xs" data-testid={`button-save-event-name-${i}`} onClick={() => { const v = editEventNameValue.trim(); if (v && !form.defaultEventNames.some((n, idx) => n === v && idx !== i)) { update("defaultEventNames", form.defaultEventNames.map((n, idx) => idx === i ? v : n), true); setEditingEventNameIdx(null); } }}>Save</Button>
                          <Button type="button" variant="ghost" size="sm" className="text-muted-foreground h-7 px-2 shrink-0 text-xs" data-testid={`button-cancel-event-name-${i}`} onClick={() => setEditingEventNameIdx(null)}>Cancel</Button>
                        </>
                      ) : (
                        <>
                          <span className="flex-1 text-sm text-foreground truncate">{name}</span>
                          <Button type="button" variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground h-7 w-7 p-0 shrink-0" data-testid={`button-edit-event-name-${i}`} onClick={() => { setEditingEventNameIdx(i); setEditEventNameValue(name); }}><Pencil className="w-3.5 h-3.5" /></Button>
                          <Button type="button" variant="ghost" size="sm" className="text-muted-foreground hover:text-destructive h-7 w-7 p-0 shrink-0" data-testid={`button-delete-event-name-${i}`} onClick={() => setDeleteEventNameIdx(i)}><Trash2 className="w-3.5 h-3.5" /></Button>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              )}
              <div className="flex gap-2">
                <Input data-testid="input-new-event-name" value={newEventName} onChange={e => setNewEventName(e.target.value)} placeholder="Saturday Morning Round Robin" onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); const t = newEventName.trim(); if (t && !form.defaultEventNames.includes(t)) { update("defaultEventNames", [...form.defaultEventNames, t], true); setNewEventName(""); } } }} />
                <Button type="button" variant="outline" size="sm" className="gap-1.5 shrink-0" data-testid="button-add-event-name" onClick={() => { const t = newEventName.trim(); if (t && !form.defaultEventNames.includes(t)) { update("defaultEventNames", [...form.defaultEventNames, t], true); setNewEventName(""); } }}>
                  <Plus className="w-3.5 h-3.5" /> Add
                </Button>
              </div>
            </section>

            {/* ── Event Roles ──────────────────────────────── */}
            <section className="bg-card border border-card-border rounded-lg p-5 space-y-4">
              <div>
                <h2 className="text-sm font-semibold text-foreground uppercase tracking-wide">Event Roles</h2>
                <p className="text-xs text-muted-foreground mt-0.5">Roles available to assign to participants on the event detail page (e.g. Event Captain, Court Leader).</p>
              </div>
              {form.eventRoles.length > 0 && (
                <div className="divide-y divide-border rounded-md border border-border overflow-hidden">
                  {form.eventRoles.map((role, i) => (
                    <div key={i} className="flex items-center gap-3 px-4 py-2.5 bg-background hover:bg-muted/30 transition-colors" data-testid={`event-role-row-${i}`}>
                      {editingEventRoleIdx === i ? (
                        <>
                          <Input
                            data-testid={`input-edit-event-role-${i}`}
                            value={editEventRoleValue}
                            onChange={e => setEditEventRoleValue(e.target.value)}
                            className="flex-1 h-7 text-sm"
                            autoFocus
                            onKeyDown={e => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                const v = editEventRoleValue.trim();
                                if (v && !form.eventRoles.some((r, idx) => r === v && idx !== i)) {
                                  update("eventRoles", form.eventRoles.map((r, idx) => idx === i ? v : r), true);
                                  setEditingEventRoleIdx(null);
                                }
                              }
                              if (e.key === "Escape") setEditingEventRoleIdx(null);
                            }}
                          />
                          <Button type="button" variant="ghost" size="sm" className="text-primary h-7 px-2 shrink-0 text-xs" data-testid={`button-save-event-role-${i}`} onClick={() => {
                            const v = editEventRoleValue.trim();
                            if (v && !form.eventRoles.some((r, idx) => r === v && idx !== i)) {
                              update("eventRoles", form.eventRoles.map((r, idx) => idx === i ? v : r), true);
                              setEditingEventRoleIdx(null);
                            }
                          }}>Save</Button>
                          <Button type="button" variant="ghost" size="sm" className="text-muted-foreground h-7 px-2 shrink-0 text-xs" data-testid={`button-cancel-event-role-${i}`} onClick={() => setEditingEventRoleIdx(null)}>Cancel</Button>
                        </>
                      ) : (
                        <>
                          <span className="flex-1 text-sm text-foreground truncate">{role}</span>
                          <Button type="button" variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground h-7 w-7 p-0 shrink-0" data-testid={`button-edit-event-role-${i}`} onClick={() => { setEditingEventRoleIdx(i); setEditEventRoleValue(role); }}><Pencil className="w-3.5 h-3.5" /></Button>
                          <Button type="button" variant="ghost" size="sm" className="text-muted-foreground hover:text-destructive h-7 w-7 p-0 shrink-0" data-testid={`button-delete-event-role-${i}`} onClick={() => setDeleteEventRoleIdx(i)}><Trash2 className="w-3.5 h-3.5" /></Button>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              )}
              <div className="flex gap-2">
                <Input
                  data-testid="input-new-event-role"
                  value={newEventRole}
                  onChange={e => setNewEventRole(e.target.value)}
                  placeholder="Event Captain"
                  onKeyDown={e => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      const t = newEventRole.trim();
                      if (t && !form.eventRoles.includes(t)) {
                        update("eventRoles", [...form.eventRoles, t], true);
                        setNewEventRole("");
                      }
                    }
                  }}
                />
                <Button type="button" variant="outline" size="sm" className="gap-1.5 shrink-0" data-testid="button-add-event-role" onClick={() => {
                  const t = newEventRole.trim();
                  if (t && !form.eventRoles.includes(t)) {
                    update("eventRoles", [...form.eventRoles, t], true);
                    setNewEventRole("");
                  }
                }}>
                  <Plus className="w-3.5 h-3.5" /> Add
                </Button>
              </div>
            </section>

            {/* ── Rating Requirements Config ────────────────── */}
            <section className="bg-card border border-card-border rounded-lg p-5 space-y-5">
              <div>
                <h2 className="text-sm font-semibold text-foreground uppercase tracking-wide">Rating Requirements</h2>
                <p className="text-xs text-muted-foreground mt-0.5">Configure which rating types are available and their defaults for new events.</p>
              </div>

              {/* ── DUPR Rating ── */}
              <div className="border border-border rounded-md p-4 space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold text-foreground">DUPR Rating</p>
                    <p className="text-xs text-muted-foreground">Verified DUPR doubles rating (2.0–8.0 scale)</p>
                  </div>
                  <Switch data-testid="toggle-dupr-enabled" checked={rrc.dupr.enabled} onCheckedChange={v => updateRrc("dupr", { enabled: v })} />
                </div>
                {rrc.dupr.enabled && (
                  <div className="space-y-3 pl-1">
                    <div>
                      <p className="text-xs font-medium text-muted-foreground mb-2">Allowed Range for Events</p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div className="space-y-1">
                          <Label className="text-xs">Min Allowed</Label>
                          <NumericInput data-testid="input-dupr-min-allowed" min={2.0} max={8.0} step={0.1} value={rrc.dupr.minAllowed} onChange={v => updateRrc("dupr", { minAllowed: v })} />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">Max Allowed</Label>
                          <NumericInput data-testid="input-dupr-max-allowed" min={2.0} max={8.0} step={0.1} value={rrc.dupr.maxAllowed} onChange={v => updateRrc("dupr", { maxAllowed: v })} />
                        </div>
                      </div>
                    </div>
                    <div>
                      <p className="text-xs font-medium text-muted-foreground mb-2">Default Values for New Events</p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div className="space-y-1">
                          <Label className="text-xs">Default Min</Label>
                          <NumericInput data-testid="input-dupr-default-min" min={rrc.dupr.minAllowed} max={rrc.dupr.maxAllowed} step={0.1} value={rrc.dupr.defaultMin} onChange={v => updateRrc("dupr", { defaultMin: v })} />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">Default Max</Label>
                          <NumericInput data-testid="input-dupr-default-max" min={rrc.dupr.minAllowed} max={rrc.dupr.maxAllowed} step={0.1} value={rrc.dupr.defaultMax} onChange={v => updateRrc("dupr", { defaultMax: v })} />
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center justify-between pt-1">
                      <div>
                        <p className="text-sm">Allow NR (Not Rated) by default</p>
                        <p className="text-xs text-muted-foreground">Unrated players can register unless disabled per-event</p>
                      </div>
                      <Switch data-testid="toggle-dupr-nr-allowed" checked={rrc.dupr.defaultNrAllowed} onCheckedChange={v => updateRrc("dupr", { defaultNrAllowed: v })} />
                    </div>
                  </div>
                )}
              </div>

              {/* ── Self-Rating Numeric ── */}
              <div className="border border-border rounded-md p-4 space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold text-foreground">Self-Rating Numeric</p>
                    <p className="text-xs text-muted-foreground">Player self-reported numeric rating (2.0–6.0 scale)</p>
                  </div>
                  <Switch data-testid="toggle-self-numeric-enabled" checked={rrc.selfNumeric.enabled} onCheckedChange={v => updateRrc("selfNumeric", { enabled: v })} />
                </div>
                {rrc.selfNumeric.enabled && (
                  <div className="space-y-3 pl-1">
                    <div>
                      <p className="text-xs font-medium text-muted-foreground mb-2">Allowed Range for Events</p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div className="space-y-1">
                          <Label className="text-xs">Min Allowed</Label>
                          <NumericInput data-testid="input-self-numeric-min-allowed" min={2.0} max={6.0} step={0.1} value={rrc.selfNumeric.minAllowed} onChange={v => updateRrc("selfNumeric", { minAllowed: v })} />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">Max Allowed</Label>
                          <NumericInput data-testid="input-self-numeric-max-allowed" min={2.0} max={6.0} step={0.1} value={rrc.selfNumeric.maxAllowed} onChange={v => updateRrc("selfNumeric", { maxAllowed: v })} />
                        </div>
                      </div>
                    </div>
                    <div>
                      <p className="text-xs font-medium text-muted-foreground mb-2">Default Values for New Events</p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div className="space-y-1">
                          <Label className="text-xs">Default Min</Label>
                          <NumericInput data-testid="input-self-numeric-default-min" min={rrc.selfNumeric.minAllowed} max={rrc.selfNumeric.maxAllowed} step={0.1} value={rrc.selfNumeric.defaultMin} onChange={v => updateRrc("selfNumeric", { defaultMin: v })} />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">Default Max</Label>
                          <NumericInput data-testid="input-self-numeric-default-max" min={rrc.selfNumeric.minAllowed} max={rrc.selfNumeric.maxAllowed} step={0.1} value={rrc.selfNumeric.defaultMax} onChange={v => updateRrc("selfNumeric", { defaultMax: v })} />
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* ── Self-Rating Skill Level ── */}
              <div className="border border-border rounded-md p-4 space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold text-foreground">Self-Rating Skill Level</p>
                    <p className="text-xs text-muted-foreground">Admin-defined skill tiers — use arrows to reorder, 1 = highest</p>
                  </div>
                  <Switch data-testid="toggle-self-skill-enabled" checked={rrc.selfSkill.enabled} onCheckedChange={v => updateRrc("selfSkill", { enabled: v })} />
                </div>
                {rrc.selfSkill.enabled && (
                  <div className="space-y-3 pl-1">
                    <div>
                      <p className="text-xs font-medium text-muted-foreground mb-2">Default Range for New Events</p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div className="space-y-1">
                          <Label className="text-xs">Default Min Level</Label>
                          <Select value={String(rrc.selfSkill.defaultMinLevel)} onValueChange={v => { if (v) updateRrc("selfSkill", { defaultMinLevel: Number(v) }); }}>
                            <SelectTrigger data-testid="select-skill-default-min"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {[...rrc.selfSkill.levels].sort((a, b) => a.level - b.level).map(lv => (
                                <SelectItem key={lv.level} value={String(lv.level)}>{lv.text}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">Default Max Level</Label>
                          <Select value={String(rrc.selfSkill.defaultMaxLevel)} onValueChange={v => { if (v) updateRrc("selfSkill", { defaultMaxLevel: Number(v) }); }}>
                            <SelectTrigger data-testid="select-skill-default-max"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {[...rrc.selfSkill.levels].sort((a, b) => a.level - b.level).map(lv => (
                                <SelectItem key={lv.level} value={String(lv.level)}>{lv.text}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    </div>
                    {rrc.selfSkill.levels.length > 0 && (
                      <div className="divide-y divide-border rounded-md border border-border overflow-hidden">
                        {[...rrc.selfSkill.levels].sort((a, b) => a.level - b.level).map((lv, i) => (
                          <div key={lv.level} className="flex items-center gap-2 px-3 py-2 bg-background" data-testid={`skill-level-row-${i}`}>
                            {editingSkillIdx === i ? (
                              <>
                                <Input
                                  data-testid={`input-edit-skill-level-${i}`}
                                  value={editSkillText}
                                  onChange={e => setEditSkillText(e.target.value)}
                                  className="flex-1 h-7 text-sm"
                                  autoFocus
                                  onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); saveSkillLevelEdit(); } if (e.key === "Escape") setEditingSkillIdx(null); }}
                                />
                                <Button type="button" variant="ghost" size="sm" className="text-primary h-7 px-2 text-xs shrink-0" onClick={saveSkillLevelEdit}>Save</Button>
                                <Button type="button" variant="ghost" size="sm" className="text-muted-foreground h-7 px-2 text-xs shrink-0" onClick={() => setEditingSkillIdx(null)}>Cancel</Button>
                              </>
                            ) : (
                              <>
                                <span className="text-xs text-muted-foreground font-mono w-5 shrink-0">{lv.level}</span>
                                <span className="flex-1 text-sm truncate">{lv.text}</span>
                                <div className="flex items-center gap-0.5 shrink-0">
                                  <Button type="button" variant="ghost" size="sm" className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground" disabled={i === 0} onClick={() => moveSkillLevel(i, -1)}>↑</Button>
                                  <Button type="button" variant="ghost" size="sm" className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground" disabled={i === rrc.selfSkill.levels.length - 1} onClick={() => moveSkillLevel(i, 1)}>↓</Button>
                                  <Button type="button" variant="ghost" size="sm" className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground" data-testid={`button-edit-skill-level-${i}`} onClick={() => { setEditingSkillIdx(i); setEditSkillText(lv.text); }}><Pencil className="w-3 h-3" /></Button>
                                  <Button type="button" variant="ghost" size="sm" className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive" data-testid={`button-delete-skill-level-${i}`} onClick={() => setDeleteSkillIdx(i)}><Trash2 className="w-3 h-3" /></Button>
                                </div>
                              </>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="flex gap-2">
                      <Input
                        data-testid="input-new-skill-level"
                        value={newSkillText}
                        onChange={e => setNewSkillText(e.target.value)}
                        placeholder="e.g. Advanced, Intermediate, Beginner"
                        onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addSkillLevel(); } }}
                      />
                      <Button type="button" variant="outline" size="sm" className="gap-1.5 shrink-0" data-testid="button-add-skill-level" onClick={addSkillLevel}>
                        <Plus className="w-3.5 h-3.5" /> Add
                      </Button>
                    </div>
                    {rrc.selfSkill.levels.length === 0 && (
                      <p className="text-xs text-muted-foreground">No skill levels defined yet. Add at least one level to enable this rating type.</p>
                    )}
                  </div>
                )}
              </div>
            </section>

            {/* ── Site Maintenance ──────────────────────────── */}
            <section className="bg-card border border-card-border rounded-lg p-5 space-y-4">
              <h2 className="text-sm font-semibold text-foreground uppercase tracking-wide">Site Maintenance</h2>
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-1">
                  <Label htmlFor="maintenance-mode" className="text-sm font-medium">Maintenance Mode</Label>
                  <p className="text-xs text-muted-foreground">When enabled, visitors see a maintenance notice instead of the normal site content. Admin pages are not affected.</p>
                  {form.maintenanceMode && (
                    <div className="flex items-center gap-1.5 mt-2 text-xs font-medium text-amber-600">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                      Site is currently in maintenance mode — public pages are hidden.
                    </div>
                  )}
                </div>
                <Switch id="maintenance-mode" data-testid="toggle-maintenance-mode" checked={form.maintenanceMode} onCheckedChange={v => update("maintenanceMode", v)} />
              </div>
            </section>

            {/* ── Save bar ──────────────────────────────────── */}
            <div className="flex items-center justify-end gap-3">
              {dirty && <p className="text-xs text-muted-foreground">You have unsaved changes</p>}
              <Button type="submit" data-testid="button-save-settings" disabled={updateSettings.isPending || !dirty} className="gap-2">
                <Settings className="w-4 h-4" />
                {updateSettings.isPending ? "Saving..." : "Save Settings"}
              </Button>
            </div>
          </form>
        )}
      </main>

      {/* ── Contact dialog ──────────────────────────────────── */}
      <Dialog open={contactDialog.open} onOpenChange={open => !open && closeContactDialog()}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>{contactDialog.open && contactDialog.mode === "add" ? "Add Contact Person" : "Edit Contact Person"}</DialogTitle></DialogHeader>
          <form onSubmit={saveContact} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="contact-name">Full Name *</Label>
              <Input id="contact-name" data-testid="input-contact-name" value={contactForm.name} onChange={e => setContactForm(f => ({ ...f, name: e.target.value }))} placeholder="Jane Smith" required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="contact-email">Email *</Label>
              <Input id="contact-email" data-testid="input-contact-email" type="email" value={contactForm.email} onChange={e => setContactForm(f => ({ ...f, email: e.target.value }))} placeholder="jane@example.com" required />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={closeContactDialog}>Cancel</Button>
              <Button type="submit" data-testid="button-save-contact">{contactDialog.open && contactDialog.mode === "add" ? "Add" : "Save"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Contact delete confirm ──────────────────────────── */}
      <AlertDialog open={deleteContactIdx !== null} onOpenChange={open => !open && setDeleteContactIdx(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this contact?</AlertDialogTitle>
            <AlertDialogDescription>{deleteContactIdx !== null && form.contactPersons[deleteContactIdx] ? `"${form.contactPersons[deleteContactIdx].name}" will be removed from the contact list.` : "This contact will be removed."}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDeleteContact} className="bg-destructive text-destructive-foreground hover:bg-destructive/90" data-testid="button-confirm-delete-contact">Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Location dialog ─────────────────────────────────── */}
      <Dialog open={locationDialog.open} onOpenChange={open => !open && closeLocationDialog()}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>{locationDialog.open && locationDialog.mode === "add" ? "Add Location" : "Edit Location"}</DialogTitle></DialogHeader>
          <form onSubmit={saveLocation} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="location-name">Venue Name *</Label>
              <Input id="location-name" data-testid="input-location-name" value={locationForm.name} onChange={e => setLocationForm(f => ({ ...f, name: e.target.value }))} placeholder="Chastain Park Tennis Center" required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="location-address">Address</Label>
              <Input id="location-address" data-testid="input-location-address" value={locationForm.address} onChange={e => setLocationForm(f => ({ ...f, address: e.target.value }))} placeholder="123 Main St, Atlanta, GA 30301" />
            </div>
            <div className="flex items-center justify-between pt-1">
              <div className="space-y-0.5">
                <Label htmlFor="loc-court-fee-enabled" className="text-sm font-medium">Court Fee Enabled</Label>
                <p className="text-xs text-muted-foreground">Charge a court fee at this venue.</p>
              </div>
              <Switch id="loc-court-fee-enabled" data-testid="input-location-court-fee-enabled" checked={locationForm.courtFeeEnabled} onCheckedChange={v => setLocationForm(f => ({ ...f, courtFeeEnabled: v }))} />
            </div>
            {locationForm.courtFeeEnabled && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="loc-member-fee">Member Fee ($)</Label>
                  <NumericInput id="loc-member-fee" data-testid="input-location-member-fee" min={0} step={0.01} value={locationForm.memberFee} onChange={v => setLocationForm(f => ({ ...f, memberFee: v }))} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="loc-non-member-fee">Non-Member Fee ($)</Label>
                  <NumericInput id="loc-non-member-fee" data-testid="input-location-non-member-fee" min={0} step={0.01} value={locationForm.nonMemberFee} onChange={v => setLocationForm(f => ({ ...f, nonMemberFee: v }))} />
                </div>
              </div>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={closeLocationDialog}>Cancel</Button>
              <Button type="submit" data-testid="button-save-location">{locationDialog.open && locationDialog.mode === "add" ? "Add" : "Save"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Event Role delete confirm ────────────────────────── */}
      <AlertDialog open={deleteEventRoleIdx !== null} onOpenChange={open => !open && setDeleteEventRoleIdx(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this event role?</AlertDialogTitle>
            <AlertDialogDescription>{deleteEventRoleIdx !== null && form.eventRoles[deleteEventRoleIdx] ? `"${form.eventRoles[deleteEventRoleIdx]}" will be removed from the event roles list.` : "This event role will be removed."}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDeleteEventRole} className="bg-destructive text-destructive-foreground hover:bg-destructive/90" data-testid="button-confirm-delete-event-role">Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Event Name delete confirm ────────────────────────── */}
      <AlertDialog open={deleteEventNameIdx !== null} onOpenChange={open => !open && setDeleteEventNameIdx(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this event name?</AlertDialogTitle>
            <AlertDialogDescription>{deleteEventNameIdx !== null && form.defaultEventNames[deleteEventNameIdx] ? `"${form.defaultEventNames[deleteEventNameIdx]}" will be removed from the default names list.` : "This event name will be removed."}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDeleteEventName} className="bg-destructive text-destructive-foreground hover:bg-destructive/90" data-testid="button-confirm-delete-event-name">Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Skill Level delete confirm ───────────────────────── */}
      <AlertDialog open={deleteSkillIdx !== null} onOpenChange={open => !open && setDeleteSkillIdx(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this skill level?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteSkillIdx !== null && rrc.selfSkill.levels[deleteSkillIdx]
                ? `"${rrc.selfSkill.levels[deleteSkillIdx].text}" will be removed. The order of remaining levels will be updated.`
                : "This skill level will be removed."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDeleteSkillLevel} className="bg-destructive text-destructive-foreground hover:bg-destructive/90" data-testid="button-confirm-delete-skill-level">Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Location delete confirm ─────────────────────────── */}
      <AlertDialog open={deleteLocationIdx !== null} onOpenChange={open => !open && setDeleteLocationIdx(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this location?</AlertDialogTitle>
            <AlertDialogDescription>{deleteLocationIdx !== null && form.defaultLocations[deleteLocationIdx] ? `"${form.defaultLocations[deleteLocationIdx].name}" will be removed from the locations list.` : "This location will be removed."}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDeleteLocation} className="bg-destructive text-destructive-foreground hover:bg-destructive/90" data-testid="button-confirm-delete-location">Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );

  function confirmDeleteEventName() {
    if (deleteEventNameIdx === null) return;
    if (editingEventNameIdx === deleteEventNameIdx) setEditingEventNameIdx(null);
    update("defaultEventNames", form.defaultEventNames.filter((_, idx) => idx !== deleteEventNameIdx), true);
    setDeleteEventNameIdx(null);
  }

  function confirmDeleteEventRole() {
    if (deleteEventRoleIdx === null) return;
    if (editingEventRoleIdx === deleteEventRoleIdx) setEditingEventRoleIdx(null);
    update("eventRoles", form.eventRoles.filter((_, idx) => idx !== deleteEventRoleIdx), true);
    setDeleteEventRoleIdx(null);
  }
}
