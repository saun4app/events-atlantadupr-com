import { useState } from "react";
import { UserPlus, X } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getListAssignableStaffQueryKey,
  getListEventAssignmentsQueryKey,
  type AssignableStaff,
  type EventAssignment,
  type EventAssignmentEventType,
  useAssignEventStaff,
  useListAssignableStaff,
  useListEventAssignments,
  useRemoveEventStaffAssignment,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { getUserRoleLabel, userRolesConfig } from "@/lib/user-roles";

type EventType = EventAssignmentEventType;

interface EventAssignmentManagerProps {
  eventType: EventType;
  eventId: number;
  canManage: boolean;
}

export function EventAssignmentManager({
  eventType,
  eventId,
  canManage,
}: EventAssignmentManagerProps) {
  const [selectedUserId, setSelectedUserId] = useState("");
  const [selectedEventRole, setSelectedEventRole] = useState("");
  const [mutationError, setMutationError] = useState(false);
  const queryClient = useQueryClient();
  const assignmentsQuery = useListEventAssignments(eventType, eventId, {
    query: {
      enabled: canManage && !!eventId,
      queryKey: getListEventAssignmentsQueryKey(eventType, eventId),
    },
  });
  const staffQuery = useListAssignableStaff({
    query: {
      enabled: canManage && !!eventId,
      queryKey: getListAssignableStaffQueryKey(),
    },
  });
  const assignStaffMutation = useAssignEventStaff();
  const removeStaffMutation = useRemoveEventStaffAssignment();

  if (!canManage) return null;

  const assignments: EventAssignment[] = assignmentsQuery.data ?? [];
  const staff: AssignableStaff[] = staffQuery.data ?? [];
  // Selecting an already assigned user changes their one event responsibility.
  const availableStaff = staff;
  const formatLabel =
    eventType === "fixed_partner" ? "Fixed Partners" : "Rotating Partners";
  const isLoading = assignmentsQuery.isLoading || staffQuery.isLoading;
  const isMutating =
    assignStaffMutation.isPending || removeStaffMutation.isPending;
  const error = mutationError || assignmentsQuery.isError || staffQuery.isError;

  function assignStaff() {
    const userId = Number(selectedUserId);
    if (!userId || isMutating) return;

    setMutationError(false);
    assignStaffMutation.mutate(
      { eventType, id: eventId, data: { userId, eventRole: selectedEventRole as any } },
      {
        onSuccess: () => {
          setSelectedUserId("");
           setSelectedEventRole("");
          void queryClient.invalidateQueries({
            queryKey: getListEventAssignmentsQueryKey(eventType, eventId),
          });
        },
        onError: () => setMutationError(true),
      },
    );
  }

  function removeStaff(userId: number) {
    if (isMutating) return;

    setMutationError(false);
    removeStaffMutation.mutate(
      { eventType, id: eventId, userId },
      {
        onSuccess: () =>
          void queryClient.invalidateQueries({
            queryKey: getListEventAssignmentsQueryKey(eventType, eventId),
          }),
        onError: () => setMutationError(true),
      },
    );
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
          Assign staff to this {formatLabel.toLowerCase()} event. Assigned staff
          can manage the event roster but cannot change event assignments.
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
                  ? "No account users available"
                  : "Select staff member"}
              </option>
              {availableStaff.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name} ({user.username})
                </option>
              ))}
            </select>
            <select
              aria-label="Event role"
              data-testid="select-assignment-role"
              value={selectedEventRole}
              onChange={(event) => setSelectedEventRole(event.target.value)}
              className="h-9 min-w-44 rounded-md border border-input bg-background px-3 py-1 text-sm"
              disabled={isMutating}
            >
              <option value="">Select event role</option>
              {userRolesConfig.eventRoles.map((role) => (
                <option key={role.id} value={role.id}>{role.label}</option>
              ))}
            </select>
            <Button
              type="button"
              size="sm"
              data-testid="button-assign-staff"
               disabled={!selectedUserId || !selectedEventRole || isMutating}
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
                     <span className="ml-2 text-xs text-muted-foreground">
                       {getUserRoleLabel(assignment.eventRole)}
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
        <p
          className="mt-3 text-sm text-destructive"
          role="alert"
          data-testid="status-event-assignments-error"
        >
          Unable to load or update event assignments.
        </p>
      )}
    </section>
  );
}
