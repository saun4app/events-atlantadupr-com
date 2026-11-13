import { randomBytes } from "node:crypto";
import type { CookieOptions } from "express";

export const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export function createSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function sessionCookieOptions(): CookieOptions {
  const preview = process.env.NODE_ENV !== "production" && Boolean(process.env.REPLIT_DEV_DOMAIN);
  return {
    signed: true,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production" || preview,
    sameSite: preview ? "none" : "lax",
    path: "/",
  };
}

export function allowedOrigins(): Set<string> {
  const origins = new Set([
    "https://events.atlantadupr.com",
    "https://atlanta-dupr-pickleball.replit.app",
    ...(process.env.CORS_ALLOWED_ORIGINS ?? "").split(",").map(value => value.trim()).filter(Boolean),
  ]);
  if (process.env.NODE_ENV !== "production") {
    if (process.env.REPLIT_DEV_DOMAIN) origins.add(`https://${process.env.REPLIT_DEV_DOMAIN}`);
    origins.add("http://localhost:80");
    origins.add("http://localhost");
  }
  return origins;
}
