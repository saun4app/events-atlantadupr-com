import { Router, type IRouter } from "express";
import healthRouter from "./health.js";
import authRouter from "./auth.js";
import membersRouter from "./members.js";
import eventServerRouter from "./event-server/index.js";
import usersRouter from "./users.js";
import settingsRouter from "./settings.js";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/auth", authRouter);
router.use("/members", membersRouter);
router.use("/events", eventServerRouter);
router.use("/users", usersRouter);
router.use("/settings", settingsRouter);

export default router;
