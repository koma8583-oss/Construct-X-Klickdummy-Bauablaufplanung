/**
 * AN inbox messages route.
 *
 * Mounted at /api/an/ (via an/index.ts).
 *
 *   GET /inbox-messages — returns TAKT_REQUEST_REMINDER and TAKT_REQUEST_EXPIRED
 *                         messages delivered to this AN's organisation.
 *
 * These messages are written by the deadline evaluation service and
 * represent Datenraum-channel coordination events — they appear in the
 * AN Datenraum view alongside data-offer notifications.
 */
import { Router } from "express";
import { requireJwt } from "../../middlewares/requireJwt";
import { listHubInbox } from "../../services/hub-transport-service";

const router = Router();

// ── GET /inbox-messages ───────────────────────────────────────────────────────

router.get("/inbox-messages", requireJwt, async (req, res): Promise<void> => {
  if (req.user?.orgType !== "AN") {
    res.status(403).json({ error: "AN access only" });
    return;
  }
  const orgId = req.user!.orgId;
  if (!orgId) {
    res.status(403).json({ error: "Organisation required" });
    return;
  }

  const rows = await listHubInbox(orgId, { limit: 50 });
  const filtered = rows.filter((row) =>
    row.messageType === "TAKT_REQUEST_REMINDER" ||
    row.messageType === "TAKT_REQUEST_EXPIRED",
  );

  res.json(filtered);
});

export default router;
