import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useGetSettings, useUpdateSettings, getGetSettingsQueryKey } from "@workspace/api-client-react";
import { RichTextEditor } from "@/components/rich-text-editor";
import { AdminNav } from "@/components/admin-nav";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { Settings, Plus, Trash2, Pencil, User, AlertTriangle, Users } from "lucide-react";
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

type ContactDialog = { open: false } | { open: true; mode: "add" } | { open: true; mode: "edit"; index: number; data: ContactPerson };

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
    contactPersons: [] as ContactPerson[],
    maintenanceMode: false,
    joinInstructions: "",
  });
  const [dirty, setDirty] = useState(false);
  const lastSyncedSettings = useRef<typeof settings | null>(null);

  useEffect(() => {
    if (settings && settings !== lastSyncedSettings.current) {
      lastSyncedSettings.current = settings;
      setForm({
        defaultTimezone: settings.defaultTimezone,
        rotatingPartnersDescription: settings.rotatingPartnersDescription,
        fixedPartnerDescription: settings.fixedPartnerDescription,
        contactPersons: (settings.contactPersons as ContactPerson[]) ?? [],
        maintenanceMode: settings.maintenanceMode ?? false,
        joinInstructions: (settings as any).joinInstructions ?? "",
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
            </section>

            {/* ── Partner Descriptions ─────────────────────── */}
            <section className="bg-card border border-card-border rounded-lg p-5 space-y-5">
              <div>
                <h2 className="text-sm font-semibold text-foreground uppercase tracking-wide">Partner Descriptions</h2>
                <p className="text-xs text-muted-foreground mt-0.5">Explanations of event formats shown to participants during registration.</p>
              </div>
              <div className="space-y-2">
                <Label className="flex items-center gap-2 text-sm font-medium"><Users className="w-4 h-4 text-muted-foreground" />Rotating Partners</Label>
                <RichTextEditor
                  value={form.rotatingPartnersDescription}
                  onChange={v => update("rotatingPartnersDescription", v)}
                  placeholder="Describe the rotating partners format — partners rotate each round, etc."
                  data-testid="editor-rotating-partners-description"
                />
              </div>
              <div className="space-y-2">
                <Label className="flex items-center gap-2 text-sm font-medium"><Users className="w-4 h-4 text-muted-foreground" />Fixed Partners</Label>
                <RichTextEditor
                  value={form.fixedPartnerDescription}
                  onChange={v => update("fixedPartnerDescription", v)}
                  placeholder="Describe the fixed partners format — teams stay together throughout the event, etc."
                  data-testid="editor-fixed-partner-description"
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

            {/* ── Club Join Instructions ────────────────────── */}
            <section className="bg-card border border-card-border rounded-lg p-5 space-y-4">
              <div>
                <h2 className="text-sm font-semibold text-foreground uppercase tracking-wide">Club Join Instructions</h2>
                <p className="text-xs text-muted-foreground mt-0.5">Instructions shown to participants on how to join the Atlanta DUPR Pickleball club.</p>
              </div>
              <RichTextEditor
                value={form.joinInstructions}
                onChange={v => update("joinInstructions", v)}
                placeholder="Explain how to join the club — steps to create a DUPR account, how to request membership, etc."
                data-testid="editor-join-instructions"
              />
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
    </div>
  );
}
