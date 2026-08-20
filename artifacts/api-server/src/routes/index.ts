import { Router, type IRouter } from "express";
import healthRouter from "./health";
import organizationsRouter from "./organizations";
import projectsRouter from "./projects";
import takteRouter from "./takte";
import taktDependenciesRouter from "./takt-dependencies";
import delegationsRouter from "./delegations";
import resourcesRouter from "./resources";
import webhooksRouter from "./webhooks";
import dashboardRouter from "./dashboard";
import taktRequestsRouter from "./takt-requests";
import messagesRouter from "./messages";
import nuRouter from "./nu";
import projectCalendarsRouter from "./project-calendars";
// Canonical German Leistung endpoints (Task #196)
import leistungenRouter from "./leistungen";

const router: IRouter = Router();

router.use(healthRouter);
router.use(organizationsRouter);
router.use(projectsRouter);
router.use(projectCalendarsRouter);
router.use(takteRouter);
router.use(taktDependenciesRouter);
router.use(delegationsRouter);
router.use(resourcesRouter);
router.use(webhooksRouter);
router.use(dashboardRouter);
router.use(taktRequestsRouter);
router.use(messagesRouter);
router.use(nuRouter);
// Canonical German Leistung endpoints — registered after existing routes so that
// the legacy /takte, /takt-dependencies and /takt-requests paths take precedence
// for any overlapping patterns (there are none, but belt-and-suspenders ordering).
router.use(leistungenRouter);

export default router;
