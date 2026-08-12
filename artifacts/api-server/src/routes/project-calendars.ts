/**
 * Project calendar configuration routes.
 *
 * GET  /projects/:projectId/calendar  — fetch (or return default) calendar
 * PUT  /projects/:projectId/calendar  — upsert calendar
 */
import { Router } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import { projectCalendarsTable, projectsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireJwt } from "../middlewares/requireJwt";

const router = Router();

const calendarSchema = z.object({
  monHours: z.number().min(0).max(24),
  tueHours: z.number().min(0).max(24),
  wedHours: z.number().min(0).max(24),
  thuHours: z.number().min(0).max(24),
  friHours: z.number().min(0).max(24),
  satHours: z.number().min(0).max(24),
  sunHours: z.number().min(0).max(24),
});

const DEFAULT_CALENDAR = {
  monHours: "8", tueHours: "8", wedHours: "8", thuHours: "8",
  friHours: "8", satHours: "0", sunHours: "0",
} as const;

/** Inline AG-owner check (mirrors requireProjectOwner in projects.ts) */
async function checkProjectOwner(
  req: Parameters<Parameters<typeof router.get>[1]>[0],
  res: Parameters<Parameters<typeof router.get>[1]>[1],
  projectId: string,
): Promise<typeof projectsTable.$inferSelect | null> {
  const [project] = await db
    .select()
    .from(projectsTable)
    .where(eq(projectsTable.id, projectId))
    .limit(1);

  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return null;
  }
  if (project.agOrgId !== req.user!.orgId) {
    res.status(403).json({ error: "Access denied" });
    return null;
  }
  return project;
}

// ── GET /projects/:projectId/calendar ─────────────────────────────────────────
router.get(
  "/projects/:projectId/calendar",
  requireJwt,
  async (req, res): Promise<void> => {
    const projectId = req.params.projectId as string;
    const project = await checkProjectOwner(req, res, projectId);
    if (!project) return;

    const [row] = await db
      .select()
      .from(projectCalendarsTable)
      .where(eq(projectCalendarsTable.projectId, projectId))
      .limit(1);

    if (!row) {
      res.json({ projectId, ...DEFAULT_CALENDAR });
      return;
    }
    res.json(row);
  },
);

// ── PUT /projects/:projectId/calendar ─────────────────────────────────────────
router.put(
  "/projects/:projectId/calendar",
  requireJwt,
  async (req, res): Promise<void> => {
    const projectId = req.params.projectId as string;
    const project = await checkProjectOwner(req, res, projectId);
    if (!project) return;

    const parsed = calendarSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const data = {
      projectId,
      monHours: String(parsed.data.monHours),
      tueHours: String(parsed.data.tueHours),
      wedHours: String(parsed.data.wedHours),
      thuHours: String(parsed.data.thuHours),
      friHours: String(parsed.data.friHours),
      satHours: String(parsed.data.satHours),
      sunHours: String(parsed.data.sunHours),
    };

    const [row] = await db
      .insert(projectCalendarsTable)
      .values(data)
      .onConflictDoUpdate({
        target: projectCalendarsTable.projectId,
        set: {
          monHours: data.monHours,
          tueHours: data.tueHours,
          wedHours: data.wedHours,
          thuHours: data.thuHours,
          friHours: data.friHours,
          satHours: data.satHours,
          sunHours: data.sunHours,
        },
      })
      .returning();

    res.json(row);
  },
);

export default router;
