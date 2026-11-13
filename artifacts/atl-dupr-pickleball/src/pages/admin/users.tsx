import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import {
  useListUsers, useCreateUser, useUpdateUser, useDeleteUser,
  getListUsersQueryKey
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { AdminNav } from "@/components/admin-nav";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import {
  defaultNewUserRole,
  getUserRoleBadgeTone,
  getUserRoleLabel,
  userRolesConfig,
} from "@/lib/user-roles";
import { Plus, Pencil, Trash2, Shield } from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";

function RoleBadge({ role }: { role: string }) {
  const classMap: Record<string, string> = {
    primary: "bg-primary/10 text-primary border-primary/20",
    blue: "bg-blue-100 text-blue-700 border-blue-200",
    purple: "bg-purple-100 text-purple-700 border-purple-200",
    yellow: "bg-yellow-100 text-yellow-700 border-yellow-200",
    muted: "bg-muted text-muted-foreground border-border",
  };
  const tone = getUserRoleBadgeTone(role);
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${classMap[tone] ?? classMap.muted}`}>
      {getUserRoleLabel(role)}
    </span>
  );
}

export default function AdminUsers() {
  const { isAuthenticated, isLoading, user, isAdmin } = useAuth();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) setLocation("/login");
    if (!isLoading && isAuthenticated && !isAdmin) setLocation("/admin/events");
  }, [isLoading, isAuthenticated, isAdmin]);

  const { data: users, isLoading: usersLoading } = useListUsers({ query: { queryKey: getListUsersQueryKey() } });

  const createUser = useCreateUser();
  const updateUser = useUpdateUser();
  const deleteUser = useDeleteUser();

  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [addForm, setAddForm] = useState({ name: "", username: "", password: "", role: defaultNewUserRole });
  const [editUser, setEditUser] = useState<NonNullable<typeof users>[number] | null>(null);
  const [editForm, setEditForm] = useState({ duprId: "", duprFullname: "" });

  function handleDelete() {
    if (deleteId === null) return;
    deleteUser.mutate({ id: deleteId }, {
      onSuccess: () => { toast({ title: "User deleted" }); queryClient.invalidateQueries({ queryKey: getListUsersQueryKey() }); setDeleteId(null); },
      onError: () => toast({ title: "Failed to delete user", variant: "destructive" }),
    });
  }

  function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    createUser.mutate({
      data: {
        name: addForm.name.trim(),
        username: addForm.username.trim(),
        password: addForm.password,
        role: addForm.role as any,
      }
    }, {
      onSuccess: () => {
        toast({ title: "User created" });
        queryClient.invalidateQueries({ queryKey: getListUsersQueryKey() });
        setShowAddDialog(false);
         setAddForm({ name: "", username: "", password: "", role: defaultNewUserRole });
      },
      onError: (err: any) => toast({ title: err?.data?.error || "Failed to create user", variant: "destructive" }),
    });
  }

  function openEditDialog(selectedUser: NonNullable<typeof users>[number]) {
    setEditUser(selectedUser);
    setEditForm({
      duprId: selectedUser.duprId ?? "",
      duprFullname: selectedUser.duprFullname ?? "",
    });
  }

  function handleEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editUser) return;

    updateUser.mutate({
      id: editUser.id,
      data: {
        duprId: editForm.duprId.trim() || null,
        duprFullname: editForm.duprFullname.trim() || null,
      },
    }, {
      onSuccess: () => {
        toast({ title: "DUPR profile updated" });
        queryClient.invalidateQueries({ queryKey: getListUsersQueryKey() });
        setEditUser(null);
      },
      onError: (err: any) => toast({ title: err?.data?.error || "Failed to update DUPR profile", variant: "destructive" }),
    });
  }

  return (
    <div className="min-h-screen bg-background">
      <AdminNav />
      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold text-foreground">Manage Users</h1>
            <p className="text-muted-foreground text-sm mt-0.5">{users?.length ?? 0} users</p>
          </div>
          <Button
            data-testid="button-add-user"
            className="gap-2"
            onClick={() => setShowAddDialog(true)}
          >
            <Plus className="w-4 h-4" />
            Add User
          </Button>
        </div>

        <div className="bg-card border border-card-border rounded-lg overflow-hidden">
          {usersLoading ? (
            <div className="p-5 space-y-3">
              {[1,2,3].map(i => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : users && users.length > 0 ? (
            <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  <th className="text-left px-5 py-3 font-medium text-muted-foreground">Name</th>
                  <th className="text-left px-5 py-3 font-medium text-muted-foreground">Username</th>
                  <th className="text-left px-5 py-3 font-medium text-muted-foreground">DUPR ID</th>
                  <th className="text-left px-5 py-3 font-medium text-muted-foreground">DUPR Full Name</th>
                  <th className="text-left px-5 py-3 font-medium text-muted-foreground">Role</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody>
                {users.map(u => (
                  <tr key={u.id} data-testid={`row-user-${u.id}`} className="border-b border-border last:border-0 hover:bg-muted/20 transition-colors">
                    <td className="px-5 py-3 font-medium">{u.name}</td>
                    <td className="px-5 py-3 font-mono text-sm text-muted-foreground">{u.username}</td>
                    <td className="px-5 py-3 font-mono text-sm text-muted-foreground">{u.duprId || "—"}</td>
                    <td className="px-5 py-3 text-muted-foreground">{u.duprFullname || "—"}</td>
                    <td className="px-5 py-3"><RoleBadge role={u.role} /></td>
                    <td className="px-5 py-3 text-right">
                      <Button
                        data-testid={`button-edit-user-${u.id}`}
                        variant="ghost"
                        size="sm"
                        className="text-muted-foreground hover:text-foreground mr-1"
                        onClick={() => openEditDialog(u)}
                        aria-label={`Edit DUPR profile for ${u.name}`}
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                      {u.id !== user?.id && (
                        <Button
                          data-testid={`button-delete-user-${u.id}`}
                          variant="ghost"
                          size="sm"
                          className="text-muted-foreground hover:text-destructive"
                          onClick={() => setDeleteId(u.id)}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          ) : (
            <div className="py-12 text-center text-muted-foreground">
              <Shield className="w-10 h-10 mx-auto mb-3 opacity-20" />
              <p className="text-sm">No users yet.</p>
            </div>
          )}
        </div>
      </main>

      <AlertDialog open={deleteId !== null} onOpenChange={open => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this user?</AlertDialogTitle>
            <AlertDialogDescription>They will lose access to the admin panel immediately.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={editUser !== null} onOpenChange={open => !open && setEditUser(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Edit DUPR Profile</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleEdit} className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {editUser?.name} ({editUser?.username})
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="edit-dupr-id">DUPR ID</Label>
              <Input
                id="edit-dupr-id"
                data-testid="input-edit-user-dupr-id"
                value={editForm.duprId}
                onChange={e => setEditForm(form => ({ ...form, duprId: e.target.value }))}
                placeholder="Leave blank to clear"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-dupr-fullname">DUPR Full Name</Label>
              <Input
                id="edit-dupr-fullname"
                data-testid="input-edit-user-dupr-fullname"
                value={editForm.duprFullname}
                onChange={e => setEditForm(form => ({ ...form, duprFullname: e.target.value }))}
                placeholder="Leave blank to clear"
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditUser(null)}>Cancel</Button>
              <Button type="submit" data-testid="button-submit-edit-user" disabled={updateUser.isPending}>
                {updateUser.isPending ? "Saving..." : "Save Profile"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Add App Admin User</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleAdd} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="new-name">Full Name *</Label>
              <Input id="new-name" data-testid="input-new-user-name" value={addForm.name} onChange={e => setAddForm(f => ({ ...f, name: e.target.value }))} required placeholder="Jane Smith" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-username">Username *</Label>
              <Input id="new-username" data-testid="input-new-user-username" value={addForm.username} onChange={e => setAddForm(f => ({ ...f, username: e.target.value }))} required placeholder="jsmith" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-password">Password *</Label>
              <Input id="new-password" data-testid="input-new-user-password" type="password" value={addForm.password} onChange={e => setAddForm(f => ({ ...f, password: e.target.value }))} required placeholder="••••••••" />
            </div>
            <div className="space-y-1.5">
              <Label>Role *</Label>
              <Select value={addForm.role} onValueChange={v => setAddForm(f => ({ ...f, role: v }))}>
                <SelectTrigger data-testid="select-new-user-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {userRolesConfig.accountRoles.map((role) => (
                    <SelectItem key={role.id} value={role.id}>{role.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowAddDialog(false)}>Cancel</Button>
              <Button type="submit" data-testid="button-submit-add-user" disabled={createUser.isPending}>
                {createUser.isPending ? "Creating..." : "Create User"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
