/**
 * Internal-only routes (Task 7.3).
 *
 * These routes require BOTH:
 *   1. The caller to present a valid INTERNAL_JOB_TOKEN bearer token, AND
 *   2. Either NODE_ENV != production OR INTERNAL_ROUTES_ENABLED=true
 *
 * Never log the token value.
 */

import { Router } from "express";
import type { Request, Response } from "express";
import { timingSafeEqual } from "crypto";
import { runDeadlineEvaluationOnce } from "../lib/local-deadline-worker";
import { loadDeadlineConfig } from "../services/deadline-config";
import pino from "pino";

const logger = pino({ name: "internal-routes" });
const router = Router();

// ── Guard: environment-level access control ────────────────────────────────────

function requireInternalAccess(req: Request, res: Response, next: () => void): void {
  const isProduction = process.env.NODE_ENV === "production";
  const isEnabled    = process.env.INTERNAL_ROUTES_ENABLED === "true";

  if (isProduction && !isEnabled) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  next();
}

// ── Guard: token authentication (constant-time) ────────────────────────────────
/**
 * Secures internal endpoints with a bearer token read from INTERNAL_JOB_TOKEN.
 * Uses crypto.timingSafeEqual so token comparison is not vulnerable to
 * timing attacks. Never logs the token value.
 *
 * Fail-closed: if INTERNAL_JOB_TOKEN is not set, all requests are rejected.
 */
function requireInternalToken(req: Request, res: Response, next: () => void): void {
  const configuredToken = process.env.INTERNAL_JOB_TOKEN;

  if (!configuredToken) {
    logger.warn("INTERNAL_JOB_TOKEN is not set — rejecting all internal requests");
    res.status(401).json({ error: "Unauthorized: internal job token not configured" });
    return;
  }

  const authHeader = req.headers["authorization"] ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(authHeader as string);
  if (!match) {
    res.status(401).json({ error: "Unauthorized: Bearer token required" });
    return;
  }

  const providedToken = match[1];

  // Constant-time comparison to prevent timing-based token enumeration
  let tokensEqual = false;
  try {
    const a = Buffer.from(configuredToken, "utf8");
    const b = Buffer.from(providedToken, "utf8");
    // timingSafeEqual requires same-length buffers; pad if needed
    if (a.length === b.length) {
      tokensEqual = timingSafeEqual(a, b);
    } else {
      // Still run a dummy comparison so the branch timing is consistent
      timingSafeEqual(a, Buffer.alloc(a.length));
      tokensEqual = false;
    }
  } catch {
    tokensEqual = false;
  }

  if (!tokensEqual) {
    res.status(403).json({ error: "Forbidden: invalid internal job token" });
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
  requireInternalToken,
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

    // Log the trigger event — deliberately omit any token-related field
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
