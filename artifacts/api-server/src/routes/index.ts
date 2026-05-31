import { Router, type IRouter } from "express";
import healthRouter from "./health.js";
import authRouter from "./auth.js";
import membersRouter from "./members.js";
import eventsRouter from "./events.js";
import registrationsRouter from "./registrations.js";
import usersRouter from "./users.js";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/auth", authRouter);
router.use("/members", membersRouter);
router.use("/events", eventsRouter);
router.use("/events/:id/registrations", registrationsRouter);
router.use("/users", usersRouter);

export default router;
