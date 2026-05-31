import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import cookieParser from "cookie-parser";
import router from "./routes/index.js";
import { logger } from "./lib/logger.js";

const sessions = new Map<string, Record<string, any>>();

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
app.use(express.json());
app.use(express.text({ type: "text/plain" }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser("atl_dupr_session_secret"));

app.use((req, _res, next) => {
  const sid = req.signedCookies?.sid;
  if (sid && sessions.has(sid)) {
    (req as any).session = sessions.get(sid);
  } else {
    (req as any).session = null;
  }
  next();
});

app.use((req, res, next) => {
  const originalJson = res.json.bind(res);
  res.json = function (body) {
    const session = (req as any).session;
    if (session) {
      let sid = req.signedCookies?.sid;
      if (!sid) {
        sid = Math.random().toString(36).slice(2) + Date.now().toString(36);
      }
      sessions.set(sid, session);
      res.cookie("sid", sid, {
        signed: true,
        httpOnly: true,
        sameSite: "lax",
        maxAge: 7 * 24 * 60 * 60 * 1000,
      });
    } else if (req.signedCookies?.sid && session === null) {
      const sid = req.signedCookies.sid;
      sessions.delete(sid);
      res.clearCookie("sid");
    }
    return originalJson(body);
  };
  next();
});

app.use("/api", router);

export default app;
