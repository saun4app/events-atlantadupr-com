import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useGetSettings, useUpdateSettings } from "@workspace/api-client-react";
import { AdminNav } from "@/components/admin-nav";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { Settings, Plus, Trash2 } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

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
    contactPersons: [] as ContactPerson[],
  });

  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (settings) {
      setForm({
        defaultTimezone: settings.defaultTimezone,
        rotatingPartnersDescription: settings.rotatingPartnersDescription,
        fixedPartnerDescription: settings.fixedPartnerDescription,
        minParticipants: settings.minParticipants,
        maxParticipants: settings.maxParticipants,
        contactPersons: (settings.contactPersons as ContactPerson[]) ?? [],
      });
      setDirty(false);
    }
  }, [settings]);

  function update<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm(f => ({ ...f, [key]: value }));
    setDirty(true);
  }

  function addContact() {
    update("contactPersons", [...form.contactPersons, { name: "", email: "" }]);
  }

  function updateContact(i: number, field: keyof ContactPerson, value: string) {
    const updated = form.contactPersons.map((c, idx) => idx === i ? { ...c, [field]: value } : c);
    update("contactPersons", updated);
  }

  function removeContact(i: number) {
    update("contactPersons", form.contactPersons.filter((_, idx) => idx !== i));
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

            <section className="bg-card border border-card-border rounded-lg p-5 space-y-4">
              <h2 className="text-sm font-semibold text-foreground uppercase tracking-wide">General</h2>

              <div className="space-y-1.5">
                <Label htmlFor="timezone">Default Timezone</Label>
                <Select
                  value={form.defaultTimezone}
                  onValueChange={v => update("defaultTimezone", v)}
                >
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

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="min-participants">Default Min Participants</Label>
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
                  <Label htmlFor="max-participants">Default Max Participants</Label>
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
            </section>

            <section className="bg-card border border-card-border rounded-lg p-5 space-y-4">
              <h2 className="text-sm font-semibold text-foreground uppercase tracking-wide">Event Format Descriptions</h2>
              <p className="text-xs text-muted-foreground -mt-2">These descriptions are shown to participants during event registration.</p>

              <div className="space-y-1.5">
                <Label htmlFor="rotating-desc">Rotating Partners Format</Label>
                <Textarea
                  id="rotating-desc"
                  data-testid="textarea-rotating-description"
                  rows={3}
                  value={form.rotatingPartnersDescription}
                  onChange={e => update("rotatingPartnersDescription", e.target.value)}
                  placeholder="Describe how rotating partners events work..."
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="fixed-desc">Fixed Partner Format</Label>
                <Textarea
                  id="fixed-desc"
                  data-testid="textarea-fixed-description"
                  rows={3}
                  value={form.fixedPartnerDescription}
                  onChange={e => update("fixedPartnerDescription", e.target.value)}
                  placeholder="Describe how fixed partner events work..."
                />
              </div>
            </section>

            <section className="bg-card border border-card-border rounded-lg p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-semibold text-foreground uppercase tracking-wide">Contact Persons</h2>
                  <p className="text-xs text-muted-foreground mt-0.5">People participants can reach out to for help.</p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  data-testid="button-add-contact"
                  onClick={addContact}
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add Contact
                </Button>
              </div>

              {form.contactPersons.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">No contact persons added yet.</p>
              ) : (
                <div className="space-y-3">
                  {form.contactPersons.map((contact, i) => (
                    <div key={i} className="flex items-start gap-3">
                      <div className="flex-1 grid grid-cols-2 gap-3">
                        <Input
                          data-testid={`input-contact-name-${i}`}
                          placeholder="Full Name"
                          value={contact.name}
                          onChange={e => updateContact(i, "name", e.target.value)}
                        />
                        <Input
                          data-testid={`input-contact-email-${i}`}
                          placeholder="email@example.com"
                          type="email"
                          value={contact.email}
                          onChange={e => updateContact(i, "email", e.target.value)}
                        />
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="text-muted-foreground hover:text-destructive mt-0.5"
                        data-testid={`button-remove-contact-${i}`}
                        onClick={() => removeContact(i)}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </section>

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
    </div>
  );
}
