import { Router } from "express";
import { requireJwt } from "../middlewares/requireJwt";
import { getCoordinationTasks } from "../services/coordination-task-service";

const router = Router();

router.get("/coordination/tasks", requireJwt, async (req, res): Promise<void> => {
  const orgType = req.user!.orgType;
  if (orgType !== "AG" && orgType !== "AN") {
    res.status(403).json({ error: "Nur AG und AN können Koordinationsaufgaben abrufen" });
    return;
  }
  const tasks = await getCoordinationTasks({ orgId: req.user!.orgId!, role: orgType });
  res.json(tasks);
});

export default router;