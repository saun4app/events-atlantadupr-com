import { useEffect, useState } from "react";
import { UserPlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

type EventType = "rotating" | "fixed_partner";

interface StaffUser {
  id: number;
  name: string;
  username: string;
  role: string;
}

interface EventAssignment {
  userId: number;
  userName: string;
  userUsername: string;
  userRole: string;
}

interface EventAssignmentManagerProps {
  eventType: EventType;
  eventId: number;
  canManage: boolean;
}

function authHeaders(): HeadersInit {
  const token = localStorage.getItem("authToken");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function readJson<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: { ...authHeaders(), ...(options?.headers ?? {}) },
  });
  if (!response.ok) throw new Error("Request failed");
  return response.status === 204 ? (undefined as T) : response.json();
}

export function EventAssignmentManager({
  eventType,
  eventId,
  canManage,
}: EventAssignmentManagerProps) {
  const [assignments, setAssignments] = useState<EventAssignment[]>([]);
  const [staff, setStaff] = useState<StaffUser[]>([]);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isMutating, setIsMutating] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!canManage || !eventId) return;

    let cancelled = false;
    setIsLoading(true);
    setError(false);
    Promise.all([
      readJson<EventAssignment[]>(`/api/events/${eventType}/${eventId}/assignments`),
      readJson<StaffUser[]>("/api/users/assignable-staff"),
    ])
      .then(([nextAssignments, nextStaff]) => {
        if (cancelled) return;
        setAssignments(nextAssignments);
        setStaff(nextStaff);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [canManage, eventId, eventType]);

  if (!canManage) return null;

  const assignedUserIds = new Set(assignments.map((assignment) => assignment.userId));
  const availableStaff = staff.filter((user) => !assignedUserIds.has(user.id));
  const formatLabel =
    eventType === "fixed_partner" ? "Fixed Partners" : "Rotating Partners";

  async function assignStaff() {
    const userId = Number(selectedUserId);
    if (!userId || isMutating) return;

    setIsMutating(true);
    setError(false);
    try {
      await readJson(`/api/events/${eventType}/${eventId}/assignments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      const refreshed = await readJson<EventAssignment[]>(
        `/api/events/${eventType}/${eventId}/assignments`,
      );
      setAssignments(refreshed);
      setSelectedUserId("");
    } catch {
      setError(true);
    } finally {
      setIsMutating(false);
    }
  }

  async function removeStaff(userId: number) {
    if (isMutating) return;

    setIsMutating(true);
    setError(false);
    try {
      await readJson(
        `/api/events/${eventType}/${eventId}/assignments/${userId}`,
        { method: "DELETE" },
      );
      setAssignments((current) =>
        current.filter((assignment) => assignment.userId !== userId),
      );
    } catch {
      setError(true);
    } finally {
      setIsMutating(false);
    }
  }

  return (
    <section
      className="bg-card border border-card-border rounded-lg p-5 mb-6"
      data-testid="panel-event-assignments"
    >
      <div className="flex flex-col gap-1 mb-4">
        <h2 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">
          Event Assignments
        </h2>
        <p className="text-xs text-muted-foreground">
          Assign staff to this {formatLabel.toLowerCase()} event. Assigned staff can
          manage the event roster but cannot change event assignments.
        </p>
      </div>

      {isLoading ? (
        <Skeleton className="h-9 w-full max-w-xl" />
      ) : (
        <>
          <div className="flex items-center gap-2 flex-wrap">
            <select
              aria-label="Add staff member"
              data-testid="select-assignment-staff"
              value={selectedUserId}
              onChange={(event) => setSelectedUserId(event.target.value)}
              className="h-9 min-w-64 rounded-md border border-input bg-background px-3 py-1 text-sm"
              disabled={isMutating || availableStaff.length === 0}
            >
              <option value="">
                {availableStaff.length === 0
                  ? "All assignable staff are assigned"
                  : "Select staff member"}
              </option>
              {availableStaff.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name} ({user.username})
                </option>
              ))}
            </select>
            <Button
              type="button"
              size="sm"
              data-testid="button-assign-staff"
              disabled={!selectedUserId || isMutating}
              onClick={assignStaff}
              className="gap-1.5"
            >
              <UserPlus className="w-3.5 h-3.5" />
              Assign
            </Button>
          </div>

          {assignments.length > 0 && (
            <ul className="mt-4 divide-y divide-border border border-border rounded-md">
              {assignments.map((assignment) => (
                <li
                  key={assignment.userId}
                  data-testid={`assignment-row-${assignment.userId}`}
                  className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
                >
                  <span>
                    <span className="font-medium">{assignment.userName}</span>
                    <span className="ml-2 text-xs text-muted-foreground">
                      {assignment.userUsername}
                    </span>
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    data-testid={`button-remove-assignment-${assignment.userId}`}
                    disabled={isMutating}
                    onClick={() => removeStaff(assignment.userId)}
                    className="h-7 px-2 text-muted-foreground hover:text-destructive"
                    aria-label={`Remove ${assignment.userName}`}
                  >
                    <X className="w-3.5 h-3.5" />
                    <span className="sr-only">Remove</span>
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {error && (
        <p className="mt-3 text-sm text-destructive" role="alert">
          Unable to load or update event assignments.
        </p>
      )}
    </section>
  );
}