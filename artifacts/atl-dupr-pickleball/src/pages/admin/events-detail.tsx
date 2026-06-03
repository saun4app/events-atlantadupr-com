import { useState, useEffect } from "react";
import { useParams, useLocation, Link } from "wouter";
import {
  useGetEvent, useListRegistrations, useUpdateEvent, useDeleteEvent, useUpdateRegistration,
  useCreateRegistration, useGetSettings,
  getGetEventQueryKey, getListRegistrationsQueryKey, getGetEventRosterSummaryQueryKey,
  getListEventsQueryKey, getGetEventsSummaryQueryKey
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { AdminNav } from "@/components/admin-nav";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { RichTextEditor } from "@/components/rich-text-editor";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { ChevronLeft, ChevronRight, UserPlus, Trash2, CheckCircle, XCircle, Clock, List, ArrowUp, ArrowDown, ChevronsUpDown, MapPin, Calendar, Pencil, X, ChevronDown, Star, Mail } from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";

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

function getRrc(settings: any): RatingRequirementsConfig {
  const rrc = (settings as any)?.ratingRequirementsConfig ?? DEFAULT_RRC;
  return {
    dupr: { ...DEFAULT_RRC.dupr, ...(rrc.dupr ?? {}) },
    selfNumeric: { ...DEFAULT_RRC.selfNumeric, ...(rrc.selfNumeric ?? {}) },
    selfSkill: { ...DEFAULT_RRC.selfSkill, ...(rrc.selfSkill ?? {}) },
  };
}

function ratingTypeLabel(type: string): string {
  switch (type) {
    case "dupr": return "DUPR Rating";
    case "self_numeric": return "Self-Rating (Numeric)";
    case "self_skill": return "Self-Rating (Skill Level)";
    default: return "None";
  }
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; className: string }> = {
    confirmed: { label: "Confirmed", className: "bg-primary/10 text-primary border-primary/20 border" },
    waitlisted: { label: "Waitlisted", className: "bg-yellow-100 text-yellow-700 border-yellow-200 border" },
    pending_approval: { label: "Pending", className: "bg-blue-100 text-blue-700 border-blue-200 border" },
    rejected: { label: "Rejected", className: "bg-destructive/10 text-destructive border-destructive/20 border" },
    cancelled: { label: "Cancelled", className: "bg-muted text-muted-foreground border border-border" },
  };
  const s = map[status] ?? { label: status, className: "" };
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${s.className}`}>{s.label}</span>;
}

function isNonNumeric(rating: string | null | undefined): boolean {
  if (!rating) return false;
  return isNaN(parseFloat(rating)) || rating === "NR";
}

function SortHeader({ label, col, activeCol, dir, onSort }: {
  label: string; col: string; activeCol?: string; dir?: "asc" | "desc"; onSort: () => void;
}) {
  const isActive = activeCol === col;
  return (
    <th className="text-left px-5 py-2.5 font-medium text-muted-foreground cursor-pointer select-none hover:text-foreground group whitespace-nowrap" onClick={onSort}>
      <span className="inline-flex items-center gap-1">
        {label}
        {isActive
          ? (dir === "asc" ? <ArrowUp className="w-3 h-3 text-primary" /> : <ArrowDown className="w-3 h-3 text-primary" />)
          : <ChevronsUpDown className="w-3 h-3 opacity-0 group-hover:opacity-40" />}
      </span>
    </th>
  );
}

function toLocalInput(dt: string | null | undefined): string {
  if (!dt) return "";
  try { return new Date(dt).toISOString().slice(0, 16); } catch { return ""; }
}

export default function AdminEventDetail() {
  const { id } = useParams<{ id: string }>();
  const eventId = Number(id);
  const { isAuthenticated, isLoading, user, canAccessAdmin } = useAuth();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) setLocation("/login");
    if (!isLoading && isAuthenticated && !canAccessAdmin) setLocation("/");
  }, [isLoading, isAuthenticated, canAccessAdmin]);

  const { data: event, isLoading: evLoading } = useGetEvent(eventId, {
    query: { enabled: !!eventId, queryKey: getGetEventQueryKey(eventId) }
  });
  const { data: registrations, isLoading: regLoading } = useListRegistrations(eventId, {
    query: { enabled: !!eventId, queryKey: getListRegistrationsQueryKey(eventId) }
  });
  const { data: settings } = useGetSettings();
  const eventRolesList: string[] = ((settings as any)?.eventRoles as string[] | undefined) ?? [];
  const eventContactEmails: string[] = ((settings as any)?.eventContactEmails as string[] | undefined) ?? [];
  const isAdminOrOrganizer = user?.role === "admin" || user?.role === "event_organizer";


  const updateEvent = useUpdateEvent();
  const deleteEvent = useDeleteEvent();
  const updateReg = useUpdateRegistration();
  const createReg = useCreateRegistration();
  const [showDeleteEventDialog, setShowDeleteEventDialog] = useState(false);
  const [addEmails, setAddEmails] = useState("");
  const [addPartnerDuprId, setAddPartnerDuprId] = useState("");
  const [notFoundEmails, setNotFoundEmails] = useState<string[]>([]);
  const [visibleCols, setVisibleCols] = useState<Set<string>>(
    () => new Set(["name", "duprId", "dupr", "assigned", "status", "new", "role", "email", "phone", "signedUp"])
  );
  const toggleCol = (k: string) => setVisibleCols(prev => { const next = new Set(prev); if (next.has(k)) next.delete(k); else next.add(k); return next; });
  const col = (k: string) => visibleCols.has(k);

  const [showEditDialog, setShowEditDialog] = useState(false);
  const [editForm, setEditForm] = useState<Record<string, any>>({});
  const [editRatingConfig, setEditRatingConfig] = useState<any>(null);


  const rrc = getRrc(settings);

  const [sortState, setSortState] = useState<Record<string, { col: string; dir: "asc" | "desc" }>>({});
  const [pageNums, setPageNums] = useState<Record<string, number>>({});
  const [pageSize, setPageSize] = useState(25);
  const [editingRatings, setEditingRatings] = useState<Record<number, string>>({});

  const enabledRatingTypes = [
    { key: "none", label: "No Rating Required" },
    ...(rrc.dupr.enabled ? [{ key: "dupr", label: "DUPR Rating" }] : []),
    ...(rrc.selfNumeric.enabled ? [{ key: "self_numeric", label: "Self-Rating (Numeric)" }] : []),
    ...(rrc.selfSkill.enabled ? [{ key: "self_skill", label: "Self-Rating (Skill Level)" }] : []),
  ];

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: getListRegistrationsQueryKey(eventId) });
    queryClient.invalidateQueries({ queryKey: getGetEventRosterSummaryQueryKey(eventId) });
  }

  function invalidateEvent() {
    queryClient.invalidateQueries({ queryKey: getGetEventQueryKey(eventId) });
    queryClient.invalidateQueries({ queryKey: getListEventsQueryKey({}) });
  }

  function sortRegs(regs: any[], key: string) {
    const s = sortState[key];
    if (!s) return regs;
    const statusOrder: Record<string, number> = { confirmed: 0, pending_approval: 1, waitlisted: 2, rejected: 3, cancelled: 4 };
    return [...regs].sort((a, b) => {
      let av: any, bv: any;
      if (s.col === "name") { av = (a.playerName ?? "").toLowerCase(); bv = (b.playerName ?? "").toLowerCase(); }
      else if (s.col === "dupr") { av = parseFloat(a.doubleRating) || 0; bv = parseFloat(b.doubleRating) || 0; }
      else if (s.col === "assigned") {
        const aParsed = parseFloat(a.doubleRating); const bParsed = parseFloat(b.doubleRating);
        av = a.assignedRating != null ? a.assignedRating : (isFinite(aParsed) ? aParsed : 0);
        bv = b.assignedRating != null ? b.assignedRating : (isFinite(bParsed) ? bParsed : 0);
      }
      else if (s.col === "status") { av = statusOrder[a.status] ?? 99; bv = statusOrder[b.status] ?? 99; }
      else if (s.col === "new") { av = a.isNew ? 1 : 0; bv = b.isNew ? 1 : 0; }
      else if (s.col === "role") { av = (a.eventRole ?? "").toLowerCase(); bv = (b.eventRole ?? "").toLowerCase(); }
      else if (s.col === "partner") { av = (a.partnerName ?? "").toLowerCase(); bv = (b.partnerName ?? "").toLowerCase(); }
      else if (s.col === "email") { av = ((a as any).playerEmail ?? "").toLowerCase(); bv = ((b as any).playerEmail ?? "").toLowerCase(); }
      else if (s.col === "phone") { av = ((a as any).playerPhone ?? "").toLowerCase(); bv = ((b as any).playerPhone ?? "").toLowerCase(); }
      else if (s.col === "signedUp") { av = new Date(a.registeredAt).getTime(); bv = new Date(b.registeredAt).getTime(); }
      else return 0;
      if (typeof av === "string") return s.dir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      return s.dir === "asc" ? av - bv : bv - av;
    });
  }

  function toggleSort(key: string, col: string) {
    setSortState(prev => {
      const cur = prev[key];
      if (cur?.col === col) return { ...prev, [key]: { col, dir: cur.dir === "asc" ? "desc" : "asc" } };
      return { ...prev, [key]: { col, dir: "asc" } };
    });
    setPageNums(prev => ({ ...prev, [key]: 0 }));
  }

  function openEditDialog() {
    if (!event) return;
    setEditForm({
      name: event.name ?? "",
      description: event.description ?? "",
      startDatetime: toLocalInput(event.startDatetime),
      endDatetime: toLocalInput(event.endDatetime),
      locationName: event.locationName ?? "",
      locationAddress: event.locationAddress ?? "",
      teamFormat: event.teamFormat ?? "rotating",
      ratingTypeRequired: event.ratingTypeRequired ?? "none",
      minParticipants: String(event.minParticipants ?? ""),
      maxParticipants: String(event.maxParticipants ?? ""),
      waitlistEnabled: event.waitlistEnabled ?? false,
      requireApproval: (event.requireApproval as any) || "none",
      signupStartDatetime: toLocalInput(event.signupStartDatetime),
      signupEndDatetime: toLocalInput(event.signupEndDatetime),
      status: event.status ?? "upcoming",
      contactEmail: (event as any).contactEmail ?? "",
      courtFeeEnabled: (event as any).courtFeeEnabled ?? false,
      memberFee: String((event as any).memberFee ?? ""),
      nonMemberFee: String((event as any).nonMemberFee ?? ""),
    });
    setEditRatingConfig((event as any).ratingConfig ?? null);
    setShowEditDialog(true);
  }

  function handleEditRatingTypeChange(type: string) {
    setEditForm((f: any) => ({ ...f, ratingTypeRequired: type }));
    if (type === "none") {
      setEditRatingConfig(null);
    } else if (type === "dupr") {
      setEditRatingConfig({ min: rrc.dupr.defaultMin, max: rrc.dupr.defaultMax, nrAllowed: rrc.dupr.defaultNrAllowed });
    } else if (type === "self_numeric") {
      setEditRatingConfig({ min: rrc.selfNumeric.defaultMin, max: rrc.selfNumeric.defaultMax });
    } else if (type === "self_skill") {
      setEditRatingConfig({ minLevel: rrc.selfSkill.defaultMinLevel, maxLevel: rrc.selfSkill.defaultMaxLevel });
    }
  }

  function handleDeleteEvent() {
    deleteEvent.mutate({ id: eventId }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListEventsQueryKey({}) });
        queryClient.invalidateQueries({ queryKey: getGetEventsSummaryQueryKey() });
        setLocation("/admin/events");
      },
      onError: () => toast({ title: "Delete failed", variant: "destructive" }),
    });
  }

  function handleEditSubmit(e: React.FormEvent) {
    e.preventDefault();
    updateEvent.mutate({
      id: eventId,
      data: {
        name: editForm.name || undefined,
        description: editForm.description || null,
        startDatetime: editForm.startDatetime ? new Date(editForm.startDatetime).toISOString() : undefined,
        endDatetime: editForm.endDatetime ? new Date(editForm.endDatetime).toISOString() : undefined,
        locationName: editForm.locationName || undefined,
        locationAddress: editForm.locationAddress || undefined,
        teamFormat: editForm.teamFormat || undefined,
        ratingTypeRequired: editForm.ratingTypeRequired || undefined,
        ratingConfig: editForm.ratingTypeRequired !== "none" ? editRatingConfig : null,
        minParticipants: editForm.minParticipants ? Number(editForm.minParticipants) : undefined,
        maxParticipants: editForm.maxParticipants ? Number(editForm.maxParticipants) : undefined,
        waitlistEnabled: editForm.waitlistEnabled,
        requireApproval: editForm.requireApproval,
        signupStartDatetime: editForm.signupStartDatetime ? new Date(editForm.signupStartDatetime).toISOString() : undefined,
        signupEndDatetime: editForm.signupEndDatetime ? new Date(editForm.signupEndDatetime).toISOString() : undefined,
        status: editForm.status || undefined,
        contactEmail: editForm.contactEmail || null,
        courtFeeEnabled: editForm.courtFeeEnabled,
        memberFee: editForm.courtFeeEnabled ? (editForm.memberFee ? Number(editForm.memberFee) : 0) : undefined,
        nonMemberFee: editForm.courtFeeEnabled ? (editForm.nonMemberFee ? Number(editForm.nonMemberFee) : 0) : undefined,
      } as any
    }, {
      onSuccess: () => { toast({ title: "Event updated" }); invalidateEvent(); setShowEditDialog(false); },
      onError: () => toast({ title: "Failed to update event", variant: "destructive" }),
    });
  }

  function handleMoveToWaitlist(regId: number) { updateReg.mutate({ id: eventId, regId, data: { status: "waitlisted" } as any }, { onSuccess: () => { toast({ title: "Moved to waitlist" }); invalidate(); }, onError: () => toast({ title: "Failed", variant: "destructive" }) }); }
  function handleCancelReg(regId: number) { updateReg.mutate({ id: eventId, regId, data: { status: "cancelled" } as any }, { onSuccess: () => { toast({ title: "Registration cancelled" }); invalidate(); }, onError: () => toast({ title: "Failed", variant: "destructive" }) }); }
  function handleConfirmReg(regId: number) { updateReg.mutate({ id: eventId, regId, data: { status: "confirmed" } as any }, { onSuccess: () => { toast({ title: "Moved to confirmed" }); invalidate(); }, onError: () => toast({ title: "Failed", variant: "destructive" }) }); }
  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    const emails = addEmails.split(/[\s,]+/).map(s => s.trim().toLowerCase()).filter(Boolean);
    if (emails.length === 0) return;
    let succeeded = 0;
    const failures: string[] = [];
    const notFound: string[] = [];
    for (const email of emails) {
      try {
        await createReg.mutateAsync({ id: eventId, data: { email, partnerDuprId: event?.teamFormat === "fixed_partner" ? addPartnerDuprId.trim() || null : null } });
        succeeded++;
      } catch (err: any) {
        const msg = err?.data?.error || "";
        if (msg.toLowerCase().includes("no member found with that email") || msg.toLowerCase().includes("no member found with that dupr id")) {
          notFound.push(email);
        } else {
          failures.push(`${email}: ${msg || "failed"}`);
        }
      }
    }
    setNotFoundEmails(notFound);
    if (succeeded > 0) { toast({ title: `${succeeded} participant${succeeded !== 1 ? "s" : ""} added` }); setAddEmails(""); setAddPartnerDuprId(""); invalidate(); }
    if (failures.length > 0) toast({ title: failures.join(" · "), variant: "destructive" });
  }

  function formatRatingBadge(event: any): string {
    const type = event.ratingTypeRequired;
    const cfg = event.ratingConfig;
    if (type === "dupr" && cfg) return `DUPR ${cfg.min}–${cfg.max}${cfg.nrAllowed ? " / NR OK" : ""}`;
    if (type === "self_numeric" && cfg) return `Self-Rating ${cfg.min}–${cfg.max}`;
    if (type === "self_skill" && cfg) {
      const lv = rrc.selfSkill.levels.find((l: SkillLevel) => l.level === cfg.maxLevel);
      return lv ? `Skill: up to ${lv.text}` : "Skill Level Required";
    }
    if (type !== "none") return ratingTypeLabel(type);
    return "";
  }

  const confirmed = registrations?.filter(r => r.status === "confirmed") ?? [];
  const waitlisted = registrations?.filter(r => r.status === "waitlisted") ?? [];
  const pending = registrations?.filter(r => r.status === "pending_approval") ?? [];
  const rejected = registrations?.filter(r => r.status === "rejected") ?? [];
  const cancelled = registrations?.filter(r => r.status === "cancelled") ?? [];
  return (
    <div className="min-h-screen bg-background">
      <AdminNav />
      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-6">
        <Link href="/admin/events" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4">
          <ChevronLeft className="w-4 h-4" /> All Events
        </Link>

        {evLoading ? (
          <div className="space-y-4"><Skeleton className="h-40 w-full" /></div>
        ) : event ? (
          <>
            <div className="bg-card border border-card-border rounded-lg p-5 mb-6">
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <h1 className="text-xl font-bold text-foreground">{event.name}</h1>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground mt-2">
                    <span className="flex items-center gap-1"><Calendar className="w-3.5 h-3.5" />{format(new Date(event.startDatetime), "EEE, MMM d, yyyy 'at' h:mm a")}</span>
                    <span className="flex items-center gap-1"><MapPin className="w-3.5 h-3.5" />{event.locationName}</span>
                  </div>
                  <div className="flex gap-2 mt-3 flex-wrap">
                    <Badge variant="outline" className="text-xs">{event.teamFormat === "fixed_partner" ? "Fixed-Partner" : "Rotating"}</Badge>
                    {event.ratingTypeRequired !== "none" && (
                      <Badge variant="outline" className="text-xs">{formatRatingBadge(event)}</Badge>
                    )}
                    {event.requireApproval !== "none" && <Badge variant="outline" className="text-xs border-yellow-300 text-yellow-700">{event.requireApproval === "all" ? "Approval Required" : "NR Approval Required"}</Badge>}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Button data-testid="button-edit-event" variant="outline" size="sm" className="gap-1.5" onClick={openEditDialog}>
                    <Pencil className="w-3.5 h-3.5" /> Edit
                  </Button>
                  <Select value={event.status} onValueChange={(v) => updateEvent.mutate({ id: eventId, data: { status: v as any } }, { onSuccess: () => { toast({ title: "Status updated" }); invalidateEvent(); } })}>
                    <SelectTrigger data-testid="select-event-status" className="w-36"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="upcoming">Upcoming</SelectItem>
                      <SelectItem value="closed">Closed</SelectItem>
                      <SelectItem value="ended">Ended</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="mt-4 pt-4 border-t border-border flex gap-4 text-sm">
                <span><strong className="text-primary">{confirmed.length}</strong> confirmed</span>
                {pending.length > 0 && <span><strong className="text-blue-600">{pending.length}</strong> pending</span>}
                {waitlisted.length > 0 && <span><strong className="text-yellow-600">{waitlisted.length}</strong> waitlisted</span>}
                {rejected.length > 0 && <span><strong className="text-destructive">{rejected.length}</strong> rejected</span>}
                {cancelled.length > 0 && <span><strong className="text-muted-foreground">{cancelled.length}</strong> cancelled</span>}
                <span className="text-muted-foreground">/ {event.maxParticipants} max</span>
              </div>
              {(event as any).contactEmail && (
                <div className="mt-3 flex items-center gap-1.5 text-sm">
                  <Mail className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  <a href={`mailto:${(event as any).contactEmail}`} className="text-primary hover:underline">
                    {(event as any).contactEmail}
                  </a>
                </div>
              )}
            </div>

            <div className="bg-card border border-card-border rounded-lg p-5 mb-6">
              <h2 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide mb-3">Add Participant Manually</h2>
              <form onSubmit={handleAdd} className="flex items-start gap-3 flex-wrap">
                <div className="space-y-1.5">
                  <Label htmlFor="add-emails">Email Address(es)</Label>
                  <Textarea
                    id="add-emails"
                    data-testid="input-add-emails"
                    value={addEmails}
                    onChange={e => setAddEmails(e.target.value.toLowerCase())}
                    placeholder={"player@example.com\nplayer2@example.com, player3@example.com"}
                    className="w-72 h-20 text-sm font-mono resize-none"
                    required
                  />
                  <p className="text-xs text-muted-foreground">Separate multiple emails with commas, spaces, or new lines.</p>
                </div>
                {event.teamFormat === "fixed_partner" && (
                  <div className="space-y-1.5">
                    <Label htmlFor="add-partner">Partner DUPR ID</Label>
                    <Input id="add-partner" data-testid="input-add-partner-dupr-id" value={addPartnerDuprId} onChange={e => setAddPartnerDuprId(e.target.value.toUpperCase())} placeholder="ATL002" className="w-32 uppercase" />
                  </div>
                )}
                <Button type="submit" data-testid="button-add-participant" disabled={createReg.isPending} className="gap-1.5">
                  <UserPlus className="w-4 h-4" /> Add
                </Button>
              </form>
              {notFoundEmails.length > 0 && (
                <div className="mt-3 rounded-md border border-yellow-200 bg-yellow-50 p-3 text-sm">
                  <p className="font-medium text-yellow-800 mb-1">Not found in member list:</p>
                  <ul className="list-disc list-inside text-yellow-700">
                    {notFoundEmails.map(email => <li key={email}>{email}</li>)}
                  </ul>
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mb-4 px-1 py-2 bg-muted/30 rounded-md border border-border">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Columns:</span>
              {[
                { key: "name", label: "Name" },
                { key: "duprId", label: "DUPR ID" },
                ...(event.teamFormat === "fixed_partner" ? [{ key: "partner", label: "Partner" }] : []),
                { key: "dupr", label: "DUPR Double" },
                { key: "assigned", label: "Assigned" },
                { key: "status", label: "Status" },
                { key: "new", label: "New" },
                { key: "role", label: "Role" },
                { key: "email", label: "Email" },
                { key: "phone", label: "Phone" },
                { key: "signedUp", label: "Signed Up" },
              ].map(({ key, label }) => (
                <label key={key} className="flex items-center gap-1.5 text-xs cursor-pointer select-none">
                  <input
                    type="checkbox"
                    className="w-3.5 h-3.5 accent-primary cursor-pointer"
                    checked={col(key)}
                    onChange={() => toggleCol(key)}
                  />
                  {label}
                </label>
              ))}
            </div>

            {regLoading ? (
              <div className="space-y-3">{[1,2,3].map(i => <Skeleton key={i} className="h-12 w-full" />)}</div>
            ) : (
              <div className="space-y-6">
                {[
                  { label: "Confirmed", regs: confirmed, color: "text-primary" },
                  { label: "Pending Approval", regs: pending, color: "text-blue-600" },
                  { label: "Waitlisted", regs: waitlisted, color: "text-yellow-600" },
                  { label: "Rejected", regs: rejected, color: "text-muted-foreground" },
                  { label: "Cancelled", regs: cancelled, color: "text-muted-foreground" },
                ].map(section => {
                  if (section.regs.length === 0) return null;
                  const key = section.label;
                  const sorted = sortRegs(section.regs, key);
                  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
                  const curPage = Math.min(pageNums[key] ?? 0, totalPages - 1);
                  const paged = sorted.slice(curPage * pageSize, (curPage + 1) * pageSize);
                  const sortCol = sortState[key]?.col;
                  const sortDir = sortState[key]?.dir;
                  return (
                    <div key={key} className="bg-card border border-card-border rounded-lg overflow-hidden">
                      <div className="px-5 py-3 border-b border-border bg-muted/30 flex items-center justify-between flex-wrap gap-2">
                        <div>
                          <span className={`text-sm font-semibold ${section.color}`}>{section.label}</span>
                          <span className="ml-2 text-xs text-muted-foreground">({section.regs.length})</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground">Per page:</span>
                          <Select value={String(pageSize)} onValueChange={v => { setPageSize(Number(v)); setPageNums({}); }}>
                            <SelectTrigger className="h-6 w-16 text-xs px-2"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="10">10</SelectItem>
                              <SelectItem value="25">25</SelectItem>
                              <SelectItem value="50">50</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-border">
                              <th className="text-left px-5 py-2.5 font-medium text-muted-foreground w-10">#</th>
                              {col("name") && <SortHeader label="Name" col="name" activeCol={sortCol} dir={sortDir} onSort={() => toggleSort(key, "name")} />}
                              {col("duprId") && <th className="text-left px-5 py-2.5 font-medium text-muted-foreground">DUPR ID</th>}
                              {event.teamFormat === "fixed_partner" && col("partner") && <SortHeader label="Partner" col="partner" activeCol={sortCol} dir={sortDir} onSort={() => toggleSort(key, "partner")} />}
                              {col("dupr") && <SortHeader label="DUPR Double" col="dupr" activeCol={sortCol} dir={sortDir} onSort={() => toggleSort(key, "dupr")} />}
                              {col("assigned") && <SortHeader label="Assigned" col="assigned" activeCol={sortCol} dir={sortDir} onSort={() => toggleSort(key, "assigned")} />}
                              {col("status") && <SortHeader label="Status" col="status" activeCol={sortCol} dir={sortDir} onSort={() => toggleSort(key, "status")} />}
                              {col("new") && <SortHeader label="New" col="new" activeCol={sortCol} dir={sortDir} onSort={() => toggleSort(key, "new")} />}
                              {col("role") && <SortHeader label="Role" col="role" activeCol={sortCol} dir={sortDir} onSort={() => toggleSort(key, "role")} />}
                              {col("email") && <SortHeader label="Email" col="email" activeCol={sortCol} dir={sortDir} onSort={() => toggleSort(key, "email")} />}
                              {col("phone") && <SortHeader label="Phone" col="phone" activeCol={sortCol} dir={sortDir} onSort={() => toggleSort(key, "phone")} />}
                              {col("signedUp") && <SortHeader label="Signed Up" col="signedUp" activeCol={sortCol} dir={sortDir} onSort={() => toggleSort(key, "signedUp")} />}
                              <th className="text-right px-5 py-2.5 font-medium text-muted-foreground">Actions</th>
                            </tr>
                          </thead>
                          <tbody>
                            {paged.map((reg, idx) => {
                              const parsedDupr = parseFloat(reg.doubleRating);
                              const storedRating = reg.assignedRating != null ? reg.assignedRating : (reg.doubleRating && isFinite(parsedDupr) ? parsedDupr : null);
                              const editVal = editingRatings[reg.id] !== undefined ? editingRatings[reg.id] : (storedRating != null ? String(storedRating) : "");
                              const saveRating = (val: string) => {
                                const parsed = val.trim() === "" ? null : parseFloat(val);
                                const n = (parsed === null || !isNaN(parsed)) ? parsed : null;
                                if (n !== storedRating) {
                                  updateReg.mutate(
                                    { id: eventId, regId: reg.id, data: { assignedRating: n } },
                                    {
                                      onSuccess: () => { invalidate(); setEditingRatings(prev => { const next = { ...prev }; delete next[reg.id]; return next; }); },
                                      onError: () => toast({ title: "Failed to update rating", variant: "destructive" }),
                                    }
                                  );
                                } else {
                                  setEditingRatings(prev => { const next = { ...prev }; delete next[reg.id]; return next; });
                                }
                              };
                              return (
                                <tr key={reg.id} data-testid={`row-reg-${reg.id}`} className="border-b border-border last:border-0 hover:bg-muted/20">
                                  <td className="px-5 py-3 text-muted-foreground font-mono text-xs">{curPage * pageSize + idx + 1}</td>
                                  {col("name") && <td className="px-5 py-3 font-medium">{reg.playerName}</td>}
                                  {col("duprId") && <td className="px-5 py-3 font-mono text-xs text-muted-foreground">{reg.memberDuprId}</td>}
                                  {event.teamFormat === "fixed_partner" && col("partner") && <td className="px-5 py-3 text-muted-foreground">{reg.partnerName || "—"}</td>}
                                  {col("dupr") && (
                                    <td className="px-5 py-3 font-mono">
                                      {reg.doubleRating || "NR"}
                                      {isNonNumeric(reg.doubleRating) && reg.selfRating && <span className="ml-2 text-xs text-muted-foreground">(self: {reg.selfRating})</span>}
                                    </td>
                                  )}
                                  {col("assigned") && (
                                    <td className="px-2 py-2">
                                      <input
                                        data-testid={`input-assigned-rating-${reg.id}`}
                                        type="number"
                                        step="0.01"
                                        min="0"
                                        max="8"
                                        placeholder="—"
                                        className="w-20 h-7 text-sm font-mono px-2 rounded border border-transparent bg-transparent hover:border-border focus:border-primary focus:bg-background focus:outline-none focus:ring-0 transition-colors"
                                        value={editVal}
                                        onChange={e => setEditingRatings(prev => ({ ...prev, [reg.id]: e.target.value }))}
                                        onBlur={e => saveRating(e.target.value)}
                                        onKeyDown={e => {
                                          if (e.key === "Enter") e.currentTarget.blur();
                                          if (e.key === "Escape") setEditingRatings(prev => { const next = { ...prev }; delete next[reg.id]; return next; });
                                        }}
                                      />
                                    </td>
                                  )}
                                  {col("status") && <td className="px-5 py-3"><StatusBadge status={reg.status} /></td>}
                                  {col("new") && (
                                    <td className="px-5 py-3">
                                      <input
                                        type="checkbox"
                                        data-testid={`checkbox-new-${reg.id}`}
                                        className="w-4 h-4 accent-primary cursor-pointer"
                                        checked={!!reg.isNew}
                                        onChange={e => updateReg.mutate(
                                          { id: eventId, regId: reg.id, data: { isNew: e.target.checked } },
                                          { onSuccess: invalidate, onError: () => toast({ title: "Failed to update", variant: "destructive" }) }
                                        )}
                                      />
                                    </td>
                                  )}
                                  {col("role") && (
                                    <td className="px-5 py-3">
                                      {reg.eventRole ? (
                                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-primary/10 text-primary border border-primary/20">
                                          <Star className="w-3 h-3" />
                                          {reg.eventRole}
                                        </span>
                                      ) : (
                                        <span className="text-xs text-muted-foreground">—</span>
                                      )}
                                    </td>
                                  )}
                                  {col("email") && (
                                    <td className="px-5 py-3 text-xs">
                                      {(reg as any).playerEmail ? (
                                        <a href={`mailto:${(reg as any).playerEmail}`} className="text-primary hover:underline">{(reg as any).playerEmail}</a>
                                      ) : <span className="text-muted-foreground">—</span>}
                                    </td>
                                  )}
                                  {col("phone") && (
                                    <td className="px-5 py-3 text-xs text-muted-foreground">
                                      {(reg as any).playerPhone || "—"}
                                    </td>
                                  )}
                                  {col("signedUp") && (
                                    <td className="px-5 py-3 text-xs text-muted-foreground whitespace-nowrap">
                                      {reg.registeredAt ? format(new Date(reg.registeredAt), "MMM d, yyyy h:mm a") : "—"}
                                    </td>
                                  )}
                                  <td className="px-5 py-3">
                                    <div className="flex items-center justify-end">
                                      <DropdownMenu>
                                        <DropdownMenuTrigger asChild>
                                          <Button data-testid={`button-actions-${reg.id}`} size="sm" variant="outline" className="gap-1 h-7 px-2">
                                            Actions <ChevronDown className="w-3 h-3" />
                                          </Button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent align="end" className="w-48">
                                          {reg.status !== "confirmed" && (
                                            <DropdownMenuItem data-testid={`action-move-to-confirmed-${reg.id}`} className="gap-2" onClick={() => handleConfirmReg(reg.id)}>
                                              <CheckCircle className="w-3.5 h-3.5 text-primary" /> Move to Confirmed
                                            </DropdownMenuItem>
                                          )}
                                          {reg.status !== "pending_approval" && (
                                            <DropdownMenuItem data-testid={`action-move-to-pending-${reg.id}`} className="gap-2" onClick={() => updateReg.mutate({ id: eventId, regId: reg.id, data: { status: "pending_approval" } as any }, { onSuccess: () => { toast({ title: "Moved to pending approval" }); invalidate(); }, onError: () => toast({ title: "Failed", variant: "destructive" }) })}>
                                              <Clock className="w-3.5 h-3.5 text-blue-600" /> Move to Pending Approval
                                            </DropdownMenuItem>
                                          )}
                                          {reg.status !== "waitlisted" && (
                                            <DropdownMenuItem data-testid={`action-move-to-waitlist-${reg.id}`} className="gap-2" onClick={() => handleMoveToWaitlist(reg.id)}>
                                              <List className="w-3.5 h-3.5 text-yellow-600" /> Move to Waitlist
                                            </DropdownMenuItem>
                                          )}
                                          {reg.status !== "rejected" && (
                                            <DropdownMenuItem data-testid={`action-move-to-rejected-${reg.id}`} className="gap-2" onClick={() => updateReg.mutate({ id: eventId, regId: reg.id, data: { status: "rejected" } as any }, { onSuccess: () => { toast({ title: "Moved to rejected" }); invalidate(); }, onError: () => toast({ title: "Failed", variant: "destructive" }) })}>
                                              <XCircle className="w-3.5 h-3.5 text-destructive" /> Move to Rejected
                                            </DropdownMenuItem>
                                          )}
                                          {reg.status !== "cancelled" && (
                                            <DropdownMenuItem data-testid={`action-move-to-cancelled-${reg.id}`} className="gap-2" onClick={() => handleCancelReg(reg.id)}>
                                              <XCircle className="w-3.5 h-3.5 text-muted-foreground" /> Move to Cancelled
                                            </DropdownMenuItem>
                                          )}
                                          {eventRolesList.length > 0 && (
                                            <>
                                              <DropdownMenuSeparator />
                                              {eventRolesList.map(role => (
                                                <DropdownMenuItem
                                                  key={role}
                                                  data-testid={`action-role-${role.replace(/\s+/g, "-").toLowerCase()}-${reg.id}`}
                                                  className="gap-2"
                                                  onClick={() => updateReg.mutate(
                                                    { id: eventId, regId: reg.id, data: { eventRole: reg.eventRole === role ? null : role } },
                                                    { onSuccess: invalidate, onError: () => toast({ title: "Failed to update role", variant: "destructive" }) }
                                                  )}
                                                >
                                                  <Star className="w-3.5 h-3.5" />
                                                  {reg.eventRole === role ? `Remove ${role}` : `Set ${role}`}
                                                </DropdownMenuItem>
                                              ))}
                                            </>
                                          )}
                                        </DropdownMenuContent>
                                      </DropdownMenu>
                                    </div>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                      {totalPages > 1 && (
                        <div className="flex items-center justify-between px-5 py-3 border-t border-border bg-muted/10">
                          <span className="text-xs text-muted-foreground">
                            {curPage * pageSize + 1}–{Math.min((curPage + 1) * pageSize, sorted.length)} of {sorted.length}
                          </span>
                          <div className="flex items-center gap-1">
                            <Button size="sm" variant="ghost" className="h-7 w-7 p-0" disabled={curPage === 0} onClick={() => setPageNums(prev => ({ ...prev, [key]: curPage - 1 }))}>
                              <ChevronLeft className="w-4 h-4" />
                            </Button>
                            <span className="text-xs text-muted-foreground px-1">{curPage + 1} / {totalPages}</span>
                            <Button size="sm" variant="ghost" className="h-7 w-7 p-0" disabled={curPage >= totalPages - 1} onClick={() => setPageNums(prev => ({ ...prev, [key]: curPage + 1 }))}>
                              <ChevronRight className="w-4 h-4" />
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
                {(registrations?.length ?? 0) === 0 && (
                  <div className="text-center py-12 text-muted-foreground"><p className="text-sm">No registrations yet.</p></div>
                )}
              </div>
            )}
          </>
        ) : (
          <div className="text-center py-16 text-muted-foreground"><p>Event not found.</p></div>
        )}
      </main>

      {/* ── Edit Event Dialog ──────────────────────────────── */}
      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Edit Event</DialogTitle></DialogHeader>
          <form onSubmit={handleEditSubmit}>
            <div className="space-y-4 py-2">
              {/* Event Details */}
              <div className="space-y-3">
                <h2 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">Event Details</h2>

                <div className="space-y-1.5">
                  <Label>Team Format</Label>
                  <Select value={editForm.teamFormat ?? "rotating"} onValueChange={v => setEditForm((f: any) => ({ ...f, teamFormat: v }))}>
                    <SelectTrigger data-testid="select-edit-format"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="rotating">Rotating Partners</SelectItem>
                      <SelectItem value="fixed_partner">Fixed-Partner</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="edit-name">Event Name *</Label>
                  <Input id="edit-name" value={editForm.name ?? ""} onChange={e => setEditForm((f: any) => ({ ...f, name: e.target.value }))} required />
                </div>
                <div className="space-y-1.5">
                  <Label>Description</Label>
                  <RichTextEditor
                    value={editForm.description ?? ""}
                    onChange={v => setEditForm((f: any) => ({ ...f, description: v }))}
                    placeholder="Tell participants what to expect..."
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="edit-start">Start Date & Time</Label>
                    <Input id="edit-start" type="datetime-local" value={editForm.startDatetime ?? ""} onChange={e => setEditForm((f: any) => ({ ...f, startDatetime: e.target.value }))} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="edit-end">End Date & Time</Label>
                    <Input id="edit-end" type="datetime-local" value={editForm.endDatetime ?? ""} onChange={e => setEditForm((f: any) => ({ ...f, endDatetime: e.target.value }))} />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="edit-loc-name">Location Name *</Label>
                  <Input id="edit-loc-name" value={editForm.locationName ?? ""} onChange={e => setEditForm((f: any) => ({ ...f, locationName: e.target.value }))} required />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="edit-loc-addr">Location Address *</Label>
                  <Input id="edit-loc-addr" value={editForm.locationAddress ?? ""} onChange={e => setEditForm((f: any) => ({ ...f, locationAddress: e.target.value }))} required />
                </div>
                {eventContactEmails.length > 0 && (
                  <div className="space-y-1.5">
                    <Label>Contact Email</Label>
                    <Select value={editForm.contactEmail || "__none__"} onValueChange={v => setEditForm((f: any) => ({ ...f, contactEmail: v === "__none__" ? "" : v }))}>
                      <SelectTrigger data-testid="select-edit-contact-email"><SelectValue placeholder="Select a contact email..." /></SelectTrigger>
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
              <div className="space-y-3">
                <h2 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">Format &amp; Settings</h2>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="edit-min">Min Participants</Label>
                    <Input id="edit-min" type="number" min={1} value={editForm.minParticipants ?? ""} onChange={e => setEditForm((f: any) => ({ ...f, minParticipants: e.target.value }))} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="edit-max">Max Participants *</Label>
                    <Input id="edit-max" type="number" min={1} value={editForm.maxParticipants ?? ""} onChange={e => setEditForm((f: any) => ({ ...f, maxParticipants: e.target.value }))} required />
                  </div>
                </div>

                {/* Rating Requirement */}
                <div className="space-y-2">
                  <Label>Rating Requirement</Label>
                  <Select value={editForm.ratingTypeRequired ?? "none"} onValueChange={handleEditRatingTypeChange}>
                    <SelectTrigger data-testid="select-edit-rating"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {enabledRatingTypes.map(opt => <SelectItem key={opt.key} value={opt.key}>{opt.label}</SelectItem>)}
                    </SelectContent>
                  </Select>

                  {/* DUPR config */}
                  {editForm.ratingTypeRequired === "dupr" && editRatingConfig && (
                    <div className="rounded-md border border-border bg-muted/30 p-3 space-y-2">
                      <p className="text-xs font-medium text-muted-foreground">DUPR Rating Range</p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div className="space-y-1">
                          <Label className="text-xs">Min Rating</Label>
                          <Input type="number" step={0.1} min={rrc.dupr.minAllowed} max={rrc.dupr.maxAllowed} value={editRatingConfig.min ?? rrc.dupr.defaultMin} onChange={e => setEditRatingConfig((c: any) => ({ ...c, min: Number(e.target.value) }))} />
                          <p className="text-xs text-muted-foreground">Range: {rrc.dupr.minAllowed}–{rrc.dupr.maxAllowed}</p>
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">Max Rating</Label>
                          <Input type="number" step={0.1} min={rrc.dupr.minAllowed} max={rrc.dupr.maxAllowed} value={editRatingConfig.max ?? rrc.dupr.defaultMax} onChange={e => setEditRatingConfig((c: any) => ({ ...c, max: Number(e.target.value) }))} />
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <input type="checkbox" id="edit-nr-allowed" className="w-4 h-4 accent-primary" checked={!!editRatingConfig.nrAllowed} onChange={e => setEditRatingConfig((c: any) => ({ ...c, nrAllowed: e.target.checked }))} />
                        <label htmlFor="edit-nr-allowed" className="text-sm cursor-pointer">Allow NR (Not Rated) players</label>
                      </div>
                    </div>
                  )}

                  {/* Self-Numeric config */}
                  {editForm.ratingTypeRequired === "self_numeric" && editRatingConfig && (
                    <div className="rounded-md border border-border bg-muted/30 p-3 space-y-2">
                      <p className="text-xs font-medium text-muted-foreground">Self-Rating Numeric Range</p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div className="space-y-1">
                          <Label className="text-xs">Min Rating</Label>
                          <Input type="number" step={0.1} min={rrc.selfNumeric.minAllowed} max={rrc.selfNumeric.maxAllowed} value={editRatingConfig.min ?? rrc.selfNumeric.defaultMin} onChange={e => setEditRatingConfig((c: any) => ({ ...c, min: Number(e.target.value) }))} />
                          <p className="text-xs text-muted-foreground">Range: {rrc.selfNumeric.minAllowed}–{rrc.selfNumeric.maxAllowed}</p>
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">Max Rating</Label>
                          <Input type="number" step={0.1} min={rrc.selfNumeric.minAllowed} max={rrc.selfNumeric.maxAllowed} value={editRatingConfig.max ?? rrc.selfNumeric.defaultMax} onChange={e => setEditRatingConfig((c: any) => ({ ...c, max: Number(e.target.value) }))} />
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Self-Skill config */}
                  {editForm.ratingTypeRequired === "self_skill" && editRatingConfig && rrc.selfSkill.levels.length > 0 && (
                    <div className="rounded-md border border-border bg-muted/30 p-3 space-y-2">
                      <Label className="text-xs font-medium text-muted-foreground">Accepted Skill Level Range</Label>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <Select value={String(editRatingConfig.minLevel ?? rrc.selfSkill.defaultMinLevel)} onValueChange={v => setEditRatingConfig((c: any) => ({ ...c, minLevel: Number(v) }))}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {[...rrc.selfSkill.levels].sort((a, b) => a.level - b.level).map((lv: SkillLevel) => (
                              <SelectItem key={lv.level} value={String(lv.level)}>{lv.text}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Select value={String(editRatingConfig.maxLevel ?? rrc.selfSkill.defaultMaxLevel)} onValueChange={v => setEditRatingConfig((c: any) => ({ ...c, maxLevel: Number(v) }))}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {[...rrc.selfSkill.levels].sort((a, b) => a.level - b.level).map((lv: SkillLevel) => (
                              <SelectItem key={lv.level} value={String(lv.level)}>{lv.text}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <p className="text-xs text-muted-foreground">Players at these levels can register.</p>
                    </div>
                  )}
                  {editForm.ratingTypeRequired === "self_skill" && rrc.selfSkill.levels.length === 0 && (
                    <p className="text-xs text-amber-600">No skill levels defined in Settings yet.</p>
                  )}
                </div>

                <div className="flex items-center justify-between">
                  <Label>Enable Waitlist</Label>
                  <Switch checked={!!editForm.waitlistEnabled} onCheckedChange={v => setEditForm((f: any) => ({ ...f, waitlistEnabled: v }))} />
                </div>
                <div className="space-y-1.5">
                  <Label>Require Approval</Label>
                  <Select value={editForm.requireApproval || "none"} onValueChange={v => setEditForm((f: any) => ({ ...f, requireApproval: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No Approval</SelectItem>
                      <SelectItem value="all">All Players</SelectItem>
                      <SelectItem value="nr_only">NR Players Only</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Court Fees */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">Court Fees</h2>
                    <p className="text-xs text-muted-foreground mt-0.5">Optionally collect a court fee for this event.</p>
                  </div>
                  <Switch checked={!!editForm.courtFeeEnabled} onCheckedChange={v => setEditForm((f: any) => ({ ...f, courtFeeEnabled: v }))} />
                </div>
                {editForm.courtFeeEnabled && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label>Member Fee ($)</Label>
                      <Input type="number" min={0} step={0.01} value={editForm.memberFee ?? ""} onChange={e => setEditForm((f: any) => ({ ...f, memberFee: e.target.value }))} />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Non-Member Fee ($)</Label>
                      <Input type="number" min={0} step={0.01} value={editForm.nonMemberFee ?? ""} onChange={e => setEditForm((f: any) => ({ ...f, nonMemberFee: e.target.value }))} />
                    </div>
                  </div>
                )}
              </div>

              {/* Signup Window */}
              <div className="space-y-3">
                <h2 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">Signup Window</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>Signup Opens</Label>
                    <Input type="datetime-local" value={editForm.signupStartDatetime ?? ""} onChange={e => setEditForm((f: any) => ({ ...f, signupStartDatetime: e.target.value }))} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Signup Closes</Label>
                    <Input type="datetime-local" value={editForm.signupEndDatetime ?? ""} onChange={e => setEditForm((f: any) => ({ ...f, signupEndDatetime: e.target.value }))} />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>Status</Label>
                  <Select value={editForm.status ?? "upcoming"} onValueChange={v => setEditForm((f: any) => ({ ...f, status: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="upcoming">Upcoming</SelectItem>
                      <SelectItem value="closed">Closed</SelectItem>
                      <SelectItem value="ended">Ended</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
            <DialogFooter className="flex-row items-center gap-2">
              {user?.role === "admin" && (
                <Button
                  type="button"
                  variant="ghost"
                  className="text-destructive hover:text-destructive hover:bg-destructive/10 gap-1.5 mr-auto"
                  onClick={() => setShowDeleteEventDialog(true)}
                  disabled={deleteEvent.isPending}
                >
                  <Trash2 className="w-4 h-4" /> Delete Event
                </Button>
              )}
              <Button type="button" variant="outline" onClick={() => setShowEditDialog(false)}>Cancel</Button>
              <Button type="submit" data-testid="button-submit-edit-event" disabled={updateEvent.isPending}>
                {updateEvent.isPending ? "Saving..." : "Save Changes"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Delete Event confirm ───────────────────────────── */}
      <AlertDialog open={showDeleteEventDialog} onOpenChange={setShowDeleteEventDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this event?</AlertDialogTitle>
            <AlertDialogDescription>This will permanently delete the event and all its registrations. This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete-event">Cancel</AlertDialogCancel>
            <AlertDialogAction
              data-testid="button-confirm-delete-event"
              onClick={handleDeleteEvent}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete Event
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </div>
  );
}
