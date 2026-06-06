import { Router, type IRouter } from "express";
import eventsRouter from "./events.js";
import registrationsRouter from "./registrations.js";

const router: IRouter = Router();

router.use("/", eventsRouter);
router.use("/:eventType/:id/registrations", registrationsRouter);

export default router;
