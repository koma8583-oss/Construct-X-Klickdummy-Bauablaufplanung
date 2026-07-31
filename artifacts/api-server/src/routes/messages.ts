/**
 * NU Inbox routes — Task 3.7.
 *
 * Endpoints:
 *   GET  /messages/inbox                   — list NU inbox (filtered, paginated)
 *   GET  /messages/inbox/:messageId        — single message
 *   POST /messages/inbox/:messageId/read   — mark as read (idempotent)
 *
 * Organisation guard: all three endpoints are restricted to AN (NU) organisations.
 * GU users (orgType: "AG"), hub admins, and unauthenticated callers are rejected.
 * recipientOrgId is always derived from req.user.orgId — never from the request body.
 *
 * Transport: uses LocalHubTransport.getInbox() and markAsRead() for all operations.
 * TaktRequest.status is NEVER changed here — markAsRead only updates inbox status.
 */
import { Router } from "express";
import { db, messageInboxTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireJwt } from "../middlewares/requireJwt";
import { LocalHubTransport } from "../lib/transport/local-hub-transport";
import {
  MessageNotFoundError,
  RecipientForbiddenError,
} from "../lib/transport/transport-errors";
import type { DataspaceMessageStatus, DataspaceMessageType } from "@workspace/api-zod";

const router = Router();

// Module-level transport singleton — stateless, safe to share across requests.
const transport = new LocalHubTransport();

// ── Valid enum value sets (used for query param validation) ───────────────────

const VALID_STATUSES = new Set<string>([
  "PENDING", "SENT", "DELIVERED", "READ", "FAILED",
]);
const VALID_TYPES = new Set<string>([
  "TAKT_REQUEST_NOTIFICATION",
  "TAKT_REQUEST_REVISED",
  "TAKT_REQUEST_CANCELLED",
  "TAKT_DETAILS_RETRIEVED",
  "TAKT_RESPONSE_SUBMITTED",
  "TAKT_RESPONSE_ACCEPTED",
  "TAKT_RESPONSE_REVISION_REQUESTED",
]);

/**
 * Checks that the caller is an authenticated organisation (AG or AN).
 * Hub admins and tokens without an org are rejected.
 *
 * Returns the orgId string on success, or null after sending a 403 response.
 *
 * Rules (Task 4.8 — extended to support GU inbox):
 *   - Must have a non-null orgId (rejects hub admins and no-org tokens)
 *   - orgType may be "AG" or "AN" — both may have inbox messages
 *   - recipientOrgId is ALWAYS derived from the token — never from the request
 *
 * @deprecated legacy alias `requireNuOrg` kept for backward compatibility
 */
function requireOrg(
  req: { user?: { orgId: string | null; orgType: "AG" | "AN" | null; hubAdmin: boolean } },
  res: { status: (n: number) => { json: (b: unknown) => void } },
): string | null {
  const user = req.user;
  if (!user || user.hubAdmin || !user.orgId) {
    res.status(403).json({
      error:
        "Inbox is only accessible to authenticated organisations. " +
        "Hub admins and tokens without an organisation are not permitted.",
    });
    return null;
  }
  return user.orgId;
}

/** @deprecated Use requireOrg. Retained so existing NU callers still work. */
const requireNuOrg = requireOrg;

// ── GET /messages/inbox ───────────────────────────────────────────────────────
// Lists all inbox messages for the authenticated NU, newest first.
// recipientOrgId is derived from the bearer token — not a query parameter.
router.get("/messages/inbox", requireJwt, async (req, res): Promise<void> => {
  const nuOrgId = requireNuOrg(req as Parameters<typeof requireNuOrg>[0], res as Parameters<typeof requireNuOrg>[1]);
  if (!nuOrgId) return;

  const q = req.query as Record<string, string | undefined>;

  const statusFilter = q.status && VALID_STATUSES.has(q.status)
    ? (q.status as DataspaceMessageStatus)
    : undefined;

  const typeFilter = q.messageType && VALID_TYPES.has(q.messageType)
    ? (q.messageType as DataspaceMessageType)
    : undefined;

  const limitVal  = Math.min(Math.max(parseInt(q.limit  ?? "50", 10)  || 50,  1), 100);
  const offsetVal = Math.max(parseInt(q.offset ?? "0",  10) || 0, 0);

  const messages = await transport.getInbox(nuOrgId, {
    status: statusFilter,
    messageType: typeFilter,
    correlationId: q.correlationId ?? undefined,
    limit: limitVal,
    offset: offsetVal,
  });

  res.json(messages);
});

// ── GET /messages/inbox/:messageId ────────────────────────────────────────────
// Returns a single inbox message by messageId.
// The transport's getInbox() filters by correlationId, not messageId, so we
// query the DB directly to look up a specific messageId + recipientOrgId pair.
// This is intentional: route handlers may use the DB for read-only cross-cuts
// that the transport interface does not expose.
router.get(
  "/messages/inbox/:messageId",
  requireJwt,
  async (req, res): Promise<void> => {
    const nuOrgId = requireNuOrg(req as Parameters<typeof requireNuOrg>[0], res as Parameters<typeof requireNuOrg>[1]);
    if (!nuOrgId) return;

    const messageId = req.params.messageId as string;

    // Look up the row scoped to the caller's org (safe — no cross-org leakage)
    const [row] = await db
      .select()
      .from(messageInboxTable)
      .where(
        and(
          eq(messageInboxTable.messageId, messageId),
          eq(messageInboxTable.recipientOrgId, nuOrgId),
        ),
      )
      .limit(1);

    if (!row) {
      // Check whether the messageId exists for a DIFFERENT recipient so we can
      // return 403 instead of 404 (reveals less information than exposing 403).
      // The conservative safe choice: always return 404 to avoid oracle attacks.
      res.status(404).json({ error: `Message not found: ${messageId}` });
      return;
    }

    res.json(row);
  },
);

// ── POST /messages/inbox/:messageId/read ─────────────────────────────────────
// Marks a message as READ in the inbox. Idempotent: calling twice is safe.
// Does NOT touch TaktRequest.status — that belongs to the coordination layer.
router.post(
  "/messages/inbox/:messageId/read",
  requireJwt,
  async (req, res): Promise<void> => {
    const nuOrgId = requireNuOrg(req as Parameters<typeof requireNuOrg>[0], res as Parameters<typeof requireNuOrg>[1]);
    if (!nuOrgId) return;

    const messageId = req.params.messageId as string;

    try {
      await transport.markAsRead(messageId, nuOrgId);
    } catch (err) {
      if (err instanceof MessageNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      if (err instanceof RecipientForbiddenError) {
        res.status(403).json({ error: err.message });
        return;
      }
      throw err;
    }

    // Reload the updated inbox row to return current readAt
    const [row] = await db
      .select()
      .from(messageInboxTable)
      .where(
        and(
          eq(messageInboxTable.messageId, messageId),
          eq(messageInboxTable.recipientOrgId, nuOrgId),
        ),
      )
      .limit(1);

    res.json({
      messageId,
      status: row?.status ?? "READ",
      readAt: row?.readAt ?? null,
    });
  },
);

export default router;
