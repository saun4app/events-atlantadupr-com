import { useState, useEffect } from "react";
import { useParams, useLocation, Link } from "wouter";
import {
  useGetEvent, useListRegistrations, useUpdateEvent, useDeleteEvent, useUpdateRegistration,
  useCreateRegistration, useGetSettings, useBroadcastEmail,
  getGetEventQueryKey, getListRegistrationsQueryKey, getGetEventRosterSummaryQueryKey,
  getListEventsQueryKey, getGetEventsSummaryQueryKey
} from "@workspace/api-client-react";
import { useQueryClient, useMutation } from "@tanstack/react-query";
import NotFound from "@/pages/not-found";
import { AdminNav } from "@/components/admin-nav";
import { EventAssignmentManager } from "@/components/event-assignment-manager";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { RichTextEditor } from "@/components/rich-text-editor";
import { DateTimeInput } from "@/components/date-time-input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { ChevronLeft, ChevronRight, UserPlus, Trash2, CheckCircle, XCircle, Clock, List, ArrowUp, ArrowDown, ChevronsUpDown, MapPin, Calendar, Pencil, ChevronDown, ChevronUp, Star, Mail, MessageSquare, Download } from "lucide-react";
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
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import {
  getFixedPartnerRequirement,
  loadFixedPartnerConfig,
} from "@workspace/fixed-partner-config";
import rawFixedPartnerConfig from "../../../../../app-config/fixed-partner-config.json";
import { hasUserRole, USER_ROLE_IDS } from "@/lib/user-roles";

const fixedPartnerConfig = loadFixedPartnerConfig(rawFixedPartnerConfig);

const ADMIN_ADD_INPUT_REQUIREMENT = getFixedPartnerRequirement(
  fixedPartnerConfig,
  "admin_add_input",
);
const ADMIN_MAX_PRIMARY_EMAILS =
  ADMIN_ADD_INPUT_REQUIREMENT.maxPrimaryEmailsPerSubmission;

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

