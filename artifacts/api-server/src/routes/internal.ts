/**
 * Internal-only routes (Task 7.3).
 *
 * These routes are NOT authenticated via JWT and are intended solely for:
 *   - Development / test environments
 *   - Manual admin trigger in controlled environments
 *
 * They must NEVER be publicly accessible in production.
 * The route guard checks NODE_ENV and INTERNAL_ROUTES_ENABLED.
 */

import { Router } from "express";
import type { Request, Response } from "express";
import { runDeadlineEvaluationOnce } from "../lib/local-deadline-worker";
import { loadDeadlineConfig } from "../services/deadline-config";
import pino from "pino";

const logger = pino({ name: "internal-routes" });
const router = Router();

// ── Guard middleware ───────────────────────────────────────────────────────────

function requireInternalAccess(req: Request, res: Response, next: () => void): void {
  const isProduction = process.env.NODE_ENV === "production";
  const isEnabled    = process.env.INTERNAL_ROUTES_ENABLED === "true";

  if (isProduction && !isEnabled) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  next();
}

// ── POST /internal/jobs/deadlines/run ─────────────────────────────────────────

/**
 * Manually trigger one deadline evaluation run.
 *
 * Body (optional):
 *   { "now": "2026-08-15T10:00:00Z" }   — override clock (dev/test only, blocked in prod)
 *
 * Returns the DeadlineEvaluationResult.
 */
router.post(
  "/jobs/deadlines/run",
  requireInternalAccess,
  async (req: Request, res: Response): Promise<void> => {
    const isProduction = process.env.NODE_ENV === "production";
    let now: Date | undefined;

    if (req.body?.now) {
      if (isProduction) {
        res.status(403).json({
          error: "Custom 'now' timestamps are not permitted in production",
        });
        return;
      }
      const parsed = new Date(req.body.now as string);
      if (isNaN(parsed.getTime())) {
        res.status(400).json({ error: "Invalid 'now' timestamp" });
        return;
      }
      now = parsed;
    }

    const config = loadDeadlineConfig();

    logger.info(
      { now: now?.toISOString() ?? "system", env: process.env.NODE_ENV },
      "Manual deadline run triggered",
    );

    const result = await runDeadlineEvaluationOnce(config, now);

    res.status(200).json({
      triggered: true,
      locked:    result.locked,
      ran:       result.ran,
      error:     result.error,
      result:    result.result,
    });
  },
);

export default router;
