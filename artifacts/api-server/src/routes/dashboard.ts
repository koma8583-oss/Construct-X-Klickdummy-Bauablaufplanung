import { Router } from "express";
import { requireJwt } from "../middlewares/requireJwt";
import { requireOrganizationType } from "../middlewares/requireOrganization";
import { getAgDashboard, getAnDashboard } from "../services/dashboard-service";

const router = Router();

router.get("/dashboard/ag", requireJwt, requireOrganizationType("AG"), async (req, res): Promise<void> => {
  res.json(await getAgDashboard(req.user!.orgId!));
});

router.get("/dashboard/an", requireJwt, requireOrganizationType("AN"), async (req, res): Promise<void> => {
  res.json(await getAnDashboard(req.user!.orgId!));
});

export default router;