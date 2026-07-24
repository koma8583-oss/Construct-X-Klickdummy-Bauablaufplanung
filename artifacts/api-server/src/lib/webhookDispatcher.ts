import { db } from "@workspace/db";
import {
  webhookSubscriptionsTable,
  webhookEventsTable,
} from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { createHmac } from "crypto";
import { logger } from "./logger";

export async function dispatchWebhookEvent(
  orgId: string,
  event: string,
  payload: unknown,
): Promise<void> {
  const subscriptions = await db
    .select()
    .from(webhookSubscriptionsTable)
    .where(
      and(
        eq(webhookSubscriptionsTable.orgId, orgId),
        eq(webhookSubscriptionsTable.active, true),
      ),
    );

  const relevantSubs = subscriptions.filter((sub) =>
    sub.events.includes(event),
  );

  if (relevantSubs.length === 0) return;

  const payloadStr = JSON.stringify(payload);

  for (const sub of relevantSubs) {
    const [eventRow] = await db
      .insert(webhookEventsTable)
      .values({
        subscriptionId: sub.id,
        event,
        payload: payloadStr,
        status: "PENDING",
        attempts: 0,
      })
      .returning();

    if (!eventRow) continue;

    // Fire and forget delivery
    deliverWebhook(sub.id, eventRow.id, sub.url, sub.secret, event, payloadStr).catch(
      (err) => logger.error({ err, eventId: eventRow.id }, "Webhook delivery failed"),
    );
  }
}

async function deliverWebhook(
  subscriptionId: string,
  eventId: string,
  url: string,
  secret: string | null,
  event: string,
  payloadStr: string,
): Promise<void> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-TaktKoord-Event": event,
  };

  if (secret) {
    const signature = createHmac("sha256", secret)
      .update(payloadStr)
      .digest("hex");
    headers["X-TaktKoord-Signature"] = `sha256=${signature}`;
  }

  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: payloadStr,
      signal: AbortSignal.timeout(10_000),
    });

    const status = res.ok ? "DELIVERED" : "FAILED";
    await db
      .update(webhookEventsTable)
      .set({ status, attempts: 1, lastAttemptAt: new Date() })
      .where(eq(webhookEventsTable.id, eventId));

    logger.info({ subscriptionId, eventId, httpStatus: res.status }, "Webhook delivered");
  } catch (err) {
    await db
      .update(webhookEventsTable)
      .set({ status: "FAILED", attempts: 1, lastAttemptAt: new Date() })
      .where(eq(webhookEventsTable.id, eventId));
    logger.warn({ err, subscriptionId, eventId }, "Webhook delivery error");
  }
}
