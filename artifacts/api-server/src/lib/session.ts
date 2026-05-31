const sessions = new Map<string, Record<string, any>>();

export function getSession(sid: string | undefined): Record<string, any> | null {
  if (!sid) return null;
  return sessions.get(sid) ?? null;
}

export function setSession(sid: string, data: Record<string, any>): void {
  sessions.set(sid, data);
}

export function deleteSession(sid: string): void {
  sessions.delete(sid);
}
