import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import cookieParser from "cookie-parser";
import router from "./routes/index.js";
import { logger } from "./lib/logger.js";
import { getSession } from "./lib/session.js";
import { canonicalizeUserRole, siteVisitorRole } from "./lib/user-roles.js";
import { allowedOrigins, sessionCookieOptions } from "./lib/security.js";

const SESSION_SECRET = process.env.SESSION_SECRET ?? (
  process.env.NODE_ENV === "production"
    ? (() => { throw new Error("SESSION_SECRET env var must be set in production"); })()
    : "atl_dupr_dev_session_secret"
);

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return { id: req.id, method: req.method, url: req.url?.split("?")[0] };
      },
      res(res) {
        return { statusCode: res.statusCode };
      },
    },
  }),
);

app.disable("x-powered-by");
const origins = allowedOrigins();
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  const origin = req.get("origin");
  if (origin && !origins.has(origin)) {
    res.status(403).json({ error: "Origin not allowed" });
    return;
  }
  next();
});
app.use(cors({ origin: (origin, callback) => callback(null, !origin || origins.has(origin)), credentials: true }));
app.use(express.json({ limit: "10mb", inflate: false }));
app.use(express.text({ type: "text/plain", limit: "10mb", inflate: false }));
app.use(express.urlencoded({ extended: true, limit: "10mb", inflate: false, parameterLimit: 1000 }));
app.use(cookieParser(SESSION_SECRET));

app.use(async (req, res, next) => {
  const sid = req.signedCookies?.sid;
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, "");
  const storedSession = (await getSession(sid)) ?? (await getSession(token)) ?? null;
  const session = storedSession
    ? {
        ...storedSession,
        role: typeof storedSession.role === "string"
          ? canonicalizeUserRole(storedSession.role)
          : storedSession.role,
      }
    : null;
  (req as any).session = session;
  (req as any).userRole = session?.role ?? siteVisitorRole;
  if (sid && !storedSession) {
    res.clearCookie("sid", sessionCookieOptions());
  }
  next();
});

app.use("/api", router);

export default app;
export { SESSION_SECRET };
