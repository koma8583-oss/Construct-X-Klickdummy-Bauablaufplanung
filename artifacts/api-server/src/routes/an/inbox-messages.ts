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
import { db } from "@workspace/db";
import { messageInboxTable } from "@workspace/db";
import { eq, inArray, desc, and } from "drizzle-orm";
import { requireJwt } from "../../middlewares/requireJwt";

const router = Router();

// ── GET /inbox-messages ───────────────────────────────────────────────────────

router.get("/inbox-messages", requireJwt, async (req, res): Promise<void> => {
  const orgId = req.user!.orgId;
  if (!orgId) {
    res.status(403).json({ error: "Organisation required" });
    return;
  }

  const rows = await db
    .select()
    .from(messageInboxTable)
    .where(
      and(
        eq(messageInboxTable.recipientOrgId, orgId),
        inArray(messageInboxTable.messageType, [
          "TAKT_REQUEST_REMINDER",
          "TAKT_REQUEST_EXPIRED",
        ] as ["TAKT_REQUEST_REMINDER", "TAKT_REQUEST_EXPIRED"])
      )
    )
    .orderBy(desc(messageInboxTable.receivedAt))
    .limit(50);

  res.json(rows);
});

export default router;
