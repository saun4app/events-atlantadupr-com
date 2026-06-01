import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import {
  useListMembers, useCreateMember, useDeleteMember, useClearAllMembers, useUploadMembersCsv,
  useUpdateMember,
  getListMembersQueryKey
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { AdminNav } from "@/components/admin-nav";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { Plus, Search, Trash2, Upload, AlertCircle, Users, Pencil } from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";

type MemberRow = { duprId: string; playerName: string; doubleRating?: string | null; doubleReliability?: number | null; singleRating?: string | null; singleReliability?: number | null; selfRating?: string | null; email?: string | null; phone?: string | null };

const emptyForm = { duprId: "", playerName: "", doubleRating: "", doubleReliability: "", singleRating: "", singleReliability: "", selfRating: "", email: "", phone: "" };

export default function AdminMembers() {
  const { isAuthenticated, isLoading, user, isAdmin } = useAuth();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isLoading && !isAuthenticated) setLocation("/login");
    if (!isLoading && isAuthenticated && !isAdmin) setLocation("/admin/events");
  }, [isLoading, isAuthenticated, isAdmin]);

  const { data: members, isLoading: memLoading } = useListMembers(
    {},
    { query: { queryKey: getListMembersQueryKey({}) } }
  );

  const createMember = useCreateMember();
  const updateMember = useUpdateMember();
  const deleteMember = useDeleteMember();
  const clearAll = useClearAllMembers();
  const uploadCsv = useUploadMembersCsv();

  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<string>("playerName");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [showClearDialog, setShowClearDialog] = useState(false);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [addForm, setAddForm] = useState(emptyForm);
  const [editMember, setEditMember] = useState<MemberRow | null>(null);
  const [editForm, setEditForm] = useState(emptyForm);

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: getListMembersQueryKey({}) });
  }

  function handleSort(key: string) {
    if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("asc"); }
  }

  function handleDelete() {
    if (!deleteId) return;
    deleteMember.mutate({ duprId: deleteId }, {
      onSuccess: () => { toast({ title: "Member deleted" }); invalidate(); setDeleteId(null); },
      onError: () => toast({ title: "Failed to delete", variant: "destructive" }),
    });
  }

  function handleClearAll() {
    clearAll.mutate(undefined, {
      onSuccess: () => { toast({ title: "All members cleared" }); invalidate(); setShowClearDialog(false); },
      onError: () => toast({ title: "Failed to clear members", variant: "destructive" }),
    });
  }

  function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    createMember.mutate({
      data: {
        duprId: addForm.duprId.trim(),
        playerName: addForm.playerName.trim(),
        doubleRating: addForm.doubleRating.trim() || null,
        doubleReliability: addForm.doubleReliability ? Number(addForm.doubleReliability) : null,
        singleRating: addForm.singleRating.trim() || null,
        singleReliability: addForm.singleReliability ? Number(addForm.singleReliability) : null,
        selfRating: addForm.selfRating.trim() || null,
        email: addForm.email.trim() || null,
        phone: addForm.phone.trim() || null,
      } as any
    }, {
      onSuccess: () => { toast({ title: "Member added" }); invalidate(); setShowAddDialog(false); setAddForm(emptyForm); },
      onError: (err: any) => toast({ title: err?.data?.error || "Failed to add member", variant: "destructive" }),
    });
  }

  function openEdit(m: MemberRow) {
    setEditMember(m);
    setEditForm({
      duprId: m.duprId,
      playerName: m.playerName,
      doubleRating: m.doubleRating ?? "",
      doubleReliability: m.doubleReliability != null ? String(m.doubleReliability) : "",
      singleRating: m.singleRating ?? "",
      singleReliability: m.singleReliability != null ? String(m.singleReliability) : "",
      selfRating: m.selfRating ?? "",
      email: m.email ?? "",
      phone: m.phone ?? "",
    });
  }

  function handleEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editMember) return;
    updateMember.mutate({
      duprId: editMember.duprId,
      data: {
        playerName: editForm.playerName.trim(),
        doubleRating: editForm.doubleRating.trim() || null,
        doubleReliability: editForm.doubleReliability ? Number(editForm.doubleReliability) : null,
        singleRating: editForm.singleRating.trim() || null,
        singleReliability: editForm.singleReliability ? Number(editForm.singleReliability) : null,
        selfRating: editForm.selfRating.trim() || null,
        email: editForm.email.trim() || null,
        phone: editForm.phone.trim() || null,
      } as any
    }, {
      onSuccess: () => { toast({ title: "Member updated" }); invalidate(); setEditMember(null); },
      onError: (err: any) => toast({ title: err?.data?.error || "Failed to update member", variant: "destructive" }),
    });
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const csvText = ev.target?.result as string;
      uploadCsv.mutate({ data: csvText }, {
        onSuccess: () => { toast({ title: "CSV uploaded successfully" }); invalidate(); },
        onError: (err: any) => toast({ title: err?.data?.error || "CSV upload failed", variant: "destructive" }),
      });
    };
    reader.readAsText(file);
    e.target.value = "";
  }

  const filtered = (members ?? [])
    .filter(m => !search || m.playerName.toLowerCase().includes(search.toLowerCase()) || m.duprId.toLowerCase().includes(search.toLowerCase()))
    .sort((a: any, b: any) => {
      const av = a[sortKey] ?? "";
      const bv = b[sortKey] ?? "";
      const cmp = String(av).localeCompare(String(bv), undefined, { numeric: true });
      return sortDir === "asc" ? cmp : -cmp;
    });

  const SortTh = ({ label, col }: { label: string; col: string }) => (
    <th
      className="text-left px-4 py-2.5 font-medium text-muted-foreground cursor-pointer hover:text-foreground transition-colors select-none whitespace-nowrap"
      onClick={() => handleSort(col)}
    >
      {label}
      {sortKey === col && <span className="ml-1 text-primary">{sortDir === "asc" ? "↑" : "↓"}</span>}
    </th>
  );

  return (
    <div className="min-h-screen bg-background">
      <AdminNav />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold text-foreground">Manage Members</h1>
            <p className="text-muted-foreground text-sm mt-0.5">{members?.length ?? 0} members in database</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              className="hidden"
              onChange={handleFileChange}
              data-testid="input-csv-upload"
            />
            <Button
              data-testid="button-upload-csv"
              variant="outline"
              className="gap-2"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadCsv.isPending}
            >
              <Upload className="w-4 h-4" />
              {uploadCsv.isPending ? "Uploading..." : "Upload CSV"}
            </Button>
            <Button
              data-testid="button-clear-all"
              variant="outline"
              className="gap-2 text-destructive hover:text-destructive border-destructive/30"
              onClick={() => setShowClearDialog(true)}
            >
              <AlertCircle className="w-4 h-4" />
              Clear All
            </Button>
            <Button
              data-testid="button-add-member"
              className="gap-2"
              onClick={() => setShowAddDialog(true)}
            >
              <Plus className="w-4 h-4" />
              Add Member
            </Button>
          </div>
        </div>

        <div className="mb-4 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            data-testid="input-search-members"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by name or DUPR ID..."
            className="pl-9"
          />
        </div>

        <div className="bg-card border border-card-border rounded-lg overflow-hidden">
          {memLoading ? (
            <div className="p-5 space-y-3">
              {[1,2,3,4,5].map(i => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-16 text-center text-muted-foreground">
              <Users className="w-10 h-10 mx-auto mb-3 opacity-20" />
              <p className="text-sm">{search ? "No members match your search" : "No members yet. Upload a CSV or add one manually."}</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/40">
                    <SortTh label="DUPR ID" col="duprId" />
                    <SortTh label="Name" col="playerName" />
                    <SortTh label="Double Rating" col="doubleRating" />
                    <SortTh label="D. Reliability" col="doubleReliability" />
                    <SortTh label="Single Rating" col="singleRating" />
                    <SortTh label="S. Reliability" col="singleReliability" />
                    <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Self-Rating</th>
                    <SortTh label="Email" col="email" />
                    <SortTh label="Phone" col="phone" />
                    <th className="px-4 py-2.5" />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(m => (
                    <tr key={m.duprId} data-testid={`row-member-${m.duprId}`} className="border-b border-border last:border-0 hover:bg-muted/20 transition-colors">
                      <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{m.duprId}</td>
                      <td className="px-4 py-3 font-medium">{m.playerName}</td>
                      <td className="px-4 py-3 font-mono">{m.doubleRating ?? "—"}</td>
                      <td className="px-4 py-3">{m.doubleReliability != null ? `${m.doubleReliability}%` : "—"}</td>
                      <td className="px-4 py-3 font-mono">{m.singleRating ?? "—"}</td>
                      <td className="px-4 py-3">{m.singleReliability != null ? `${m.singleReliability}%` : "—"}</td>
                      <td className="px-4 py-3">{m.selfRating ?? "—"}</td>
                      <td className="px-4 py-3 text-xs">{(m as any).email ? <a href={`mailto:${(m as any).email}`} className="text-primary hover:underline">{(m as any).email}</a> : "—"}</td>
                      <td className="px-4 py-3 text-xs">{(m as any).phone || "—"}</td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            data-testid={`button-edit-member-${m.duprId}`}
                            variant="ghost"
                            size="sm"
                            className="text-muted-foreground hover:text-foreground"
                            onClick={() => openEdit(m)}
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </Button>
                          <Button
                            data-testid={`button-delete-member-${m.duprId}`}
                            variant="ghost"
                            size="sm"
                            className="text-muted-foreground hover:text-destructive"
                            onClick={() => setDeleteId(m.duprId)}
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
          )}
        </div>
      </main>

      <AlertDialog open={!!deleteId} onOpenChange={open => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete member?</AlertDialogTitle>
            <AlertDialogDescription>This will permanently remove {deleteId} from the member list.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={showClearDialog} onOpenChange={setShowClearDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear all members?</AlertDialogTitle>
            <AlertDialogDescription>This will permanently delete ALL {members?.length} members. This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-clear">Cancel</AlertDialogCancel>
            <AlertDialogAction data-testid="button-confirm-clear" onClick={handleClearAll} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Clear All Members</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Add Member</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleAdd} className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="add-dupr-id">DUPR ID *</Label>
                <Input id="add-dupr-id" data-testid="input-add-member-dupr-id" value={addForm.duprId} onChange={e => setAddForm(f => ({ ...f, duprId: e.target.value }))} required placeholder="ATL099" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="add-player-name">Player Name *</Label>
                <Input id="add-player-name" data-testid="input-add-member-name" value={addForm.playerName} onChange={e => setAddForm(f => ({ ...f, playerName: e.target.value }))} required placeholder="Jane Smith" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="add-double-rating">Double Rating</Label>
                <Input id="add-double-rating" value={addForm.doubleRating} onChange={e => setAddForm(f => ({ ...f, doubleRating: e.target.value }))} placeholder="4.25 or NR" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="add-d-rel">D. Reliability %</Label>
                <Input id="add-d-rel" type="number" min={0} max={100} value={addForm.doubleReliability} onChange={e => setAddForm(f => ({ ...f, doubleReliability: e.target.value }))} placeholder="75" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="add-single-rating">Single Rating</Label>
                <Input id="add-single-rating" value={addForm.singleRating} onChange={e => setAddForm(f => ({ ...f, singleRating: e.target.value }))} placeholder="4.10 or NR" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="add-s-rel">S. Reliability %</Label>
                <Input id="add-s-rel" type="number" min={0} max={100} value={addForm.singleReliability} onChange={e => setAddForm(f => ({ ...f, singleReliability: e.target.value }))} placeholder="60" />
              </div>
              <div className="space-y-1.5 col-span-2">
                <Label htmlFor="add-self-rating">Self-Rating</Label>
                <Input id="add-self-rating" value={addForm.selfRating} onChange={e => setAddForm(f => ({ ...f, selfRating: e.target.value }))} placeholder="3.5" />
              </div>
              <div className="space-y-1.5 col-span-2">
                <Label htmlFor="add-email">Email</Label>
                <Input id="add-email" type="email" value={addForm.email} onChange={e => setAddForm(f => ({ ...f, email: e.target.value }))} placeholder="jane@example.com" />
              </div>
              <div className="space-y-1.5 col-span-2">
                <Label htmlFor="add-phone">Phone</Label>
                <Input id="add-phone" type="tel" value={addForm.phone} onChange={e => setAddForm(f => ({ ...f, phone: e.target.value }))} placeholder="404-555-0100" />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowAddDialog(false)}>Cancel</Button>
              <Button type="submit" data-testid="button-submit-add-member" disabled={createMember.isPending}>
                {createMember.isPending ? "Adding..." : "Add Member"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editMember} onOpenChange={open => !open && setEditMember(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Edit Member — {editMember?.duprId}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleEdit} className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5 col-span-2">
                <Label htmlFor="edit-player-name">Player Name *</Label>
                <Input id="edit-player-name" data-testid="input-edit-member-name" value={editForm.playerName} onChange={e => setEditForm(f => ({ ...f, playerName: e.target.value }))} required placeholder="Jane Smith" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-double-rating">Double Rating</Label>
                <Input id="edit-double-rating" value={editForm.doubleRating} onChange={e => setEditForm(f => ({ ...f, doubleRating: e.target.value }))} placeholder="4.25 or NR" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-d-rel">D. Reliability %</Label>
                <Input id="edit-d-rel" type="number" min={0} max={100} value={editForm.doubleReliability} onChange={e => setEditForm(f => ({ ...f, doubleReliability: e.target.value }))} placeholder="75" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-single-rating">Single Rating</Label>
                <Input id="edit-single-rating" value={editForm.singleRating} onChange={e => setEditForm(f => ({ ...f, singleRating: e.target.value }))} placeholder="4.10 or NR" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-s-rel">S. Reliability %</Label>
                <Input id="edit-s-rel" type="number" min={0} max={100} value={editForm.singleReliability} onChange={e => setEditForm(f => ({ ...f, singleReliability: e.target.value }))} placeholder="60" />
              </div>
              <div className="space-y-1.5 col-span-2">
                <Label htmlFor="edit-self-rating">Self-Rating</Label>
                <Input id="edit-self-rating" value={editForm.selfRating} onChange={e => setEditForm(f => ({ ...f, selfRating: e.target.value }))} placeholder="3.5" />
              </div>
              <div className="space-y-1.5 col-span-2">
                <Label htmlFor="edit-email">Email</Label>
                <Input id="edit-email" type="email" value={editForm.email} onChange={e => setEditForm(f => ({ ...f, email: e.target.value }))} placeholder="jane@example.com" />
              </div>
              <div className="space-y-1.5 col-span-2">
                <Label htmlFor="edit-phone">Phone</Label>
                <Input id="edit-phone" type="tel" value={editForm.phone} onChange={e => setEditForm(f => ({ ...f, phone: e.target.value }))} placeholder="404-555-0100" />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditMember(null)}>Cancel</Button>
              <Button type="submit" data-testid="button-submit-edit-member" disabled={updateMember.isPending}>
                {updateMember.isPending ? "Saving..." : "Save Changes"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
