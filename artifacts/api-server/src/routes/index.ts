import { Router, type IRouter } from "express";
import healthRouter from "./health.js";
import authRouter from "./auth-server/index.js";
import membersRouter from "./member-server/index.js";
import eventServerRouter from "./event-server/index.js";
import usersRouter from "./user-server/index.js";
import settingsRouter from "./settings-server/index.js";
import diagnosticsRouter from "./diagnostics-server/index.js";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/auth", authRouter);
router.use("/members", membersRouter);
router.use("/events", eventServerRouter);
router.use("/users", usersRouter);
router.use("/settings", settingsRouter);
router.use("/diagnostics", diagnosticsRouter);

export default router;
