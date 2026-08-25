/**
 * AN dashboard route — mounted at /api/an/dashboard/an
 * KPIs: open requests, policy pending, due soon, active resource bookings.
 * "Nächste Aktionen" list with priority ordering.
 */
import { Router } from "express";
import { requireJwt } from "../../middlewares/requireJwt";
import { requireOrganizationType } from "../../middlewares/requireOrganization";
import { getAnDashboard } from "../../services/an-leistungsanfrage-service";

const router = Router();

router.get("/dashboard/an", requireJwt, requireOrganizationType("AN"), async (req, res): Promise<void> => {
  res.json(await getAnDashboard(req.user!.orgId!));
});

export default router;
