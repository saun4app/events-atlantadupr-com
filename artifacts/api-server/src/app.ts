import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import cookieParser from "cookie-parser";
import router from "./routes/index.js";
import { logger } from "./lib/logger.js";
import { getSession, setSession, deleteSession } from "./lib/session.js";
import { canonicalizeUserRole } from "./lib/user-roles.js";

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

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "10mb" }));
app.use(express.text({ type: "text/plain", limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use(cookieParser(SESSION_SECRET));

app.use(async (req, _res, next) => {
  const sid = req.signedCookies?.sid;
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, "");
  if (req.url.startsWith("/api/auth")) {
    logger.info({ sid: sid ? "present" : "missing", bearer: token ? "present" : "missing", url: req.url }, "auth debug");
  }
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
  next();
});

app.use((req, res, next) => {
  const originalJson = res.json.bind(res);
  res.json = function (body) {
    const session = (req as any).session;
    const existingSid = req.signedCookies?.sid;

    if (session) {
      const sid = existingSid ?? (Math.random().toString(36).slice(2) + Date.now().toString(36));
      setSession(sid, session).catch(() => {});
      res.cookie("sid", sid, {
        signed: true,
        httpOnly: true,
        sameSite: "lax",
        maxAge: 7 * 24 * 60 * 60 * 1000,
      });
    } else if (existingSid && session === null) {
      deleteSession(existingSid).catch(() => {});
      res.clearCookie("sid");
    }

    return originalJson(body);
  };
  next();
});

app.use("/api", router);

export default app;
export { SESSION_SECRET };
