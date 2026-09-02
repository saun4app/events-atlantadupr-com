import type { Request, Response, NextFunction } from "express";
import bcrypt from "bcryptjs";
import { getRequestUserRole, isConfiguredUserRole } from "./user-roles.js";

const SALT_ROUNDS = 12;

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export const requireAuth: (req: Request, res: Response, next: NextFunction) => void = (req, res, next) => {
  if (!(req as any).session?.userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  next();
};

export function requireRole(...roles: string[]) {
  for (const role of roles) {
    if (!isConfiguredUserRole(role)) {
      throw new Error(`Unknown configured user role "${role}"`);
    }
  }
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!(req as any).session?.userId) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }
    if (!roles.includes(getRequestUserRole(req as any))) {
      res.status(403).json({ error: "Insufficient permissions" });
      return;
    }
    next();
  };
}
