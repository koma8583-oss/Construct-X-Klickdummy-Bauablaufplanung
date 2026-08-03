/**
 * External notification abstraction (Task 7.6).
 *
 * Separates business reminder logic from delivery channel mechanics.
 * The PoC ships with two implementations:
 *   - LoggingExternalNotificationProvider  (dev/test: logs metadata only)
 *   - InAppNotificationProvider            (production: uses existing MessageTransport)
 *
 * Future implementations (EMAIL, WEBHOOK) plug in via the same interface
 * without touching DeadlineEvaluationService or any domain logic.
 *
 * Error isolation rule:
 *   A failure in an external channel must NEVER prevent the In-App reminder
 *   from being delivered. Each channel is invoked independently; failures are
 *   logged and surfaced in the result but do not propagate as exceptions.
 */

import type { ReminderType } from "@workspace/db";
import pino from "pino";

const logger = pino({ name: "external-notification-provider" });

// ── Channel enum ──────────────────────────────────────────────────────────────

export type ExternalNotificationChannel = "IN_APP" | "EMAIL" | "WEBHOOK";

// ── Core types ────────────────────────────────────────────────────────────────

/**
 * A notification to send via an external channel.
 * Must NOT contain full Takt snapshots, resource data, or NU-internal data.
 */
export interface ExternalNotification {
  /** Unique notification ID (used for idempotency) */
  notificationId: string;
  /** Delivery channel */
  channel: ExternalNotificationChannel;
  /** Organisation or user identifier for the recipient */
  recipient: string;
  /** Short subject line */
  subject: string;
  /** Body text (plain text; only references and deadlines, no sensitive data) */
  body: string;
  /** Deep link to the relevant TaktRequest in the app */
  deepLink: string;
  /** TaktRequest ID for correlation */
  correlationId: string;
  /** Business reminder type this notification corresponds to */
  reminderType: ReminderType;
}

export interface ExternalNotificationResult {
  notificationId: string;
  channel: ExternalNotificationChannel;
  success: boolean;
  /** Error message if success is false */
  error?: string;
  /** Timestamp of the attempt */
  attemptedAt: Date;
}

// ── Provider interface ────────────────────────────────────────────────────────

/**
 * Pluggable provider for one delivery channel.
 *
 * Implementations must:
 *   1. Never throw — return a result with success=false instead.
 *   2. Never include full Takt snapshots in external payloads.
 *   3. Use only secrets from environment variables (never hardcoded).
 */
export interface ExternalNotificationProvider {
  readonly channel: ExternalNotificationChannel;
  send(notification: ExternalNotification): Promise<ExternalNotificationResult>;
}

// ── Small message template helper ─────────────────────────────────────────────

/** Map each reminder type to a short human-readable subject + body template */
const TEMPLATES: Record<ReminderType, { subject: string; body: (dueAt: string, ref: string) => string }> = {
  RESPONSE_DUE_SOON: {
    subject: "Antwortfrist nähert sich",
    body: (dueAt, ref) => `Bitte antworten Sie auf Taktanfrage ${ref} bis ${dueAt}.`,
  },
  RESPONSE_DUE_TODAY: {
    subject: "Antwortfrist heute",
    body: (dueAt, ref) => `Die Antwortfrist für Taktanfrage ${ref} läuft heute um ${dueAt} ab.`,
  },
  RESPONSE_OVERDUE: {
    subject: "Antwortfrist überschritten",
    body: (_dueAt, ref) => `Die Antwortfrist für Taktanfrage ${ref} wurde überschritten. Bitte antworten Sie umgehend.`,
  },
  GU_DECISION_DUE_SOON: {
    subject: "Entscheidungsfrist nähert sich",
    body: (dueAt, ref) => `Ihre Entscheidung zur Taktanfrage ${ref} ist bis ${dueAt} erforderlich.`,
  },
  GU_DECISION_OVERDUE: {
    subject: "Entscheidung ausstehend",
    body: (_dueAt, ref) => `Ihre Entscheidungsfrist zur Taktanfrage ${ref} ist abgelaufen.`,
  },
  DELIVERY_FAILED: {
    subject: "Technische Zustellung fehlgeschlagen",
    body: (_dueAt, ref) => `Die technische Zustellung der Taktanfrage ${ref} ist fehlgeschlagen. Bitte prüfen Sie den Zustellstatus.`,
  },
};

export function buildNotificationText(
  reminderType: ReminderType,
  requestRef: string,
  dueAt: Date | null,
): { subject: string; body: string } {
  const tpl = TEMPLATES[reminderType];
  const dueStr = dueAt ? dueAt.toISOString() : "—";
  return { subject: tpl.subject, body: tpl.body(dueStr, requestRef) };
}

// ── Delivery preferences (simple in-memory model for PoC) ────────────────────

export interface DeliveryPreference {
  organizationId: string;
  userId?: string;
  channel: ExternalNotificationChannel;
  reminderType: ReminderType | "*";
  enabled: boolean;
}

// ── LoggingExternalNotificationProvider ──────────────────────────────────────

/**
 * Development/test provider.
 * Logs notification metadata (no sensitive payloads) and always succeeds.
 * Never sends real messages.
 */
export class LoggingExternalNotificationProvider implements ExternalNotificationProvider {
  readonly channel: ExternalNotificationChannel = "EMAIL"; // stands in for any external channel

  async send(n: ExternalNotification): Promise<ExternalNotificationResult> {
    // Log only metadata — never log the full body or any NU-internal data
    logger.info(
      {
        notificationId: n.notificationId,
        channel:        n.channel,
        reminderType:   n.reminderType,
        correlationId:  n.correlationId,
        recipient:      n.recipient,
        subject:        n.subject,
        deepLink:       n.deepLink,
        // body intentionally omitted from structured log
      },
      "[LoggingProvider] Would send notification (dev/test only — no real message sent)",
    );
    return {
      notificationId: n.notificationId,
      channel:        n.channel,
      success:        true,
      attemptedAt:    new Date(),
    };
  }
}

// ── InAppNotificationProvider ─────────────────────────────────────────────────

/**
 * Production PoC provider.
 * Delegates to the existing MessageTransport (LocalHubTransport) so
 * reminders appear in the Hub inbox alongside coordination messages.
 *
 * This provider does NOT create duplicate DB rows for reminders —
 * DeadlineEvaluationService already writes the takt_request_reminders row
 * and calls send() for the actual dispatch. This provider only wraps the
 * channel-level result so the interface is uniform.
 */
export class InAppNotificationProvider implements ExternalNotificationProvider {
  readonly channel: ExternalNotificationChannel = "IN_APP";

  // In the PoC the "send" is already handled by DeadlineEvaluationService
  // via LocalHubTransport. This provider signals success so the orchestration
  // layer can record it uniformly.
  async send(_n: ExternalNotification): Promise<ExternalNotificationResult> {
    // Actual outbox row is written by the evaluation service; nothing to do here.
    return {
      notificationId: _n.notificationId,
      channel:        this.channel,
      success:        true,
      attemptedAt:    new Date(),
    };
  }
}
