/**
 * AN sub-router — mounted at /api/an/
 *
 * Uses the isolated "tk_an_sid" session cookie (set in app.ts).
 * Reuses existing route handlers where they are already session-scoped
 * (delegations, resources, organizations, webhooks).
 * Provides AN-specific auth and dashboard routes.
 */
import { Router, type IRouter } from "express";
import dashboardRouter from "./dashboard";
import delegationsRouter from "../delegations";
import resourcesRouter from "../resources";
import organizationsRouter from "../organizations";
import webhooksRouter from "../webhooks";
import healthRouter from "../health";
import taktRequestsRouter from "../takt-requests";
import nuRouter from "../nu";
import dataOffersRouter from "./data-offers";

const router: IRouter = Router();

// Health check reachable at /api/an/health
router.use(healthRouter);

// Reused route handlers — req.user.orgId is set by requireJwt middleware.
router.use(delegationsRouter);
router.use(resourcesRouter);
router.use(organizationsRouter);
router.use(webhooksRouter);
router.use(taktRequestsRouter);

// NU-internal routes: resource types, local projects, resource bookings, availability checks
// These are mounted here so the AN app's /api/* → /api/an/* rewrite resolves them correctly.
router.use(nuRouter);

// AN data-space offers at /api/an/data-offers
router.use(dataOffersRouter);

// AN dashboard at /api/an/dashboard/an
router.use(dashboardRouter);

export default router;
