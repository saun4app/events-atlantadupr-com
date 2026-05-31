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
import { Settings, Plus, Trash2, Pencil, MapPin, User } from "lucide-react";
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
}

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
  });
  const [dirty, setDirty] = useState(false);
  const formInitialized = useRef(false);

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
  const [locationForm, setLocationForm] = useState({ name: "", address: "" });
  const [deleteLocationIdx, setDeleteLocationIdx] = useState<number | null>(null);

  function openAddLocation() {
    setLocationForm({ name: "", address: "" });
    setLocationDialog({ open: true, mode: "add" });
  }
  function openEditLocation(i: number) {
    setLocationForm({ name: form.defaultLocations[i].name, address: form.defaultLocations[i].address });
    setLocationDialog({ open: true, mode: "edit", index: i, data: form.defaultLocations[i] });
  }
  function closeLocationDialog() {
    setLocationDialog({ open: false });
  }
  function saveLocation(e: React.FormEvent) {
    e.preventDefault();
    if (!locationForm.name.trim()) return;
    if (locationDialog.open && locationDialog.mode === "add") {
      update("defaultLocations", [...form.defaultLocations, { id: genId(), name: locationForm.name.trim(), address: locationForm.address.trim() }]);
    } else if (locationDialog.open && locationDialog.mode === "edit") {
      update("defaultLocations", form.defaultLocations.map((loc, idx) =>
        idx === locationDialog.index ? { ...loc, name: locationForm.name.trim(), address: locationForm.address.trim() } : loc
      ));
    }
    setLocationDialog({ open: false });
  }
  function confirmDeleteLocation() {
    if (deleteLocationIdx === null) return;
    update("defaultLocations", form.defaultLocations.filter((_, idx) => idx !== deleteLocationIdx));
    setDeleteLocationIdx(null);
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
            </section>

            {/* ── Event Format Descriptions ─────────────────── */}
            <section className="bg-card border border-card-border rounded-lg p-5 space-y-4">
              <h2 className="text-sm font-semibold text-foreground uppercase tracking-wide">Event Format Descriptions</h2>
              <p className="text-xs text-muted-foreground -mt-2">These descriptions are shown to participants during event registration.</p>

              <div className="space-y-1.5">
                <Label>Rotating Partners Format</Label>
                <RichTextEditor
                  data-testid="editor-rotating-description"
                  value={form.rotatingPartnersDescription}
                  onChange={v => update("rotatingPartnersDescription", v)}
                  placeholder="Describe how rotating partners events work..."
                />
              </div>

              <div className="space-y-1.5">
                <Label>Fixed Partner Format</Label>
                <RichTextEditor
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
