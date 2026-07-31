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

const router: IRouter = Router();

router.use(healthRouter);
router.use(organizationsRouter);
router.use(projectsRouter);
router.use(takteRouter);
router.use(taktDependenciesRouter);
router.use(delegationsRouter);
router.use(resourcesRouter);
router.use(webhooksRouter);
router.use(dashboardRouter);
router.use(taktRequestsRouter);

export default router;
