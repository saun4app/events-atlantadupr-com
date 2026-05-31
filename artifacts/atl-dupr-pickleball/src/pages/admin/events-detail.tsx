import { useState, useEffect } from "react";
import { useParams, useLocation, Link } from "wouter";
import {
  useGetEvent, useListRegistrations, useUpdateEvent,
  useApproveRegistration, useRejectRegistration, usePromoteFromWaitlist,
  useDeleteRegistration, useCreateRegistration,
  getGetEventQueryKey, getListRegistrationsQueryKey, getGetEventRosterSummaryQueryKey,
  getListEventsQueryKey
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { AdminNav } from "@/components/admin-nav";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { ChevronLeft, UserPlus, Trash2, CheckCircle, XCircle, ArrowUp, MapPin, Calendar } from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; className: string }> = {
    confirmed: { label: "Confirmed", className: "bg-primary/10 text-primary border-primary/20 border" },
    waitlisted: { label: "Waitlisted", className: "bg-yellow-100 text-yellow-700 border-yellow-200 border" },
    pending_approval: { label: "Pending", className: "bg-blue-100 text-blue-700 border-blue-200 border" },
    rejected: { label: "Rejected", className: "bg-destructive/10 text-destructive border-destructive/20 border" },
  };
  const s = map[status] ?? { label: status, className: "" };
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${s.className}`}>{s.label}</span>;
}

function isNonNumeric(rating: string | null | undefined): boolean {
  if (!rating) return false;
  return isNaN(parseFloat(rating)) || rating === "NR";
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

  const updateEvent = useUpdateEvent();
  const approveReg = useApproveRegistration();
  const rejectReg = useRejectRegistration();
  const promoteReg = usePromoteFromWaitlist();
  const deleteReg = useDeleteRegistration();
  const createReg = useCreateRegistration();

  const [deleteRegId, setDeleteRegId] = useState<number | null>(null);
  const [addDuprId, setAddDuprId] = useState("");
  const [addPartnerDuprId, setAddPartnerDuprId] = useState("");

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: getListRegistrationsQueryKey(eventId) });
    queryClient.invalidateQueries({ queryKey: getGetEventRosterSummaryQueryKey(eventId) });
  }

  function handleApprove(regId: number) {
    approveReg.mutate({ id: eventId, regId }, { onSuccess: () => { toast({ title: "Approved" }); invalidate(); }, onError: () => toast({ title: "Failed", variant: "destructive" }) });
  }
  function handleReject(regId: number) {
    rejectReg.mutate({ id: eventId, regId }, { onSuccess: () => { toast({ title: "Rejected" }); invalidate(); }, onError: () => toast({ title: "Failed", variant: "destructive" }) });
  }
  function handlePromote(regId: number) {
    promoteReg.mutate({ id: eventId, regId }, { onSuccess: () => { toast({ title: "Promoted from waitlist" }); invalidate(); }, onError: () => toast({ title: "Failed", variant: "destructive" }) });
  }
  function handleDelete() {
    if (deleteRegId === null) return;
    deleteReg.mutate({ id: eventId, regId: deleteRegId }, { onSuccess: () => { toast({ title: "Removed" }); invalidate(); setDeleteRegId(null); }, onError: () => toast({ title: "Failed", variant: "destructive" }) });
  }
  function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    createReg.mutate(
      { id: eventId, data: { memberDuprId: addDuprId.trim(), partnerDuprId: event?.formatType === "fixed_partner" ? addPartnerDuprId.trim() || null : null } },
      {
        onSuccess: () => { toast({ title: "Participant added" }); setAddDuprId(""); setAddPartnerDuprId(""); invalidate(); },
        onError: (err: any) => toast({ title: err?.data?.error || "Failed to add participant", variant: "destructive" }),
      }
    );
  }

  function handleStatusChange(newStatus: string) {
    updateEvent.mutate({ id: eventId, data: { status: newStatus as any } }, {
      onSuccess: () => {
        toast({ title: "Status updated" });
        queryClient.invalidateQueries({ queryKey: getGetEventQueryKey(eventId) });
        queryClient.invalidateQueries({ queryKey: getListEventsQueryKey({}) });
      },
      onError: () => toast({ title: "Failed to update status", variant: "destructive" }),
    });
  }

  const isAdmin = user?.role === "admin";

  const confirmed = registrations?.filter(r => r.status === "confirmed") ?? [];
  const waitlisted = registrations?.filter(r => r.status === "waitlisted") ?? [];
  const pending = registrations?.filter(r => r.status === "pending_approval") ?? [];
  const rejected = registrations?.filter(r => r.status === "rejected") ?? [];

  return (
    <div className="min-h-screen bg-background">
      <AdminNav />
      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-6">
        <Link href="/admin/events" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4">
          <ChevronLeft className="w-4 h-4" />
          All Events
        </Link>

        {evLoading ? (
          <div className="space-y-4"><Skeleton className="h-40 w-full" /></div>
        ) : event ? (
          <>
            <div className="bg-card border border-card-border rounded-lg p-5 mb-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h1 className="text-xl font-bold text-foreground">{event.name}</h1>
                  <div className="flex items-center gap-3 text-sm text-muted-foreground mt-2">
                    <span className="flex items-center gap-1"><Calendar className="w-3.5 h-3.5" />{format(new Date(event.startDatetime), "MMM d, yyyy 'at' h:mm a")}</span>
                    <span className="flex items-center gap-1"><MapPin className="w-3.5 h-3.5" />{event.locationName}</span>
                  </div>
                  <div className="flex gap-2 mt-3">
                    <Badge variant="outline" className="text-xs">{event.formatType === "fixed_partner" ? "Fixed-Partner" : "Rotating"}</Badge>
                    {event.ratingTypeRequired && <Badge variant="outline" className="text-xs">DUPR Required</Badge>}
                    {event.requireApproval && <Badge variant="outline" className="text-xs border-yellow-300 text-yellow-700">Approval Required</Badge>}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Select value={event.status} onValueChange={handleStatusChange}>
                    <SelectTrigger data-testid="select-event-status" className="w-36">
                      <SelectValue />
                    </SelectTrigger>
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
                {waitlisted.length > 0 && <span><strong className="text-yellow-600">{waitlisted.length}</strong> waitlisted</span>}
                {pending.length > 0 && <span><strong className="text-blue-600">{pending.length}</strong> pending</span>}
                <span className="text-muted-foreground">/ {event.maxParticipants} max</span>
              </div>
            </div>

            <div className="bg-card border border-card-border rounded-lg p-5 mb-6">
              <h2 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide mb-3">Add Participant Manually</h2>
              <form onSubmit={handleAdd} className="flex items-end gap-3 flex-wrap">
                <div className="space-y-1.5">
                  <Label htmlFor="add-dupr">DUPR ID</Label>
                  <Input id="add-dupr" data-testid="input-add-dupr-id" value={addDuprId} onChange={e => setAddDuprId(e.target.value)} placeholder="ATL001" className="w-32" required />
                </div>
                {event.formatType === "fixed_partner" && (
                  <div className="space-y-1.5">
                    <Label htmlFor="add-partner">Partner DUPR ID</Label>
                    <Input id="add-partner" data-testid="input-add-partner-dupr-id" value={addPartnerDuprId} onChange={e => setAddPartnerDuprId(e.target.value)} placeholder="ATL002" className="w-32" />
                  </div>
                )}
                <Button type="submit" data-testid="button-add-participant" disabled={createReg.isPending} className="gap-1.5">
                  <UserPlus className="w-4 h-4" />
                  Add
                </Button>
              </form>
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
                ].map(section => (
                  section.regs.length > 0 && (
                    <div key={section.label} className="bg-card border border-card-border rounded-lg overflow-hidden">
                      <div className="px-5 py-3 border-b border-border bg-muted/30">
                        <span className={`text-sm font-semibold ${section.color}`}>{section.label}</span>
                        <span className="ml-2 text-xs text-muted-foreground">({section.regs.length})</span>
                      </div>
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-border">
                            <th className="text-left px-5 py-2.5 font-medium text-muted-foreground">Name</th>
                            {event.formatType === "fixed_partner" && <th className="text-left px-5 py-2.5 font-medium text-muted-foreground">Partner</th>}
                            <th className="text-left px-5 py-2.5 font-medium text-muted-foreground">DUPR Double</th>
                            <th className="text-left px-5 py-2.5 font-medium text-muted-foreground">Status</th>
                            <th className="text-right px-5 py-2.5 font-medium text-muted-foreground">Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {section.regs.map(reg => (
                            <tr key={reg.id} data-testid={`row-reg-${reg.id}`} className="border-b border-border last:border-0 hover:bg-muted/20">
                              <td className="px-5 py-3">
                                <div className="font-medium">{reg.playerName}</div>
                                <div className="text-xs text-muted-foreground">{reg.memberDuprId}</div>
                              </td>
                              {event.formatType === "fixed_partner" && (
                                <td className="px-5 py-3 text-muted-foreground">{reg.partnerName || "—"}</td>
                              )}
                              <td className="px-5 py-3 font-mono">
                                {reg.doubleRating || "NR"}
                                {isNonNumeric(reg.doubleRating) && reg.selfRating && (
                                  <span className="ml-2 text-xs text-muted-foreground">(self: {reg.selfRating})</span>
                                )}
                              </td>
                              <td className="px-5 py-3"><StatusBadge status={reg.status} /></td>
                              <td className="px-5 py-3">
                                <div className="flex items-center justify-end gap-1">
                                  {reg.status === "pending_approval" && (
                                    <>
                                      <Button data-testid={`button-approve-${reg.id}`} size="sm" variant="ghost" className="text-primary hover:text-primary gap-1" onClick={() => handleApprove(reg.id)}>
                                        <CheckCircle className="w-3.5 h-3.5" />
                                        Approve
                                      </Button>
                                      <Button data-testid={`button-reject-${reg.id}`} size="sm" variant="ghost" className="text-destructive hover:text-destructive gap-1" onClick={() => handleReject(reg.id)}>
                                        <XCircle className="w-3.5 h-3.5" />
                                        Reject
                                      </Button>
                                    </>
                                  )}
                                  {reg.status === "waitlisted" && (
                                    <Button data-testid={`button-promote-${reg.id}`} size="sm" variant="ghost" className="text-primary hover:text-primary gap-1" onClick={() => handlePromote(reg.id)}>
                                      <ArrowUp className="w-3.5 h-3.5" />
                                      Promote
                                    </Button>
                                  )}
                                  <Button
                                    data-testid={`button-remove-${reg.id}`}
                                    size="sm"
                                    variant="ghost"
                                    className="text-muted-foreground hover:text-destructive"
                                    onClick={() => setDeleteRegId(reg.id)}
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </Button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )
                ))}
                {(registrations?.length ?? 0) === 0 && (
                  <div className="text-center py-12 text-muted-foreground">
                    <p className="text-sm">No registrations yet.</p>
                  </div>
                )}
              </div>
            )}
          </>
        ) : (
          <div className="text-center py-12 text-muted-foreground">Event not found.</div>
        )}
      </main>

      <AlertDialog open={deleteRegId !== null} onOpenChange={open => !open && setDeleteRegId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove participant?</AlertDialogTitle>
            <AlertDialogDescription>This will remove the registration from the event. The member can re-register.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