function hasInvertedLimits(min: unknown, max: unknown): boolean {
  if (min === "" || max === "" || min == null || max == null) return false;
  const minValue = Number(min);
  const maxValue = Number(max);
  return Number.isFinite(minValue) && Number.isFinite(maxValue) && minValue > maxValue;
}

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
    cancelled: { label: "Canceled", className: "bg-muted text-muted-foreground border border-border" },
    no_show: { label: "No-show", className: "bg-orange-100 text-orange-700 border-orange-200 border" },
  };
  const s = map[status] ?? { label: status, className: "" };
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${s.className}`}>{s.label}</span>;
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
  try {
    const d = new Date(dt);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch { return ""; }
}

export default function AdminEventDetailFixed() {
  const { id } = useParams<{ id: string }>();
  const eventType = fixedPartnerConfig.format as "fixed_partner";
  const eventId = Number(id);
  const { isAuthenticated, isLoading, user, canAccessAdmin } = useAuth();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) setLocation("/login");
    if (!isLoading && isAuthenticated && !canAccessAdmin) setLocation("/");
  }, [isLoading, isAuthenticated, canAccessAdmin]);

  const { data: event, isLoading: evLoading } = useGetEvent(eventType, eventId, {
    query: { enabled: !!eventId, queryKey: getGetEventQueryKey(eventType, eventId) }
  });
  const { data: registrations, isLoading: regLoading } = useListRegistrations(eventType, eventId, {
    query: { enabled: !!eventId, queryKey: getListRegistrationsQueryKey(eventType, eventId) }
  });
  const { data: settings } = useGetSettings();
  const eventRolesList: string[] = ((settings as any)?.eventRoles as string[] | undefined) ?? [];
  const eventContactEmails: string[] = ((settings as any)?.eventContactEmails as string[] | undefined) ?? [];
  const isAdminOrOrganizer = hasUserRole(user?.role, "eventManagers");
  const canWriteEvent = isAdminOrOrganizer || (event as any)?.canWrite === true;


  const updateEvent = useUpdateEvent();
  const deleteEvent = useDeleteEvent();
  const updateReg = useUpdateRegistration();
  const createReg = useCreateRegistration();
  const broadcastEmail = useBroadcastEmail();
  const bulkSetAssigned = useMutation({
    mutationFn: async () => {
      const token = localStorage.getItem("authToken");
      const res = await fetch(`/api/events/${eventType}/${eventId}/registrations/bulk-set-assigned-ratings`, {
        method: "POST",
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      });
      if (!res.ok) throw new Error("Failed to set assigned ratings");
      return res.json() as Promise<{ updated: number }>;
    },
    onSuccess: (data) => {
      toast({ title: `Set ${data.updated} assigned rating${data.updated === 1 ? "" : "s"} to DUPR` });
      invalidate();
    },
    onError: () => toast({ title: "Failed to set assigned ratings", variant: "destructive" }),
  });
  const [showDeleteEventDialog, setShowDeleteEventDialog] = useState(false);
  const [addEmails, setAddEmails] = useState("");
  const [addPartnerEmail, setAddPartnerEmail] = useState("");
  const [notFoundEmails, setNotFoundEmails] = useState<string[]>([]);
  const [visibleCols, setVisibleCols] = useState<Set<string>>(
    () => {
      try {
        const stored = localStorage.getItem("admin_event_detail_columns");
        if (stored) return new Set(JSON.parse(stored));
      } catch {}
      return new Set(["name", "duprId", "dupr", "selfRating", "assigned", "email", "phone", "partner", "partnerDuprId", "partnerDupr", "partnerSelfRating", "teamRating", "status", "role", "signedUp"]);
    }
  );
  const toggleCol = (k: string) => setVisibleCols(prev => {
    const next = new Set(prev);
    if (next.has(k)) next.delete(k); else next.add(k);
    localStorage.setItem("admin_event_detail_columns", JSON.stringify(Array.from(next)));
    return next;
  });
  const col = (k: string) => visibleCols.has(k);
  const visibleColCount = 2 + visibleCols.size;

  const [showEditDialog, setShowEditDialog] = useState(false);
  const [editForm, setEditForm] = useState<Record<string, any>>({});
  const [editRatingConfig, setEditRatingConfig] = useState<any>(null);

  const [editRegId, setEditRegId] = useState<number | null>(null);
  const [editRegForm, setEditRegForm] = useState<Record<string, any>>({});
  const [editRegOrig, setEditRegOrig] = useState<Record<string, any>>({});


  const rrc = getRrc(settings);

  const [sortState, setSortState] = useState<Record<string, { col: string; dir: "asc" | "desc" }>>({});
  const [pageNums, setPageNums] = useState<Record<string, number>>({});
  const [pageSizes, setPageSizes] = useState<Record<string, number>>({});
  const getPageSize = (key: string) => pageSizes[key] ?? 75;
  const [editingRatings, setEditingRatings] = useState<Record<number, string>>({});
  const [editingSelfRatings, setEditingSelfRatings] = useState<Record<number, string>>({});
  const [showRemoved, setShowRemoved] = useState(false);
  const [clientDialog, setClientDialog] = useState<{ mode: "email" | "text"; kind: "broadcast" | "client" } | null>(null);
  const [clientSelectedIds, setClientSelectedIds] = useState<Set<number>>(new Set());
  const [clientMessage, setClientMessage] = useState("");

  const enabledRatingTypes = [
    { key: "none", label: "No Rating Required" },
    ...(rrc.dupr.enabled ? [{ key: "dupr", label: "DUPR Rating" }] : []),
    ...(rrc.selfNumeric.enabled ? [{ key: "self_numeric", label: "Self-Rating (Numeric)" }] : []),
    ...(rrc.selfSkill.enabled ? [{ key: "self_skill", label: "Self-Rating (Skill Level)" }] : []),
  ];

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: getListRegistrationsQueryKey(eventType, eventId) });
    queryClient.invalidateQueries({ queryKey: getGetEventRosterSummaryQueryKey(eventType, eventId) });
  }

  function invalidateEvent() {
    queryClient.invalidateQueries({ queryKey: getGetEventQueryKey(eventType, eventId) });
    queryClient.invalidateQueries({ queryKey: getListEventsQueryKey(eventType) });
  }

  function sortRegs(regs: any[], key: string) {
    const s = sortState[key];
    if (!s) return regs;
    const statusOrder: Record<string, number> = { confirmed: 0, pending_approval: 1, waitlisted: 2, rejected: 3, cancelled: 4, no_show: 5 };
    return [...regs].sort((a, b) => {
      let av: any, bv: any;
      if (s.col === "name") { av = (a.playerName ?? "").toLowerCase(); bv = (b.playerName ?? "").toLowerCase(); }
      else if (s.col === "dupr") { av = parseFloat(a.doubleRating); bv = parseFloat(b.doubleRating); }
      else if (s.col === "selfRating") { av = parseFloat(a.selfRating) || 0; bv = parseFloat(b.selfRating) || 0; }
      else if (s.col === "assigned") {
        const aParsed = parseFloat(a.doubleRating); const bParsed = parseFloat(b.doubleRating);
        av = a.assignedRating != null ? a.assignedRating : (isFinite(aParsed) ? aParsed : NaN);
        bv = b.assignedRating != null ? b.assignedRating : (isFinite(bParsed) ? bParsed : NaN);
      }
      else if (s.col === "status") { av = statusOrder[a.status] ?? 99; bv = statusOrder[b.status] ?? 99; }
      else if (s.col === "role") { av = (a.eventRole ?? "").toLowerCase(); bv = (b.eventRole ?? "").toLowerCase(); }
      else if (s.col === "partner") { av = (a.partnerName ?? "").toLowerCase(); bv = (b.partnerName ?? "").toLowerCase(); }
      else if (s.col === "partnerDuprId") { av = (a.partnerDuprId ?? "").toLowerCase(); bv = (b.partnerDuprId ?? "").toLowerCase(); }
      else if (s.col === "partnerDupr") { av = parseFloat(a.partnerDoubleRating); bv = parseFloat(b.partnerDoubleRating); }
      else if (s.col === "partnerSelfRating") { av = parseFloat(a.partnerSelfRating) || 0; bv = parseFloat(b.partnerSelfRating) || 0; }
      else if (s.col === "teamRating") { av = parseFloat(a.teamRating); bv = parseFloat(b.teamRating); }
      else if (s.col === "email") { av = ((a as any).playerEmail ?? "").toLowerCase(); bv = ((b as any).playerEmail ?? "").toLowerCase(); }
      else if (s.col === "phone") { av = ((a as any).playerPhone ?? "").toLowerCase(); bv = ((b as any).playerPhone ?? "").toLowerCase(); }
      else if (s.col === "signedUp") { av = new Date(a.registeredAt).getTime(); bv = new Date(b.registeredAt).getTime(); }
      else return 0;
      if (typeof av === "string") return s.dir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      // NaN/undefined/NR values go to bottom regardless of sort direction
      if (isNaN(av) && isNaN(bv)) return 0;
      if (isNaN(av)) return 1;
      if (isNaN(bv)) return -1;
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
    if (!event || !canWriteEvent) return;
    setEditForm({
      name: event.name ?? "",
      description: event.description ?? "",
      eventDescription: event.eventDescription ?? "",
      startDatetime: toLocalInput(event.startDatetime),
      endDatetime: toLocalInput(event.endDatetime),
      locationName: event.locationName ?? "",
      locationAddress: event.locationAddress ?? "",
      ratingTypeRequired: event.ratingTypeRequired ?? "none",
      minParticipants: String((event.teamFormat === fixedPartnerConfig.format ? event.minTeams : event.minParticipants) ?? ""),
      maxParticipants: String((event.teamFormat === fixedPartnerConfig.format ? event.maxTeams : event.maxParticipants) ?? ""),
      waitlistEnabled: event.waitlistEnabled ?? false,
      requireApproval: (event.requireApproval as any) || "none",
      signupStartDatetime: toLocalInput(event.signupStartDatetime),
      signupEndDatetime: toLocalInput(event.signupEndDatetime),
      showSignupEnd: (event as any).showSignupEnd ?? false,
      status: event.status ?? "upcoming",
      contactEmail: (event as any).contactEmail ?? "",
      courtFeeEnabled: (event as any).courtFeeEnabled ?? false,
      memberFee: String((event as any).memberFee ?? ""),
      nonMemberFee: String((event as any).nonMemberFee ?? ""),
    });
    setEditRatingConfig((event as any).ratingConfig ? {
      ...(event as any).ratingConfig,
      maxPartnerGap: (event as any).ratingConfig.maxPartnerGap ?? fixedPartnerConfig.defaults.rating.maxPartnerGap,
    } : null);
    setShowEditDialog(true);
  }

  function handleEditRatingTypeChange(type: string) {
    setEditForm((f: any) => ({ ...f, ratingTypeRequired: type }));
    if (type === "none") {
      setEditRatingConfig(null);
    } else if (type === "dupr") {
      setEditRatingConfig({
        min: rrc.dupr.defaultMin,
        max: rrc.dupr.defaultMax,
        nrAllowed: rrc.dupr.defaultNrAllowed,
        maxPartnerGap: fixedPartnerConfig.defaults.rating.maxPartnerGap,
      });
    } else if (type === "self_numeric") {
      setEditRatingConfig({ min: rrc.selfNumeric.defaultMin, max: rrc.selfNumeric.defaultMax });
    } else if (type === "self_skill") {
      setEditRatingConfig({ minLevel: rrc.selfSkill.defaultMinLevel, maxLevel: rrc.selfSkill.defaultMaxLevel });
    }
  }

  function handleDeleteEvent() {
    if (!canWriteEvent) return;
    deleteEvent.mutate({ eventType, id: eventId }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListEventsQueryKey(eventType) });
        queryClient.invalidateQueries({ queryKey: getGetEventsSummaryQueryKey() });
        setLocation(`/admin/events/${eventType}`);
      },
      onError: () => toast({ title: "Delete failed", variant: "destructive" }),
    });
  }

  function handleEditSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canWriteEvent) return;
    if (hasInvertedLimits(editForm.minParticipants, editForm.maxParticipants)) {
      toast({
        title: "Invalid team limits",
        description: "Minimum teams cannot exceed maximum teams.",
        variant: "destructive",
      });
      return;
    }
    updateEvent.mutate({
      eventType,
      id: eventId,
      data: {
        name: editForm.name || undefined,
        description: editForm.description || null,
        eventDescription: editForm.eventDescription || null,
        startDatetime: editForm.startDatetime ? new Date(editForm.startDatetime).toISOString() : undefined,
        endDatetime: editForm.endDatetime ? new Date(editForm.endDatetime).toISOString() : undefined,
        locationName: editForm.locationName || undefined,
        locationAddress: editForm.locationAddress || undefined,
        ratingTypeRequired: editForm.ratingTypeRequired || undefined,
        ratingConfig: editForm.ratingTypeRequired !== "none" ? editRatingConfig : null,
        minTeams: editForm.minParticipants ? Number(editForm.minParticipants) : undefined,
        maxTeams: editForm.maxParticipants ? Number(editForm.maxParticipants) : undefined,
        waitlistEnabled: editForm.waitlistEnabled,
        requireApproval: editForm.requireApproval,
        signupStartDatetime: editForm.signupStartDatetime ? new Date(editForm.signupStartDatetime).toISOString() : undefined,
        signupEndDatetime: editForm.signupEndDatetime ? new Date(editForm.signupEndDatetime).toISOString() : undefined,
        showSignupEnd: editForm.showSignupEnd,
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

  function handleMoveToWaitlist(regId: number) { if (!canWriteEvent) return; updateReg.mutate({ eventType, id: eventId, regId, data: { status: "waitlisted" } as any }, { onSuccess: () => { toast({ title: "Moved to waitlist" }); invalidate(); }, onError: () => toast({ title: "Failed", variant: "destructive" }) }); }
  function handleCancelReg(regId: number) { if (!canWriteEvent) return; updateReg.mutate({ eventType, id: eventId, regId, data: { status: "cancelled" } as any }, { onSuccess: () => { toast({ title: "Registration cancelled" }); invalidate(); }, onError: () => toast({ title: "Failed", variant: "destructive" }) }); }
  function handleNoShowReg(regId: number) { if (!canWriteEvent) return; updateReg.mutate({ eventType, id: eventId, regId, data: { status: "no_show" } as any }, { onSuccess: () => { toast({ title: "Moved to no-show" }); invalidate(); }, onError: () => toast({ title: "Failed", variant: "destructive" }) }); }
  function handleConfirmReg(regId: number) { if (!canWriteEvent) return; updateReg.mutate({ eventType, id: eventId, regId, data: { status: "confirmed" } as any }, { onSuccess: () => { toast({ title: "Moved to confirmed" }); invalidate(); }, onError: () => toast({ title: "Failed", variant: "destructive" }) }); }

  function openEditRegDialog(reg: any) {
    const base = {
      status: reg.status ?? "confirmed",
      assignedRating: reg.assignedRating != null ? String(reg.assignedRating) : "",
      selfRating: reg.selfRating != null ? String(reg.selfRating) : "",
      eventRole: reg.eventRole ?? "__none__",
    };
    setEditRegId(reg.id);
    setEditRegOrig(base);
    setEditRegForm({
      ...base,
      playerName: reg.playerName ?? "",
      memberDuprId: reg.memberDuprId ?? "",
      partnerName: reg.partnerName ?? "",
      partnerDuprId: reg.partnerDuprId ?? "",
      replacePlayer: "",
      replacePartner: "",
    });
  }

  function handleEditRegSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canWriteEvent) return;
    if (editRegId == null) return;
    const f = editRegForm;
    const orig = editRegOrig;
    const data: any = {};

    // Only send fields that the admin actually changed, so player/partner
    // replacement (which resets ratings server-side) isn't overwritten.
    if (f.status !== orig.status) data.status = f.status;
    if ((f.eventRole ?? "__none__") !== (orig.eventRole ?? "__none__")) {
      data.eventRole = f.eventRole === "__none__" ? null : f.eventRole;
    }
    if ((f.assignedRating ?? "") !== (orig.assignedRating ?? "")) {
      data.assignedRating = f.assignedRating.trim() === "" ? null : Number(f.assignedRating);
    }
    if ((f.selfRating ?? "") !== (orig.selfRating ?? "")) {
      data.selfRating = f.selfRating.trim() === "" ? null : f.selfRating.trim();
    }

    const replacePlayer = (f.replacePlayer || "").trim();
    if (replacePlayer) {
      if (replacePlayer.includes("@")) data.memberEmail = replacePlayer.toLowerCase();
      else data.memberDuprId = replacePlayer;
    }
    const replacePartner = (f.replacePartner || "").trim();
    if (replacePartner) {
      if (replacePartner.includes("@")) data.partnerEmail = replacePartner.toLowerCase();
      else data.partnerDuprId = replacePartner;
    }

    if (Object.keys(data).length === 0) {
      toast({ title: "No changes to save" });
      setEditRegId(null);
      return;
    }

    updateReg.mutate(
      { eventType, id: eventId, regId: editRegId, data },
      {
        onSuccess: () => { toast({ title: "Registration updated" }); invalidate(); setEditRegId(null); },
        onError: (err: any) => toast({ title: err?.data?.error || "Failed to update registration", variant: "destructive" }),
      }
    );
  }
  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!canWriteEvent) return;
    const emails = addEmails.split(/[\s,]+/).map(s => s.trim().toLowerCase()).filter(Boolean);
    if (emails.length === 0) return;
    if (
      event?.teamFormat === fixedPartnerConfig.format &&
      emails.length > ADMIN_MAX_PRIMARY_EMAILS
    ) {
      toast({ title: "Only one email allowed", description: "Fixed-partner events require a single participant email.", variant: "destructive" });
      return;
    }
    let succeeded = 0;
    const failures: string[] = [];
    const notFound: string[] = [];
    let bypassRatingRequirements = false;
    for (const email of emails) {
      try {
        const data = { email, partnerEmail: event?.teamFormat === "fixed_partner" ? addPartnerEmail.trim().toLowerCase() || null : null, ...(bypassRatingRequirements ? { bypassRatingRequirements: true } : {}) };
        await createReg.mutateAsync({ eventType, id: eventId, data });
        succeeded++;
      } catch (err: any) {
        const msg = err?.data?.error || "";
        if (msg.toLowerCase().includes("no member found with that email") || msg.toLowerCase().includes("no member found with that dupr id")) {
          notFound.push(email);
        } else if (
          event?.teamFormat === "fixed_partner" &&
          !bypassRatingRequirements &&
          /outside this event's enforced rating range|partners' DUPR ratings may differ/i.test(msg) &&
          window.confirm("This team does not meet the event's DUPR rating range or partner-gap requirement. Add it anyway as an admin override?")
        ) {
          bypassRatingRequirements = true;
          try {
            await createReg.mutateAsync({ eventType, id: eventId, data: { email, partnerEmail: addPartnerEmail.trim().toLowerCase() || null, bypassRatingRequirements: true } });
            succeeded++;
          } catch (retryErr: any) {
            failures.push(`${email}: ${retryErr?.data?.error || "failed"}`);
          }
        } else {
          failures.push(`${email}: ${msg || "failed"}`);
        }
      }
    }
    setNotFoundEmails(notFound);
    if (succeeded > 0) { toast({ title: `${succeeded} participant${succeeded !== 1 ? "s" : ""} added` }); setAddEmails(""); setAddPartnerEmail(""); invalidate(); }
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
  const no_show = registrations?.filter(r => r.status === "no_show") ?? [];

  const confirmedEmails = Array.from(new Set(confirmed.map(r => (r as any).playerEmail as string | undefined).filter((e): e is string => !!e)));
  const confirmedPhones = Array.from(new Set(confirmed.map(r => (r as any).playerPhone as string | undefined).filter((p): p is string => !!p)));

  const clientField = (mode: "email" | "text") => (mode === "email" ? "playerEmail" : "playerPhone");

  const defaultNotifyMessage = () => {
    if (!event) return "";
    let dateStr = "";
    if (event.startDatetime) {
      const start = new Date(event.startDatetime);
      dateStr = format(start, "EEE, MMM d, yyyy 'at' h:mm a");
      if (event.endDatetime) {
        const end = new Date(event.endDatetime);
        const sameDay = start.toDateString() === end.toDateString();
        dateStr += ` – ${format(end, sameDay ? "h:mm a" : "EEE, MMM d, yyyy 'at' h:mm a")}`;
      }
    }
    const loc = event.locationName ?? "";
    const lines = [
      event.name ? `Event: ${event.name}` : "",
      dateStr ? `When: ${dateStr}` : "",
      loc ? `Where: ${loc}` : "",
    ].filter(Boolean);
    return lines.length ? `${lines.join("\n")}\n\n` : "";
  };

  const openNotifyDialog = (mode: "email" | "text", kind: "broadcast" | "client") => {
    const field = clientField(mode);
    const eligible = confirmed.filter(r => !!(r as any)[field]);
    if (eligible.length === 0) {
      toast(mode === "email"
        ? { title: "No email addresses", description: "No confirmed participants have an email on file.", variant: "destructive" }
        : { title: "No phone numbers", description: "No confirmed participants have a phone number on file.", variant: "destructive" });
      return;
    }
    setClientSelectedIds(new Set(eligible.map(r => r.id)));
    setClientMessage(defaultNotifyMessage());
    setClientDialog({ mode, kind });
  };

  const clientRecipients = clientDialog
    ? sortRegs(confirmed, "Confirmed").filter(r => !!(r as any)[clientField(clientDialog.mode)])
    : [];
  const allClientSelected = clientRecipients.length > 0 && clientRecipients.every(r => clientSelectedIds.has(r.id));
  const someClientSelected = clientRecipients.some(r => clientSelectedIds.has(r.id)) && !allClientSelected;
  const clientSelectedCount = clientRecipients.reduce((n, r) => n + (clientSelectedIds.has(r.id) ? 1 : 0), 0);

  const toggleClientId = (id: number, checked: boolean) => {
    setClientSelectedIds(prev => {
      const next = new Set(prev);
      if (checked) next.add(id); else next.delete(id);
      return next;
    });
  };

  const toggleClientAll = (checked: boolean) => {
    setClientSelectedIds(checked ? new Set(clientRecipients.map(r => r.id)) : new Set());
  };

  const confirmClientDialog = () => {
    if (!clientDialog) return;
    const { mode, kind } = clientDialog;
    const field = clientField(mode);
    const values = Array.from(new Set(
      clientRecipients
        .filter(r => clientSelectedIds.has(r.id))
        .map(r => (r as any)[field] as string)
        .filter(Boolean)
    ));
    if (values.length === 0) {
      toast({ title: "No recipients selected", description: `Select at least one participant to ${mode === "email" ? "email" : "text"}.`, variant: "destructive" });
      return;
    }
    const message = clientMessage.trim();
    if (kind === "broadcast") {
      if (mode === "email") {
        const subject = event?.name ? `Update: ${event.name}` : "Event update";
        const selectedIds = Array.from(clientSelectedIds);
        broadcastEmail.mutate(
          { eventType, id: eventId, data: { subject, body: message, registrationIds: selectedIds } },
          {
            onSuccess: (data) => {
              toast({ title: `Email sent to ${data.recipients} participant${data.recipients === 1 ? "" : "s"}` });
              setClientDialog(null);
            },
            onError: (err: any) => {
              toast({ title: err?.data?.error || "Failed to send broadcast email", variant: "destructive" });
            },
          }
        );
      } else {
        toast({
          title: "Text broadcast",
          description: `Bulk text to ${values.length} confirmed participant${values.length === 1 ? "" : "s"} will be enabled soon.`,
        });
        setClientDialog(null);
      }
      return;
    }
    if (mode === "email") {
      const subject = event?.name ? `Update: ${event.name}` : "Event update";
      const fromEmail = eventContactEmails[0] ?? "";
      const params = [
        ...(fromEmail ? [`from=${encodeURIComponent(fromEmail)}`] : []),
        `bcc=${encodeURIComponent(values.join(","))}`,
        `subject=${encodeURIComponent(subject)}`,
      ];
      if (message) params.push(`body=${encodeURIComponent(message)}`);
      window.location.href = `mailto:?${params.join("&")}`;
    } else {
      const base = `sms:${encodeURIComponent(values.join(","))}`;
      window.location.href = message ? `${base}?body=${encodeURIComponent(message)}` : base;
    }
    setClientDialog(null);
  };

  const handleEmailClient = () => openNotifyDialog("email", "client");

  const handleTextClient = () => openNotifyDialog("text", "client");

  const exportColumns = () => {
    const cols: { label: string; get: (r: any) => string }[] = [];
    if (col("name")) cols.push({ label: "Name", get: r => r.playerName ?? "" });
    if (col("duprId")) cols.push({ label: "DUPR ID", get: r => r.memberDuprId ?? "" });
    if (col("dupr")) cols.push({ label: "DUPR", get: r => r.doubleRating || "NR" });
    if (col("selfRating")) cols.push({ label: "Self-Rate", get: r => r.selfRating != null ? String(r.selfRating) : "" });
    if (col("assigned")) cols.push({ label: "Assigned", get: r => {
      const p = parseFloat(r.doubleRating);
      const sr = r.assignedRating != null ? r.assignedRating : (r.doubleRating && isFinite(p) ? p : null);
      return sr != null ? String(sr) : "";
    } });
    if (col("email")) cols.push({ label: "Email", get: r => r.playerEmail ?? "" });
    if (col("phone")) cols.push({ label: "Phone", get: r => r.playerPhone ?? "" });
    if (col("partner")) cols.push({ label: "Partner", get: r => r.partnerName ?? "" });
    if (col("partnerDuprId")) cols.push({ label: "Partner DUPR ID", get: r => r.partnerDuprId ?? "" });
    if (col("partnerDupr")) cols.push({ label: "Partner DUPR", get: r => r.partnerDoubleRating || "NR" });
    if (col("partnerSelfRating")) cols.push({ label: "Partner Self-Rate", get: r => r.partnerSelfRating != null ? String(r.partnerSelfRating) : "" });
    if (col("teamRating")) cols.push({ label: "Team Rating", get: r => r.teamRating || "NR" });
    if (col("status")) cols.push({ label: "Status", get: r => r.status ?? "" });
    if (col("role")) cols.push({ label: "Role", get: r => r.eventRole ?? "" });
    if (col("signedUp")) cols.push({ label: "Signed Up", get: r => r.registeredAt ? format(new Date(r.registeredAt), "MMM d, yyyy h:mm a") : "" });
    return cols;
  };

  const handleExport = (fmt: "csv" | "pdf") => {
    const rows = sortRegs(registrations ?? [], "Confirmed");
    if (rows.length === 0) {
      toast({ title: "Nothing to export", description: "There are no registered participants.", variant: "destructive" });
      return;
    }
    const cols = exportColumns();
    const safeName = (event?.name ?? "event").replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || "event";
    if (fmt === "csv") {
      const esc = (v: string) => `"${String(v).replace(/"/g, '""')}"`;
      const lines = [cols.map(c => esc(c.label)).join(",")];
      for (const r of rows) lines.push(cols.map(c => esc(c.get(r))).join(","));
      const blob = new Blob(["\uFEFF" + lines.join("\r\n")], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `registrations-${safeName}.csv`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } else {
      const doc = new jsPDF({ orientation: "landscape" });
      doc.setFontSize(14);
      doc.text(`Registered Participants — ${event?.name ?? ""}`, 14, 15);
      autoTable(doc, {
        head: [cols.map(c => c.label)],
        body: rows.map(r => cols.map(c => c.get(r))),
        startY: 22,
        styles: { fontSize: 8, cellPadding: 2 },
        headStyles: { fillColor: [22, 163, 74] },
      });
      const blob = doc.output("blob");
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `registrations-${safeName}.pdf`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <AdminNav />
      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-6">
        <Link href={`/admin/events/${eventType}`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4">
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
                    {event.requireApproval !== "none" && <Badge variant="outline" className="text-xs border-yellow-300 text-yellow-700">{event.requireApproval === "all" ? "Approval Required" : event.requireApproval === "enforce_rating" ? "Rating Enforced" : "NR Approval Required"}</Badge>}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {canWriteEvent && (
                    <Button data-testid="button-edit-event" variant="outline" size="sm" className="gap-1.5" onClick={openEditDialog}>
                      <Pencil className="w-3.5 h-3.5" /> Edit
                    </Button>
                  )}
                  <Badge variant={event.status === "cancelled" ? "destructive" : event.status === "ended" ? "secondary" : "default"} className="capitalize">
                    {event.status}
                  </Badge>
                </div>
              </div>
              <div className="mt-4 pt-4 border-t border-border flex gap-4 text-sm">
                <span><strong className="text-primary">{confirmed.length}</strong> confirmed</span>
                {pending.length > 0 && <span><strong className="text-blue-600">{pending.length}</strong> pending</span>}
                {waitlisted.length > 0 && <span><strong className="text-yellow-600">{waitlisted.length}</strong> waitlisted</span>}
                {rejected.length > 0 && <span><strong className="text-destructive">{rejected.length}</strong> rejected</span>}
                {cancelled.length > 0 && <span><strong className="text-muted-foreground">{cancelled.length}</strong> cancelled</span>}
                {no_show.length > 0 && <span><strong className="text-orange-600">{no_show.length}</strong> no-show</span>}
                <span className="text-muted-foreground">/ {event.maxTeams} max teams</span>
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

             <EventAssignmentManager
               eventType={eventType}
               eventId={eventId}
               canManage={isAdminOrOrganizer}
             />

            {canWriteEvent && <div className="bg-card border border-card-border rounded-lg p-5 mb-6">
              <h2 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide mb-3">Add Participant Manually</h2>
              <form onSubmit={handleAdd} className="flex items-start gap-3 flex-wrap">
                <div className="space-y-1.5">
                  <Label htmlFor="add-emails">{event.teamFormat === "fixed_partner" ? "Email Address" : "Email Address(es)"}</Label>
                  {event.teamFormat === "fixed_partner" ? (
                    <Input
                      id="add-emails"
                      data-testid="input-add-emails"
                      type="email"
                      value={addEmails}
                      onChange={e => setAddEmails(e.target.value.toLowerCase())}
                      placeholder="player@example.com"
                      className="w-72 text-sm font-mono"
                      required
                    />
                  ) : (
                    <Textarea
                      id="add-emails"
                      data-testid="input-add-emails"
                      value={addEmails}
                      onChange={e => setAddEmails(e.target.value.toLowerCase())}
                      placeholder={"player@example.com\nplayer2@example.com, player3@example.com"}
                      className="w-72 h-20 text-sm font-mono resize-none"
                      required
                    />
                  )}
                  {event.teamFormat !== "fixed_partner" && (
                    <p className="text-xs text-muted-foreground">Separate multiple emails with commas, spaces, or new lines.</p>
                  )}
                </div>
                {event.teamFormat === "fixed_partner" && (
                  <div className="space-y-1.5">
                    <Label htmlFor="add-partner">Partner Email</Label>
                    <Input id="add-partner" data-testid="input-add-partner-email" value={addPartnerEmail} onChange={e => setAddPartnerEmail(e.target.value.toLowerCase())} placeholder="partner@example.com" className="w-48" />
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
            </div>}

            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mb-4 px-1 py-2 bg-muted/30 rounded-md border border-border">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Columns:</span>
              {[
                { key: "name", label: "Name" },
                { key: "duprId", label: "DUPR ID" },
                { key: "dupr", label: "DUPR" },
                { key: "selfRating", label: "Self-Rate" },
                { key: "assigned", label: "Assigned" },
                { key: "email", label: "Email" },
                { key: "phone", label: "Phone" },
                { key: "partner", label: "Partner" },
                { key: "partnerDuprId", label: "Partner DUPR ID" },
                { key: "partnerDupr", label: "Partner DUPR" },
                { key: "partnerSelfRating", label: "Partner Self-Rate" },
                { key: "teamRating", label: "Team Rating" },
                { key: "status", label: "Status" },
                { key: "role", label: "Role" },
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
                {/* ── Active status sections ──────────────────────── */}
                {[
                  { label: "Confirmed", regs: confirmed, color: "text-primary", empty: "No confirmed participants yet." },
                  { label: "Pending Approval", regs: pending, color: "text-blue-600", empty: "No pending approvals." },
                  { label: "Waitlisted", regs: waitlisted, color: "text-yellow-600", empty: "Waitlist is empty." },
                  { label: "Canceled", regs: cancelled, color: "text-muted-foreground", empty: "No canceled registrations." },
                  { label: "No-show", regs: no_show, color: "text-orange-600", empty: "No no-show registrations." },
                ].map(section => {
                  const key = section.label;
                  const sorted = sortRegs(section.regs, key);
                  const sectionPageSize = getPageSize(key);
                  const totalPages = Math.max(1, Math.ceil(sorted.length / sectionPageSize));
                  const curPage = Math.min(pageNums[key] ?? 0, totalPages - 1);
                  const paged = sorted.slice(curPage * sectionPageSize, (curPage + 1) * sectionPageSize);
                  const sortCol = sortState[key]?.col;
                  const sortDir = sortState[key]?.dir;
                  return (
                    <div key={key} className="bg-card border border-card-border rounded-lg overflow-hidden">
                      <div className="px-5 py-3 border-b border-border bg-muted/30 flex items-center justify-between flex-wrap gap-2">
                        <div>
                          <span className={`text-sm font-semibold ${section.color}`}>{section.label}</span>
                          <span className="ml-2 text-xs text-muted-foreground">({section.regs.length})</span>
                        </div>
                        <div className="flex items-center gap-3 flex-wrap">
                          {canWriteEvent && key === "Confirmed" && (
                            <div className="flex items-center gap-2 pr-3 border-r border-border">
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button size="sm" variant="outline" className="h-7 px-2 text-xs gap-1" data-testid="button-notify">
                                    <Mail className="w-3 h-3" /> Notify <ChevronDown className="w-3 h-3" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuItem data-testid="action-email-broadcast" onClick={() => openNotifyDialog("email", "broadcast")}>
                                    <Mail className="w-3.5 h-3.5 mr-2" /> Email broadcast
                                  </DropdownMenuItem>
                                  <DropdownMenuItem data-testid="action-email-client" onClick={handleEmailClient}>
                                    <Mail className="w-3.5 h-3.5 mr-2" /> Email client
                                  </DropdownMenuItem>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem data-testid="action-text-broadcast" disabled>
                                    <MessageSquare className="w-3.5 h-3.5 mr-2" /> Text broadcast
                                  </DropdownMenuItem>
                                  <DropdownMenuItem data-testid="action-text-client" onClick={handleTextClient}>
                                    <MessageSquare className="w-3.5 h-3.5 mr-2" /> Text client
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 px-2 text-xs gap-1"
                                data-testid="button-set-all-to-dupr"
                                disabled={bulkSetAssigned.isPending}
                                onClick={() => bulkSetAssigned.mutate()}
                              >
                                Set Assigned to DUPR
                              </Button>
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button size="sm" variant="outline" className="h-7 px-2 text-xs gap-1" data-testid="button-export">
                                    <Download className="w-3 h-3" /> Export <ChevronDown className="w-3 h-3" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuItem data-testid="action-export-csv" onClick={() => handleExport("csv")}>Export CSV</DropdownMenuItem>
                                  <DropdownMenuItem data-testid="action-export-pdf" onClick={() => handleExport("pdf")}>Export PDF</DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </div>
                          )}
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground">Per page:</span>
                            <Select value={String(sectionPageSize)} onValueChange={v => { setPageSizes(prev => ({ ...prev, [key]: Number(v) })); setPageNums(prev => { const next = { ...prev }; delete next[key]; return next; }); }}>
                              <SelectTrigger className="h-6 w-16 text-xs px-2"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="10">10</SelectItem>
                                <SelectItem value="25">25</SelectItem>
                                <SelectItem value="50">50</SelectItem>
                                <SelectItem value="75">75</SelectItem>
                                <SelectItem value="100">100</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-border">
                              <th className="text-left px-5 py-2.5 font-medium text-muted-foreground w-10">#</th>
                              {col("name") && <SortHeader label="Name" col="name" activeCol={sortCol} dir={sortDir} onSort={() => toggleSort(key, "name")} />}
                              {col("duprId") && <th className="text-left px-5 py-2.5 font-medium text-muted-foreground">DUPR ID</th>}
                              {col("dupr") && <SortHeader label="DUPR" col="dupr" activeCol={sortCol} dir={sortDir} onSort={() => toggleSort(key, "dupr")} />}
                              {col("selfRating") && <SortHeader label="Self-Rate" col="selfRating" activeCol={sortCol} dir={sortDir} onSort={() => toggleSort(key, "selfRating")} />}
                              {col("assigned") && <SortHeader label="Assigned" col="assigned" activeCol={sortCol} dir={sortDir} onSort={() => toggleSort(key, "assigned")} />}
                              {col("email") && <SortHeader label="Email" col="email" activeCol={sortCol} dir={sortDir} onSort={() => toggleSort(key, "email")} />}
                              {col("phone") && <SortHeader label="Phone" col="phone" activeCol={sortCol} dir={sortDir} onSort={() => toggleSort(key, "phone")} />}
                              {col("partner") && <SortHeader label="Partner" col="partner" activeCol={sortCol} dir={sortDir} onSort={() => toggleSort(key, "partner")} />}
                              {col("partnerDuprId") && <th className="text-left px-5 py-2.5 font-medium text-muted-foreground">Partner DUPR ID</th>}
                              {col("partnerDupr") && <SortHeader label="Partner DUPR" col="partnerDupr" activeCol={sortCol} dir={sortDir} onSort={() => toggleSort(key, "partnerDupr")} />}
                              {col("partnerSelfRating") && <SortHeader label="Partner Self-Rate" col="partnerSelfRating" activeCol={sortCol} dir={sortDir} onSort={() => toggleSort(key, "partnerSelfRating")} />}
                              {col("teamRating") && <SortHeader label="Team Rating" col="teamRating" activeCol={sortCol} dir={sortDir} onSort={() => toggleSort(key, "teamRating")} />}
                              {col("status") && <SortHeader label="Status" col="status" activeCol={sortCol} dir={sortDir} onSort={() => toggleSort(key, "status")} />}
                              {col("role") && <SortHeader label="Role" col="role" activeCol={sortCol} dir={sortDir} onSort={() => toggleSort(key, "role")} />}
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
                                    { eventType, id: eventId, regId: reg.id, data: { assignedRating: n } },
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
                                  <td className="px-5 py-3 text-muted-foreground font-mono text-xs">{curPage * sectionPageSize + idx + 1}</td>
                                  {col("name") && <td className="px-5 py-3 font-medium">{reg.playerName}</td>}
                                  {col("duprId") && <td className="px-5 py-3 font-mono text-xs text-muted-foreground">{reg.memberDuprId}</td>}
                                  {col("dupr") && (
                                    <td className="px-5 py-3 font-mono">
                                      {reg.doubleRating || "NR"}
                                    </td>
                                  )}
                                  {col("selfRating") && (
                                    <td className="px-2 py-2">
                                      {(() => {
                                        const storedSelfRating = reg.selfRating ?? null;
                                        const editSelfVal = editingSelfRatings[reg.id] !== undefined ? editingSelfRatings[reg.id] : (storedSelfRating != null ? String(storedSelfRating) : "");
                                        const saveSelfRating = (val: string) => {
                                          const parsed = val.trim() === "" ? null : val;
                                          if (parsed !== storedSelfRating) {
                                            const num = parsed !== null ? parseFloat(parsed) : null;
                                            if (parsed !== null && (isNaN(num!) || num! < 2.0 || num! > 5.0)) {
                                              toast({ title: "Self-rating must be between 2.0 and 5.0", variant: "destructive" });
                                              setEditingSelfRatings(prev => { const next = { ...prev }; delete next[reg.id]; return next; });
                                              return;
                                            }
                                            if (parsed !== null && !/^\d+(\.\d{1,2})?$/.test(parsed)) {
                                              toast({ title: "Self-rating must have at most 2 decimal places", variant: "destructive" });
                                              setEditingSelfRatings(prev => { const next = { ...prev }; delete next[reg.id]; return next; });
                                              return;
                                            }
                                            updateReg.mutate(
                                              { eventType, id: eventId, regId: reg.id, data: { selfRating: parsed } },
                                              {
                                                onSuccess: () => { invalidate(); setEditingSelfRatings(prev => { const next = { ...prev }; delete next[reg.id]; return next; }); },
                                                onError: () => toast({ title: "Failed to update self-rating", variant: "destructive" }),
                                              }
                                            );
                                          } else {
                                            setEditingSelfRatings(prev => { const next = { ...prev }; delete next[reg.id]; return next; });
                                          }
                                        };
                                        return (
                                          <input
                                            data-testid={`input-self-rating-${reg.id}`}
                                            disabled={!canWriteEvent}
                                            type="number"
                                            step="0.01"
                                            min="2"
                                            max="5"
                                            placeholder="—"
                                            className="w-20 h-7 text-sm font-mono px-2 rounded border border-transparent bg-transparent hover:border-border focus:border-primary focus:bg-background focus:outline-none focus:ring-0 transition-colors"
                                            value={editSelfVal}
                                            onChange={e => setEditingSelfRatings(prev => ({ ...prev, [reg.id]: e.target.value }))}
                                            onBlur={e => saveSelfRating(e.target.value)}
                                            onKeyDown={e => {
                                              if (e.key === "Enter") e.currentTarget.blur();
                                              if (e.key === "Escape") setEditingSelfRatings(prev => { const next = { ...prev }; delete next[reg.id]; return next; });
                                            }}
                                          />
                                        );
                                      })()}
                                    </td>
                                  )}
                                  {col("assigned") && (
                                    <td className="px-2 py-2">
                                      <input
                                        data-testid={`input-assigned-rating-${reg.id}`}
                                        disabled={!canWriteEvent}
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
                                  {col("partner") && <td className="px-5 py-3 text-muted-foreground">{reg.partnerName || "—"}</td>}
                                  {col("partnerDuprId") && <td className="px-5 py-3 font-mono text-xs text-muted-foreground">{reg.partnerDuprId || "—"}</td>}
                                  {col("partnerDupr") && <td className="px-5 py-3 font-mono">{reg.partnerDoubleRating || "NR"}</td>}
                                  {col("partnerSelfRating") && <td className="px-5 py-3 font-mono text-xs">{(reg as any).partnerSelfRating != null ? (reg as any).partnerSelfRating : "—"}</td>}
                                  {col("teamRating") && <td className="px-5 py-3 font-mono">{reg.teamRating || "NR"}</td>}
                                  {col("status") && <td className="px-5 py-3"><StatusBadge status={reg.status} /></td>}
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
                                  {col("signedUp") && (
                                    <td className="px-5 py-3 text-xs text-muted-foreground whitespace-nowrap">
                                      {reg.registeredAt ? format(new Date(reg.registeredAt), "MMM d, yyyy h:mm a") : "—"}
                                    </td>
                                  )}
                                  <td className="px-5 py-3">
                                    <div className="flex items-center justify-end">
                                      <DropdownMenu>
                                        <DropdownMenuTrigger asChild>
                                          <Button data-testid={`button-actions-${reg.id}`} size="sm" variant="outline" className="gap-1 h-7 px-2" disabled={!canWriteEvent}>
                                            Actions <ChevronDown className="w-3 h-3" />
                                          </Button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent align="end" className="w-48">
                                          <DropdownMenuItem data-testid={`action-edit-${reg.id}`} className="gap-2" onClick={() => openEditRegDialog(reg)}>
                                            <Pencil className="w-3.5 h-3.5 text-primary" /> Edit
                                          </DropdownMenuItem>
                                          <DropdownMenuSeparator />
                                          {reg.status !== "confirmed" && (
                                            <DropdownMenuItem data-testid={`action-move-to-confirmed-${reg.id}`} className="gap-2" onClick={() => handleConfirmReg(reg.id)}>
                                              <CheckCircle className="w-3.5 h-3.5 text-primary" /> Move to Confirmed
                                            </DropdownMenuItem>
                                          )}
                                          {reg.status !== "pending_approval" && (
                                            <DropdownMenuItem data-testid={`action-move-to-pending-${reg.id}`} className="gap-2" onClick={() => updateReg.mutate({ eventType, id: eventId, regId: reg.id, data: { status: "pending_approval" } as any }, { onSuccess: () => { toast({ title: "Moved to pending approval" }); invalidate(); }, onError: () => toast({ title: "Failed", variant: "destructive" }) })}>
                                              <Clock className="w-3.5 h-3.5 text-blue-600" /> Move to Pending Approval
                                            </DropdownMenuItem>
                                          )}
                                          {reg.status !== "waitlisted" && (
                                            <DropdownMenuItem data-testid={`action-move-to-waitlist-${reg.id}`} className="gap-2" onClick={() => handleMoveToWaitlist(reg.id)}>
                                              <List className="w-3.5 h-3.5 text-yellow-600" /> Move to Waitlist
                                            </DropdownMenuItem>
                                          )}
                                          {reg.status !== "rejected" && (
                                            <DropdownMenuItem data-testid={`action-move-to-rejected-${reg.id}`} className="gap-2" onClick={() => updateReg.mutate({ eventType, id: eventId, regId: reg.id, data: { status: "rejected" } as any }, { onSuccess: () => { toast({ title: "Moved to rejected" }); invalidate(); }, onError: () => toast({ title: "Failed", variant: "destructive" }) })}>
                                              <XCircle className="w-3.5 h-3.5 text-destructive" /> Move to Rejected
                                            </DropdownMenuItem>
                                          )}
                                          {reg.status !== "cancelled" && (
                                            <DropdownMenuItem data-testid={`action-move-to-cancelled-${reg.id}`} className="gap-2" onClick={() => handleCancelReg(reg.id)}>
                                              <XCircle className="w-3.5 h-3.5 text-muted-foreground" /> Move to Canceled
                                            </DropdownMenuItem>
                                          )}
                                          {reg.status !== "no_show" && (
                                            <DropdownMenuItem data-testid={`action-move-to-no-show-${reg.id}`} className="gap-2" onClick={() => handleNoShowReg(reg.id)}>
                                              <XCircle className="w-3.5 h-3.5 text-orange-500" /> Move to No-show
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
                                                    { eventType, id: eventId, regId: reg.id, data: { eventRole: reg.eventRole === role ? null : role } },
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
                            {paged.length === 0 && (
                              <tr>
                                <td colSpan={visibleColCount} className="px-5 py-8 text-center text-sm text-muted-foreground">
                                  {section.empty}
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                      {totalPages > 1 && (
                        <div className="flex items-center justify-between px-5 py-3 border-t border-border bg-muted/10">
                          <span className="text-xs text-muted-foreground">
                            {curPage * sectionPageSize + 1}–{Math.min((curPage + 1) * sectionPageSize, sorted.length)} of {sorted.length}
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

                {/* ── Rejected ─────────────────────────────────────── */}
                {rejected.length > 0 && (
                  <div className="bg-muted border border-border rounded-lg overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setShowRemoved(prev => !prev)}
                      className="w-full px-5 py-3 border-b border-border bg-muted/50 flex items-center justify-between gap-3 hover:bg-muted/80 transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <span className="text-sm font-semibold text-destructive">Rejected</span>
                        <span className="text-xs text-muted-foreground">({rejected.length})</span>
                      </div>
                      {showRemoved ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                    </button>
                    {showRemoved && (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-border">
                              <th className="text-left px-5 py-2 font-medium text-muted-foreground w-10">#</th>
                              {col("name") && <SortHeader label="Name" col="name" activeCol={sortState["Rejected"]?.col} dir={sortState["Rejected"]?.dir} onSort={() => toggleSort("Rejected", "name")} />}
                              {col("duprId") && <th className="text-left px-5 py-2 font-medium text-muted-foreground">DUPR ID</th>}
                              {col("dupr") && <SortHeader label="DUPR" col="dupr" activeCol={sortState["Rejected"]?.col} dir={sortState["Rejected"]?.dir} onSort={() => toggleSort("Rejected", "dupr")} />}
                              {col("email") && <SortHeader label="Email" col="email" activeCol={sortState["Rejected"]?.col} dir={sortState["Rejected"]?.dir} onSort={() => toggleSort("Rejected", "email")} />}
                              {col("signedUp") && <SortHeader label="Signed Up" col="signedUp" activeCol={sortState["Rejected"]?.col} dir={sortState["Rejected"]?.dir} onSort={() => toggleSort("Rejected", "signedUp")} />}
                              <th className="text-right px-5 py-2 font-medium text-muted-foreground">Actions</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(() => {
                              const sorted = sortRegs(rejected, "Rejected");
                              const pageSize = getPageSize("Rejected");
                              const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
                              const curPage = Math.min(pageNums["Rejected"] ?? 0, totalPages - 1);
                              const paged = sorted.slice(curPage * pageSize, (curPage + 1) * pageSize);
                              return paged.map((reg, idx) => (
                                <tr key={reg.id} data-testid={`row-reg-${reg.id}`} className="border-b border-border last:border-0 hover:bg-muted/20">
                                  <td className="px-5 py-2 text-muted-foreground font-mono text-xs">{curPage * pageSize + idx + 1}</td>
                                  {col("name") && <td className="px-5 py-2 font-medium">{reg.playerName}</td>}
                                  {col("duprId") && <td className="px-5 py-2 font-mono text-xs text-muted-foreground">{reg.memberDuprId}</td>}
                                  {col("dupr") && (
                                    <td className="px-5 py-2 font-mono">
                                      {reg.doubleRating || "NR"}
                                    </td>
                                  )}
                                  {col("email") && <td className="px-5 py-2 text-xs">{(reg as any).playerEmail ? <a href={`mailto:${(reg as any).playerEmail}`} className="text-primary hover:underline">{(reg as any).playerEmail}</a> : <span className="text-muted-foreground">—</span>}</td>}
                                  {col("signedUp") && <td className="px-5 py-2 text-xs text-muted-foreground whitespace-nowrap">{reg.registeredAt ? format(new Date(reg.registeredAt), "MMM d, yyyy h:mm a") : "—"}</td>}
                                  <td className="px-5 py-2">
                                    <div className="flex items-center justify-end">
                                      <DropdownMenu>
                                        <DropdownMenuTrigger asChild>
                                          <Button data-testid={`button-actions-${reg.id}`} size="sm" variant="outline" className="gap-1 h-7 px-2" disabled={!canWriteEvent}>
                                            Actions <ChevronDown className="w-3 h-3" />
                                          </Button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent align="end" className="w-48">
                                          <DropdownMenuItem data-testid={`action-edit-${reg.id}`} className="gap-2" onClick={() => openEditRegDialog(reg)}>
                                            <Pencil className="w-3.5 h-3.5 text-primary" /> Edit
                                          </DropdownMenuItem>
                                          <DropdownMenuSeparator />
                                          <DropdownMenuItem data-testid={`action-move-to-confirmed-${reg.id}`} className="gap-2" onClick={() => handleConfirmReg(reg.id)}>
                                            <CheckCircle className="w-3.5 h-3.5 text-primary" /> Move to Confirmed
                                          </DropdownMenuItem>
                                          <DropdownMenuItem data-testid={`action-move-to-pending-${reg.id}`} className="gap-2" onClick={() => updateReg.mutate({ eventType, id: eventId, regId: reg.id, data: { status: "pending_approval" } as any }, { onSuccess: () => { toast({ title: "Moved to pending approval" }); invalidate(); }, onError: () => toast({ title: "Failed", variant: "destructive" }) })}>
                                            <Clock className="w-3.5 h-3.5 text-blue-600" /> Move to Pending Approval
                                          </DropdownMenuItem>
                                          <DropdownMenuItem data-testid={`action-move-to-waitlist-${reg.id}`} className="gap-2" onClick={() => handleMoveToWaitlist(reg.id)}>
                                            <List className="w-3.5 h-3.5 text-yellow-600" /> Move to Waitlist
                                          </DropdownMenuItem>
                                          <DropdownMenuItem data-testid={`action-move-to-cancelled-${reg.id}`} className="gap-2" onClick={() => handleCancelReg(reg.id)}>
                                            <XCircle className="w-3.5 h-3.5 text-muted-foreground" /> Move to Canceled
                                          </DropdownMenuItem>
                                          <DropdownMenuItem data-testid={`action-move-to-no-show-${reg.id}`} className="gap-2" onClick={() => handleNoShowReg(reg.id)}>
                                            <XCircle className="w-3.5 h-3.5 text-orange-500" /> Move to No-show
                                          </DropdownMenuItem>
                                        </DropdownMenuContent>
                                      </DropdownMenu>
                                    </div>
                                  </td>
                                </tr>
                              ));
                            })()}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}
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

      {/* ── Notify Client Recipient Picker ─────────────────── */}
      <Dialog open={!!clientDialog} onOpenChange={open => { if (!open) setClientDialog(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {(clientDialog?.mode === "text" ? "Text" : "Email")}{" "}
              {(clientDialog?.kind === "broadcast" ? "broadcast" : "confirmed participants")}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <label className="flex items-center gap-2 text-sm font-medium border-b border-border pb-2 cursor-pointer">
              <input
                type="checkbox"
                data-testid="checkbox-client-select-all"
                className="w-4 h-4 accent-primary cursor-pointer"
                checked={allClientSelected}
                ref={el => { if (el) el.indeterminate = someClientSelected; }}
                onChange={e => toggleClientAll(e.target.checked)}
              />
              Select all ({clientRecipients.length})
            </label>
            <div className="max-h-56 overflow-y-auto space-y-1 pr-1">
              {clientRecipients.map(r => {
                const contact = clientDialog?.mode === "text" ? (r as any).playerPhone : (r as any).playerEmail;
                return (
                  <label key={r.id} data-testid={`row-client-${r.id}`} className="flex items-center gap-2 py-1.5 px-1 rounded hover:bg-muted/40 cursor-pointer">
                    <input
                      type="checkbox"
                      data-testid={`checkbox-client-${r.id}`}
                      className="w-4 h-4 accent-primary cursor-pointer shrink-0"
                      checked={clientSelectedIds.has(r.id)}
                      onChange={e => toggleClientId(r.id, e.target.checked)}
                    />
                    <span className="text-sm font-medium truncate">{(r as any).playerName}</span>
                    <span className="text-xs text-muted-foreground truncate ml-auto">{contact}</span>
                  </label>
                );
              })}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="notify-message" className="text-sm font-medium">Message</Label>
              <Textarea
                id="notify-message"
                data-testid="textarea-notify-message"
                rows={6}
                value={clientMessage}
                onChange={e => setClientMessage(e.target.value)}
                placeholder="Add a message for participants…"
              />
            </div>
          </div>
          <DialogFooter className="flex-row items-center gap-2">
            <span className="text-xs text-muted-foreground mr-auto">{clientSelectedCount} selected</span>
            <Button type="button" variant="outline" onClick={() => setClientDialog(null)} data-testid="button-client-cancel">Cancel</Button>
            <Button type="button" onClick={confirmClientDialog} disabled={clientSelectedCount === 0} data-testid="button-client-ok">OK</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
                  <Label htmlFor="edit-name">Event Name *</Label>
                  <Input id="edit-name" value={editForm.name ?? ""} onChange={e => setEditForm((f: any) => ({ ...f, name: e.target.value }))} required />
                </div>
                <div className="space-y-1.5">
                  <Label>Event Description</Label>
                  <RichTextEditor
                    value={editForm.eventDescription ?? ""}
                    onChange={v => setEditForm((f: any) => ({ ...f, eventDescription: v }))}
                    placeholder="Describe the event, what to expect, and any special details..."
                  />
                </div>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label>Guidelines and Rules</Label>
                    <button
                      type="button"
                      data-testid="button-edit-update-guidelines"
                      onClick={() => setEditForm((f: any) => ({ ...f, description: settings?.guidelinesAndRules || "" }))}
                      className="text-xs text-primary hover:underline"
                    >
                      Update
                    </button>
                  </div>
                  <RichTextEditor
                    value={editForm.description ?? ""}
                    onChange={v => setEditForm((f: any) => ({ ...f, description: v }))}
                    placeholder="Add rules, requirements, waivers, and other guidelines..."
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="edit-start">Start Date & Time</Label>
                    <DateTimeInput id="edit-start" value={editForm.startDatetime ?? ""} onChange={v => setEditForm((f: any) => ({ ...f, startDatetime: v }))} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="edit-end">End Date & Time</Label>
                    <DateTimeInput id="edit-end" value={editForm.endDatetime ?? ""} onChange={v => setEditForm((f: any) => ({ ...f, endDatetime: v }))} />
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
                    <Label htmlFor="edit-min">Min Teams</Label>
                    <Input id="edit-min" data-testid="input-edit-min-participants" type="number" min={1} aria-invalid={hasInvertedLimits(editForm.minParticipants, editForm.maxParticipants)} value={editForm.minParticipants ?? ""} onChange={e => setEditForm((f: any) => ({ ...f, minParticipants: e.target.value }))} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="edit-max">Max Teams *</Label>
                    <Input id="edit-max" data-testid="input-edit-max-participants" type="number" min={1} aria-invalid={hasInvertedLimits(editForm.minParticipants, editForm.maxParticipants)} value={editForm.maxParticipants ?? ""} onChange={e => setEditForm((f: any) => ({ ...f, maxParticipants: e.target.value }))} required />
                  </div>
                </div>
                {hasInvertedLimits(editForm.minParticipants, editForm.maxParticipants) && (
                  <p role="alert" data-testid="event-limit-error" className="text-sm text-destructive">
                    Minimum teams cannot exceed maximum teams.
                  </p>
                )}

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
                      <div className="space-y-1">
                        <Label className="text-xs">Maximum Partner DUPR Difference</Label>
                        <Input data-testid="input-edit-max-partner-gap" type="number" step={0.01} min={0} max={fixedPartnerConfig.defaults.rating.maxPartnerGapInput} value={editRatingConfig.maxPartnerGap ?? fixedPartnerConfig.defaults.rating.maxPartnerGap} onChange={e => setEditRatingConfig((c: any) => ({ ...c, maxPartnerGap: Number(e.target.value) }))} />
                        <p className="text-xs text-muted-foreground">Teams are blocked when partners differ by more than this amount.</p>
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
                      <SelectItem value="enforce_rating">Enforce Rating</SelectItem>
                    </SelectContent>
                  </Select>
                  {editForm.requireApproval === "enforce_rating" && (
                    <p className="text-xs text-muted-foreground">Players whose rating is outside the Rating Requirement range will be blocked from registering.</p>
                  )}
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
                    <DateTimeInput value={editForm.signupStartDatetime ?? ""} onChange={v => setEditForm((f: any) => ({ ...f, signupStartDatetime: v }))} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Signup Closes</Label>
                    <DateTimeInput value={editForm.signupEndDatetime ?? ""} onChange={v => setEditForm((f: any) => ({ ...f, signupEndDatetime: v }))} />
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <input type="checkbox" id="edit-show-signup-end" className="w-4 h-4 accent-primary cursor-pointer" checked={editForm.showSignupEnd} onChange={e => setEditForm((f: any) => ({ ...f, showSignupEnd: e.target.checked }))} />
                  <label htmlFor="edit-show-signup-end" className="text-sm cursor-pointer">Show signup close time on public event page</label>
                </div>
                <div className="space-y-1.5">
                  <Label>Status</Label>
                  <Select value={editForm.status ?? "upcoming"} onValueChange={v => setEditForm((f: any) => ({ ...f, status: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="upcoming">Upcoming</SelectItem>
                      <SelectItem value="closed">Closed</SelectItem>
                      <SelectItem value="ended">Ended</SelectItem>
                      <SelectItem value="cancelled">Cancelled</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
            <DialogFooter className="flex-row items-center gap-2">
              {user?.role === USER_ROLE_IDS.admin && (
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

      {/* ── Edit Registration Dialog ───────────────────────── */}
      <Dialog open={editRegId !== null} onOpenChange={open => { if (!open) setEditRegId(null); }}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Edit Registration</DialogTitle></DialogHeader>
          <form onSubmit={handleEditRegSubmit}>
            <div className="space-y-4 py-2">
              {/* Registration Data */}
              <div className="space-y-3">
                <h2 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">Registration Data</h2>
                <div className="space-y-1.5">
                  <Label>Status</Label>
                  <Select value={editRegForm.status ?? "confirmed"} onValueChange={v => setEditRegForm((f: any) => ({ ...f, status: v }))}>
                    <SelectTrigger data-testid="select-edit-reg-status"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="confirmed">Confirmed</SelectItem>
                      <SelectItem value="waitlisted">Waitlisted</SelectItem>
                      <SelectItem value="pending_approval">Pending Approval</SelectItem>
                      <SelectItem value="rejected">Rejected</SelectItem>
                      <SelectItem value="cancelled">Canceled</SelectItem>
                      <SelectItem value="no_show">No-show</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="edit-reg-assigned">Assigned Rating</Label>
                    <Input id="edit-reg-assigned" data-testid="input-edit-reg-assigned" type="number" step="0.01" min="0" max="8" placeholder="—" value={editRegForm.assignedRating ?? ""} onChange={e => setEditRegForm((f: any) => ({ ...f, assignedRating: e.target.value }))} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="edit-reg-self">Self-Rating</Label>
                    <Input id="edit-reg-self" data-testid="input-edit-reg-self" type="number" step="0.01" min="2" max="5" placeholder="—" value={editRegForm.selfRating ?? ""} onChange={e => setEditRegForm((f: any) => ({ ...f, selfRating: e.target.value }))} />
                  </div>
                </div>
                {eventRolesList.length > 0 && (
                  <div className="space-y-1.5">
                    <Label>Event Role</Label>
                    <Select value={editRegForm.eventRole ?? "__none__"} onValueChange={v => setEditRegForm((f: any) => ({ ...f, eventRole: v }))}>
                      <SelectTrigger data-testid="select-edit-reg-role"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">None</SelectItem>
                        {eventRolesList.map(role => <SelectItem key={role} value={role}>{role}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>

              {/* Replace Players */}
              <div className="space-y-3">
                <h2 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">Replace Players</h2>
                <div className="space-y-1.5">
                  <Label htmlFor="edit-reg-replace-player">Player</Label>
                  <p className="text-xs text-muted-foreground">
                    Current: {editRegForm.playerName || "—"}{editRegForm.memberDuprId ? ` (${editRegForm.memberDuprId})` : ""}
                  </p>
                  <Input id="edit-reg-replace-player" data-testid="input-edit-reg-replace-player" placeholder="New player email or DUPR ID" value={editRegForm.replacePlayer ?? ""} onChange={e => setEditRegForm((f: any) => ({ ...f, replacePlayer: e.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="edit-reg-replace-partner">Partner</Label>
                  <p className="text-xs text-muted-foreground">
                    Current: {editRegForm.partnerName || "—"}{editRegForm.partnerDuprId ? ` (${editRegForm.partnerDuprId})` : ""}
                  </p>
                  <Input id="edit-reg-replace-partner" data-testid="input-edit-reg-replace-partner" placeholder="New partner email or DUPR ID" value={editRegForm.replacePartner ?? ""} onChange={e => setEditRegForm((f: any) => ({ ...f, replacePartner: e.target.value }))} />
                </div>
                <p className="text-xs text-muted-foreground">Leave a field blank to keep the current player. The member must exist in the member list.</p>
              </div>
            </div>
            <DialogFooter className="flex-row items-center gap-2">
              <Button type="button" variant="outline" onClick={() => setEditRegId(null)}>Cancel</Button>
              <Button type="submit" data-testid="button-submit-edit-reg" disabled={updateReg.isPending}>
                {updateReg.isPending ? "Saving..." : "Save Changes"}
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
