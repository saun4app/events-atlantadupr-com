import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { useGetSettings, useUpdateSettings } from "@workspace/api-client-react";
import { AdminNav } from "@/components/admin-nav";
import { RichTextEditor } from "@/components/rich-text-editor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { Settings, Plus, Trash2, Pencil, MapPin, User, AlertTriangle, DollarSign, Tag } from "lucide-react";
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

interface ContactPerson {
  name: string;
  email: string;
}

interface DefaultLocation {
  id: string;
  name: string;
  address: string;
  memberFee?: number;
  nonMemberFee?: number;
  courtFeeEnabled?: boolean;
}

interface RatingRequirement {
  key: string;
  label: string;
}

function genId() {
  return `loc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

type ContactDialog = { open: false } | { open: true; mode: "add" } | { open: true; mode: "edit"; index: number; data: ContactPerson };
type LocationDialog = { open: false } | { open: true; mode: "add" } | { open: true; mode: "edit"; index: number; data: DefaultLocation };
type RatingDialog = { open: false } | { open: true };

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
    defaultEventDurationHours: 2,
    defaultRatingRequirements: [] as RatingRequirement[],
  });
  const [dirty, setDirty] = useState(false);
  const formInitialized = useRef(false);
  const [newEventName, setNewEventName] = useState("");
  const [editingEventNameIdx, setEditingEventNameIdx] = useState<number | null>(null);
  const [editEventNameValue, setEditEventNameValue] = useState("");

  useEffect(() => {
    if (settings && !formInitialized.current) {
      formInitialized.current = true;
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
        defaultEventDurationHours: (settings.defaultEventDurationHours as number) ?? 2,
        defaultRatingRequirements: (settings.defaultRatingRequirements as RatingRequirement[]) ?? [],
      });
    }
  }, [settings]);

  function update<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm(f => ({ ...f, [key]: value }));
    setDirty(true);
  }

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    updateSettings.mutate({ data: form }, {
      onSuccess: () => {
        toast({ title: "Settings saved" });
        setDirty(false);
      },
      onError: () => toast({ title: "Failed to save settings", variant: "destructive" }),
    });
  }

  // ── Contact Persons ──────────────────────────────────────────
  const [contactDialog, setContactDialog] = useState<ContactDialog>({ open: false });
  const [contactForm, setContactForm] = useState({ name: "", email: "" });
  const [deleteContactIdx, setDeleteContactIdx] = useState<number | null>(null);

  function openAddContact() {
    setContactForm({ name: "", email: "" });
    setContactDialog({ open: true, mode: "add" });
  }
  function openEditContact(i: number) {
    setContactForm({ ...form.contactPersons[i] });
    setContactDialog({ open: true, mode: "edit", index: i, data: form.contactPersons[i] });
  }
  function closeContactDialog() {
    setContactDialog({ open: false });
  }
  function saveContact(e: React.FormEvent) {
    e.preventDefault();
    if (!contactForm.name.trim() || !contactForm.email.trim()) return;
    if (contactDialog.open && contactDialog.mode === "add") {
      update("contactPersons", [...form.contactPersons, { name: contactForm.name.trim(), email: contactForm.email.trim() }]);
    } else if (contactDialog.open && contactDialog.mode === "edit") {
      update("contactPersons", form.contactPersons.map((c, idx) =>
        idx === contactDialog.index ? { name: contactForm.name.trim(), email: contactForm.email.trim() } : c
      ));
    }
    setContactDialog({ open: false });
  }
  function confirmDeleteContact() {
    if (deleteContactIdx === null) return;
    update("contactPersons", form.contactPersons.filter((_, idx) => idx !== deleteContactIdx));
    setDeleteContactIdx(null);
  }

  // ── Default Locations ────────────────────────────────────────
  const [locationDialog, setLocationDialog] = useState<LocationDialog>({ open: false });
  const [locationForm, setLocationForm] = useState({ name: "", address: "", memberFee: 0, nonMemberFee: 0, courtFeeEnabled: false });
  const [deleteLocationIdx, setDeleteLocationIdx] = useState<number | null>(null);

  function openAddLocation() {
    setLocationForm({ name: "", address: "", memberFee: 0, nonMemberFee: 0, courtFeeEnabled: false });
    setLocationDialog({ open: true, mode: "add" });
  }
  function openEditLocation(i: number) {
    const loc = form.defaultLocations[i];
    setLocationForm({ name: loc.name, address: loc.address, memberFee: loc.memberFee ?? 0, nonMemberFee: loc.nonMemberFee ?? 0, courtFeeEnabled: loc.courtFeeEnabled ?? false });
    setLocationDialog({ open: true, mode: "edit", index: i, data: loc });
  }
  function closeLocationDialog() {
    setLocationDialog({ open: false });
  }
  function saveLocation(e: React.FormEvent) {
    e.preventDefault();
    if (!locationForm.name.trim()) return;
    const locData: DefaultLocation = {
      id: locationDialog.open && locationDialog.mode === "edit" ? locationDialog.data.id : genId(),
      name: locationForm.name.trim(),
      address: locationForm.address.trim(),
      memberFee: locationForm.memberFee,
      nonMemberFee: locationForm.nonMemberFee,
      courtFeeEnabled: locationForm.courtFeeEnabled,
    };
    if (locationDialog.open && locationDialog.mode === "add") {
      update("defaultLocations", [...form.defaultLocations, locData]);
    } else if (locationDialog.open && locationDialog.mode === "edit") {
      update("defaultLocations", form.defaultLocations.map((loc, idx) =>
        idx === locationDialog.index ? locData : loc
      ));
    }
    setLocationDialog({ open: false });
  }
  function confirmDeleteLocation() {
    if (deleteLocationIdx === null) return;
    update("defaultLocations", form.defaultLocations.filter((_, idx) => idx !== deleteLocationIdx));
    setDeleteLocationIdx(null);
  }

  // ── Rating Requirements ──────────────────────────────────────
  const [newRatingKey, setNewRatingKey] = useState("");
  const [newRatingLabel, setNewRatingLabel] = useState("");
  const [editingRatingIdx, setEditingRatingIdx] = useState<number | null>(null);
  const [editRatingKey, setEditRatingKey] = useState("");
  const [editRatingLabel, setEditRatingLabel] = useState("");

  function addRatingRequirement() {
    const key = newRatingKey.trim();
    const label = newRatingLabel.trim();
    if (!key || !label) return;
    if (form.defaultRatingRequirements.some(r => r.key === key)) {
      return;
    }
    update("defaultRatingRequirements", [...form.defaultRatingRequirements, { key, label }]);
    setNewRatingKey("");
    setNewRatingLabel("");
  }
  function deleteRatingRequirement(i: number) {
    if (editingRatingIdx === i) setEditingRatingIdx(null);
    update("defaultRatingRequirements", form.defaultRatingRequirements.filter((_, idx) => idx !== i));
  }
  function startEditRatingRequirement(i: number) {
    setEditingRatingIdx(i);
    setEditRatingKey(form.defaultRatingRequirements[i].key);
    setEditRatingLabel(form.defaultRatingRequirements[i].label);
  }
  function cancelEditRatingRequirement() {
    setEditingRatingIdx(null);
  }
  function saveEditRatingRequirement() {
    if (editingRatingIdx === null) return;
    const key = editRatingKey.trim();
    const label = editRatingLabel.trim();
    if (!key || !label) return;
    if (form.defaultRatingRequirements.some((r, idx) => r.key === key && idx !== editingRatingIdx)) return;
    const updated = form.defaultRatingRequirements.map((r, idx) =>
      idx === editingRatingIdx ? { key, label } : r
    );
    update("defaultRatingRequirements", updated);
    setEditingRatingIdx(null);
  }

  return (
    <div className="min-h-screen bg-background">
      <AdminNav />
      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-6">
        <div className="mb-6">
          <h1 className="text-xl font-bold text-foreground">App Settings</h1>
          <p className="text-muted-foreground text-sm mt-0.5">Configure site-wide defaults and event descriptions</p>
        </div>

        {settingsLoading ? (
          <div className="space-y-4">
            {[1, 2, 3].map(i => <Skeleton key={i} className="h-16 w-full" />)}
          </div>
        ) : (
          <form onSubmit={handleSave} className="space-y-8">

            {/* ── General ──────────────────────────────────── */}
            <section className="bg-card border border-card-border rounded-lg p-5 space-y-4">
              <h2 className="text-sm font-semibold text-foreground uppercase tracking-wide">General</h2>

              <div className="space-y-1.5">
                <Label htmlFor="timezone">Default Timezone</Label>
                <Select value={form.defaultTimezone} onValueChange={v => update("defaultTimezone", v)}>
                  <SelectTrigger id="timezone" data-testid="select-timezone">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TIMEZONES.map(tz => (
                      <SelectItem key={tz} value={tz}>{tz}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">Used as the default timezone when displaying event times.</p>
              </div>

              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Rotating Partners</p>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="min-participants">Min Participants</Label>
                    <Input
                      id="min-participants"
                      data-testid="input-min-participants"
                      type="number"
                      min={2}
                      value={form.minParticipants}
                      onChange={e => update("minParticipants", Number(e.target.value))}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="max-participants">Max Participants</Label>
                    <Input
                      id="max-participants"
                      data-testid="input-max-participants"
                      type="number"
                      min={2}
                      value={form.maxParticipants}
                      onChange={e => update("maxParticipants", Number(e.target.value))}
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Fixed Partner</p>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="min-teams">Min Teams</Label>
                    <Input
                      id="min-teams"
                      data-testid="input-min-teams"
                      type="number"
                      min={1}
                      value={form.minTeams}
                      onChange={e => update("minTeams", Number(e.target.value))}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="max-teams">Max Teams</Label>
                    <Input
                      id="max-teams"
                      data-testid="input-max-teams"
                      type="number"
                      min={1}
                      value={form.maxTeams}
                      onChange={e => update("maxTeams", Number(e.target.value))}
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="event-duration">Default Event Duration (hours)</Label>
                <Input
                  id="event-duration"
                  data-testid="input-event-duration-hours"
                  type="number"
                  min={1}
                  max={24}
                  value={form.defaultEventDurationHours}
                  onChange={e => update("defaultEventDurationHours", Math.max(1, Number(e.target.value)))}
                />
                <p className="text-xs text-muted-foreground">Used to auto-calculate the end time when creating new events.</p>
              </div>
            </section>

            {/* ── Event Format Descriptions ─────────────────── */}
            <section className="bg-card border border-card-border rounded-lg p-5 space-y-4">
              <h2 className="text-sm font-semibold text-foreground uppercase tracking-wide">Event Format Descriptions</h2>
              <p className="text-xs text-muted-foreground -mt-2">These descriptions are shown to participants during event registration.</p>

              <div className="space-y-1.5">
                <Label>Rotating Partners Format</Label>
                <RichTextEditor
                  key="rotating"
                  data-testid="editor-rotating-description"
                  value={form.rotatingPartnersDescription}
                  onChange={v => update("rotatingPartnersDescription", v)}
                  placeholder="Describe how rotating partners events work..."
                />
              </div>

              <div className="space-y-1.5">
                <Label>Fixed Partner Format</Label>
                <RichTextEditor
                  key="fixed"
                  data-testid="editor-fixed-description"
                  value={form.fixedPartnerDescription}
                  onChange={v => update("fixedPartnerDescription", v)}
                  placeholder="Describe how fixed partner events work..."
                />
              </div>
            </section>

            {/* ── Contact Persons ───────────────────────────── */}
            <section className="bg-card border border-card-border rounded-lg p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-semibold text-foreground uppercase tracking-wide">Contact Persons</h2>
                  <p className="text-xs text-muted-foreground mt-0.5">People participants can reach out to for help.</p>
                </div>
                <Button
                  type="button" variant="outline" size="sm" className="gap-1.5"
                  data-testid="button-add-contact" onClick={openAddContact}
                >
                  <Plus className="w-3.5 h-3.5" /> Add Contact
                </Button>
              </div>

              {form.contactPersons.length === 0 ? (
                <div className="text-center py-6 text-muted-foreground">
                  <User className="w-8 h-8 mx-auto mb-2 opacity-20" />
                  <p className="text-sm">No contact persons added yet.</p>
                </div>
              ) : (
                <div className="divide-y divide-border rounded-md border border-border overflow-hidden">
                  {form.contactPersons.map((contact, i) => (
                    <div key={i} className="flex items-center gap-3 px-4 py-3 bg-background hover:bg-muted/30 transition-colors" data-testid={`contact-card-${i}`}>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">{contact.name}</p>
                        <p className="text-xs text-muted-foreground truncate">{contact.email}</p>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <Button
                          type="button" variant="ghost" size="sm"
                          className="text-muted-foreground hover:text-foreground h-7 w-7 p-0"
                          data-testid={`button-edit-contact-${i}`}
                          onClick={() => openEditContact(i)}
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                        <Button
                          type="button" variant="ghost" size="sm"
                          className="text-muted-foreground hover:text-destructive h-7 w-7 p-0"
                          data-testid={`button-delete-contact-${i}`}
                          onClick={() => setDeleteContactIdx(i)}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
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
                <Button
                  type="button" variant="outline" size="sm" className="gap-1.5"
                  data-testid="button-add-location" onClick={openAddLocation}
                >
                  <Plus className="w-3.5 h-3.5" /> Add Location
                </Button>
              </div>

              {form.defaultLocations.length === 0 ? (
                <div className="text-center py-6 text-muted-foreground">
                  <MapPin className="w-8 h-8 mx-auto mb-2 opacity-20" />
                  <p className="text-sm">No default locations added yet.</p>
                </div>
              ) : (
                <div className="divide-y divide-border rounded-md border border-border overflow-hidden">
                  {form.defaultLocations.map((loc, i) => (
                    <div key={loc.id} className="flex items-center gap-3 px-4 py-3 bg-background hover:bg-muted/30 transition-colors" data-testid={`location-card-${i}`}>
                      <MapPin className="w-4 h-4 text-muted-foreground shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">{loc.name}</p>
                        <p className="text-xs text-muted-foreground truncate">{loc.address || "No address"}</p>
                        {loc.courtFeeEnabled && (
                          <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                            <DollarSign className="w-3 h-3" />
                            Member ${loc.memberFee ?? 0} / Non-member ${loc.nonMemberFee ?? 0}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <Button
                          type="button" variant="ghost" size="sm"
                          className="text-muted-foreground hover:text-foreground h-7 w-7 p-0"
                          data-testid={`button-edit-location-${i}`}
                          onClick={() => openEditLocation(i)}
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                        <Button
                          type="button" variant="ghost" size="sm"
                          className="text-muted-foreground hover:text-destructive h-7 w-7 p-0"
                          data-testid={`button-delete-location-${i}`}
                          onClick={() => setDeleteLocationIdx(i)}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
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
                          <Input
                            data-testid={`input-edit-event-name-${i}`}
                            value={editEventNameValue}
                            onChange={e => setEditEventNameValue(e.target.value)}
                            className="flex-1 h-7 text-sm"
                            onKeyDown={e => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                const v = editEventNameValue.trim();
                                if (v && !form.defaultEventNames.some((n, idx) => n === v && idx !== i)) {
                                  update("defaultEventNames", form.defaultEventNames.map((n, idx) => idx === i ? v : n));
                                  setEditingEventNameIdx(null);
                                }
                              }
                              if (e.key === "Escape") setEditingEventNameIdx(null);
                            }}
                            autoFocus
                          />
                          <Button
                            type="button" variant="ghost" size="sm"
                            className="text-primary h-7 px-2 shrink-0 text-xs"
                            data-testid={`button-save-event-name-${i}`}
                            onClick={() => {
                              const v = editEventNameValue.trim();
                              if (v && !form.defaultEventNames.some((n, idx) => n === v && idx !== i)) {
                                update("defaultEventNames", form.defaultEventNames.map((n, idx) => idx === i ? v : n));
                                setEditingEventNameIdx(null);
                              }
                            }}
                          >Save</Button>
                          <Button
                            type="button" variant="ghost" size="sm"
                            className="text-muted-foreground h-7 px-2 shrink-0 text-xs"
                            data-testid={`button-cancel-event-name-${i}`}
                            onClick={() => setEditingEventNameIdx(null)}
                          >Cancel</Button>
                        </>
                      ) : (
                        <>
                          <span className="flex-1 text-sm text-foreground truncate">{name}</span>
                          <Button
                            type="button" variant="ghost" size="sm"
                            className="text-muted-foreground hover:text-foreground h-7 w-7 p-0 shrink-0"
                            data-testid={`button-edit-event-name-${i}`}
                            onClick={() => { setEditingEventNameIdx(i); setEditEventNameValue(name); }}
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </Button>
                          <Button
                            type="button" variant="ghost" size="sm"
                            className="text-muted-foreground hover:text-destructive h-7 w-7 p-0 shrink-0"
                            data-testid={`button-delete-event-name-${i}`}
                            onClick={() => {
                              if (editingEventNameIdx === i) setEditingEventNameIdx(null);
                              update("defaultEventNames", form.defaultEventNames.filter((_, idx) => idx !== i));
                            }}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              )}

              <div className="flex gap-2">
                <Input
                  data-testid="input-new-event-name"
                  value={newEventName}
                  onChange={e => setNewEventName(e.target.value)}
                  placeholder="Saturday Morning Round Robin"
                  onKeyDown={e => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      const trimmed = newEventName.trim();
                      if (trimmed && !form.defaultEventNames.includes(trimmed)) {
                        update("defaultEventNames", [...form.defaultEventNames, trimmed]);
                        setNewEventName("");
                      }
                    }
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-1.5 shrink-0"
                  data-testid="button-add-event-name"
                  onClick={() => {
                    const trimmed = newEventName.trim();
                    if (trimmed && !form.defaultEventNames.includes(trimmed)) {
                      update("defaultEventNames", [...form.defaultEventNames, trimmed]);
                      setNewEventName("");
                    }
                  }}
                >
                  <Plus className="w-3.5 h-3.5" /> Add
                </Button>
              </div>
            </section>

            {/* ── Rating Requirements ─────────────────────── */}
            <section className="bg-card border border-card-border rounded-lg p-5 space-y-4">
              <div>
                <h2 className="text-sm font-semibold text-foreground uppercase tracking-wide">Rating Requirements</h2>
                <p className="text-xs text-muted-foreground mt-0.5">Options shown in the Rating Requirement dropdown when creating new events.</p>
              </div>

              {form.defaultRatingRequirements.length > 0 && (
                <div className="divide-y divide-border rounded-md border border-border overflow-hidden">
                  {form.defaultRatingRequirements.map((req, i) => (
                    <div key={req.key} className="flex items-center gap-3 px-4 py-2.5 bg-background hover:bg-muted/30 transition-colors" data-testid={`rating-req-row-${i}`}>
                      {editingRatingIdx === i ? (
                        <>
                          <Input
                            data-testid={`input-edit-rating-key-${i}`}
                            value={editRatingKey}
                            onChange={e => setEditRatingKey(e.target.value)}
                            placeholder="key"
                            className="w-28 shrink-0 h-7 text-xs font-mono"
                            onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); saveEditRatingRequirement(); } if (e.key === "Escape") cancelEditRatingRequirement(); }}
                          />
                          <Input
                            data-testid={`input-edit-rating-label-${i}`}
                            value={editRatingLabel}
                            onChange={e => setEditRatingLabel(e.target.value)}
                            placeholder="Label"
                            className="flex-1 h-7 text-xs"
                            onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); saveEditRatingRequirement(); } if (e.key === "Escape") cancelEditRatingRequirement(); }}
                          />
                          <Button
                            type="button" variant="ghost" size="sm"
                            className="text-primary hover:text-primary h-7 px-2 shrink-0 text-xs"
                            data-testid={`button-save-rating-req-${i}`}
                            onClick={saveEditRatingRequirement}
                          >
                            Save
                          </Button>
                          <Button
                            type="button" variant="ghost" size="sm"
                            className="text-muted-foreground h-7 px-2 shrink-0 text-xs"
                            data-testid={`button-cancel-rating-req-${i}`}
                            onClick={cancelEditRatingRequirement}
                          >
                            Cancel
                          </Button>
                        </>
                      ) : (
                        <>
                          <Tag className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm text-foreground truncate">{req.label}</p>
                          </div>
                          <Button
                            type="button" variant="ghost" size="sm"
                            className="text-muted-foreground hover:text-foreground h-7 w-7 p-0 shrink-0"
                            data-testid={`button-edit-rating-req-${i}`}
                            onClick={() => startEditRatingRequirement(i)}
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </Button>
                          <Button
                            type="button" variant="ghost" size="sm"
                            className="text-muted-foreground hover:text-destructive h-7 w-7 p-0 shrink-0"
                            data-testid={`button-delete-rating-req-${i}`}
                            onClick={() => deleteRatingRequirement(i)}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              )}

              <div className="flex gap-2">
                <Input
                  data-testid="input-new-rating-key"
                  value={newRatingKey}
                  onChange={e => setNewRatingKey(e.target.value)}
                  placeholder="key (e.g. dupr)"
                  className="w-32 shrink-0"
                  onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addRatingRequirement(); } }}
                />
                <Input
                  data-testid="input-new-rating-label"
                  value={newRatingLabel}
                  onChange={e => setNewRatingLabel(e.target.value)}
                  placeholder="Label (e.g. DUPR Required)"
                  onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addRatingRequirement(); } }}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-1.5 shrink-0"
                  data-testid="button-add-rating-req"
                  onClick={addRatingRequirement}
                >
                  <Plus className="w-3.5 h-3.5" /> Add
                </Button>
              </div>
            </section>

            {/* ── Site Maintenance ──────────────────────────── */}
            <section className="bg-card border border-card-border rounded-lg p-5 space-y-4">
              <h2 className="text-sm font-semibold text-foreground uppercase tracking-wide">Site Maintenance</h2>

              <div className="flex items-start justify-between gap-4">
                <div className="space-y-1">
                  <Label htmlFor="maintenance-mode" className="text-sm font-medium">Maintenance Mode</Label>
                  <p className="text-xs text-muted-foreground">
                    When enabled, visitors see a maintenance notice instead of the normal site content. Admin pages are not affected.
                  </p>
                  {form.maintenanceMode && (
                    <div className="flex items-center gap-1.5 mt-2 text-xs font-medium text-amber-600">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                      Site is currently in maintenance mode — public pages are hidden.
                    </div>
                  )}
                </div>
                <Switch
                  id="maintenance-mode"
                  data-testid="toggle-maintenance-mode"
                  checked={form.maintenanceMode}
                  onCheckedChange={v => update("maintenanceMode", v)}
                />
              </div>
            </section>

            {/* ── Save bar ──────────────────────────────────── */}
            <div className="flex items-center justify-end gap-3">
              {dirty && <p className="text-xs text-muted-foreground">You have unsaved changes</p>}
              <Button
                type="submit"
                data-testid="button-save-settings"
                disabled={updateSettings.isPending || !dirty}
                className="gap-2"
              >
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
          <DialogHeader>
            <DialogTitle>{contactDialog.open && contactDialog.mode === "add" ? "Add Contact Person" : "Edit Contact Person"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={saveContact} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="contact-name">Full Name *</Label>
              <Input
                id="contact-name"
                data-testid="input-contact-name"
                value={contactForm.name}
                onChange={e => setContactForm(f => ({ ...f, name: e.target.value }))}
                placeholder="Jane Smith"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="contact-email">Email *</Label>
              <Input
                id="contact-email"
                data-testid="input-contact-email"
                type="email"
                value={contactForm.email}
                onChange={e => setContactForm(f => ({ ...f, email: e.target.value }))}
                placeholder="jane@example.com"
                required
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={closeContactDialog}>Cancel</Button>
              <Button type="submit" data-testid="button-save-contact">
                {contactDialog.open && contactDialog.mode === "add" ? "Add" : "Save"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Contact delete confirm ──────────────────────────── */}
      <AlertDialog open={deleteContactIdx !== null} onOpenChange={open => !open && setDeleteContactIdx(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this contact?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteContactIdx !== null && form.contactPersons[deleteContactIdx]
                ? `"${form.contactPersons[deleteContactIdx].name}" will be removed from the contact list.`
                : "This contact will be removed."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDeleteContact}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-delete-contact"
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Location dialog ─────────────────────────────────── */}
      <Dialog open={locationDialog.open} onOpenChange={open => !open && closeLocationDialog()}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{locationDialog.open && locationDialog.mode === "add" ? "Add Location" : "Edit Location"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={saveLocation} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="location-name">Venue Name *</Label>
              <Input
                id="location-name"
                data-testid="input-location-name"
                value={locationForm.name}
                onChange={e => setLocationForm(f => ({ ...f, name: e.target.value }))}
                placeholder="Chastain Park Tennis Center"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="location-address">Address</Label>
              <Input
                id="location-address"
                data-testid="input-location-address"
                value={locationForm.address}
                onChange={e => setLocationForm(f => ({ ...f, address: e.target.value }))}
                placeholder="123 Main St, Atlanta, GA 30301"
              />
            </div>
            <div className="flex items-center justify-between pt-1">
              <div className="space-y-0.5">
                <Label htmlFor="loc-court-fee-enabled" className="text-sm font-medium">Court Fee Enabled</Label>
                <p className="text-xs text-muted-foreground">Charge a court fee at this venue.</p>
              </div>
              <Switch
                id="loc-court-fee-enabled"
                data-testid="input-location-court-fee-enabled"
                checked={locationForm.courtFeeEnabled}
                onCheckedChange={v => setLocationForm(f => ({ ...f, courtFeeEnabled: v }))}
              />
            </div>
            {locationForm.courtFeeEnabled && (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="loc-member-fee">Member Fee ($)</Label>
                  <Input
                    id="loc-member-fee"
                    data-testid="input-location-member-fee"
                    type="number"
                    min={0}
                    step={0.01}
                    value={locationForm.memberFee}
                    onChange={e => setLocationForm(f => ({ ...f, memberFee: Number(e.target.value) }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="loc-non-member-fee">Non-Member Fee ($)</Label>
                  <Input
                    id="loc-non-member-fee"
                    data-testid="input-location-non-member-fee"
                    type="number"
                    min={0}
                    step={0.01}
                    value={locationForm.nonMemberFee}
                    onChange={e => setLocationForm(f => ({ ...f, nonMemberFee: Number(e.target.value) }))}
                  />
                </div>
              </div>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={closeLocationDialog}>Cancel</Button>
              <Button type="submit" data-testid="button-save-location">
                {locationDialog.open && locationDialog.mode === "add" ? "Add" : "Save"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Location delete confirm ─────────────────────────── */}
      <AlertDialog open={deleteLocationIdx !== null} onOpenChange={open => !open && setDeleteLocationIdx(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this location?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteLocationIdx !== null && form.defaultLocations[deleteLocationIdx]
                ? `"${form.defaultLocations[deleteLocationIdx].name}" will be removed from the locations list.`
                : "This location will be removed."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDeleteLocation}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-delete-location"
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
