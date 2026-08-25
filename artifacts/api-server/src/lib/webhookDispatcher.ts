import { db } from "@workspace/db";
import {
  webhookSubscriptionsTable,
  webhookEventsTable,
} from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { createHmac } from "crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { logger } from "./logger";

export class InvalidWebhookTargetUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidWebhookTargetUrlError";
  }
}

function isPrivateIpv4(address: string): boolean {
  const octets = address.split(".").map(Number);
  const [a, b] = octets;
  return a === 127 || a === 10 || a === 0 || a === 169 && b === 254 ||
    a === 192 && b === 168 || a === 172 && b >= 16 && b <= 31;
}

function isPrivateIpv6(address: string): boolean {
  const normalized = address.toLowerCase().split("%")[0];
  if (normalized === "::1" || normalized === "::") return true;
  const first = parseInt(normalized.split(":")[0] || "0", 16);
  return (first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80;
}

function isBlockedAddress(address: string): boolean {
  return isIP(address) === 4 ? isPrivateIpv4(address) : isPrivateIpv6(address);
}

/**
 * Validate a webhook target at the point where it will be used.
 * DNS is resolved with all=true so a hostname cannot hide a private A/AAAA
 * record behind a public record.
 */
export async function validateWebhookTargetUrl(rawUrl: string): Promise<URL> {
  let target: URL;
  try {
    target = new URL(rawUrl);
  } catch {
    throw new InvalidWebhookTargetUrlError("Webhook URL must be a valid URL");
  }
  if (target.protocol !== "http:" && target.protocol !== "https:") {
    throw new InvalidWebhookTargetUrlError("Webhook URL must use HTTP or HTTPS");
  }
  if (process.env.NODE_ENV === "production" && target.protocol !== "https:") {
    throw new InvalidWebhookTargetUrlError("Webhook URLs must use HTTPS in production");
  }
  const hostname = target.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (hostname === "localhost" || hostname === "localhost.localdomain" ||
      (isIP(hostname) > 0 && isBlockedAddress(hostname))) {
    throw new InvalidWebhookTargetUrlError("Webhook target resolves to a blocked address");
  }

  let addresses: Array<{ address: string }>;
  try {
    addresses = isIP(hostname)
      ? [{ address: hostname }]
      : await lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new InvalidWebhookTargetUrlError("Webhook hostname could not be resolved");
  }
  if (addresses.length === 0 || addresses.some(({ address }) => isBlockedAddress(address))) {
    throw new InvalidWebhookTargetUrlError("Webhook target resolves to a blocked address");
  }
  return target;
}

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
    const target = await validateWebhookTargetUrl(url);
    const res = await fetch(target, {
      method: "POST",
      headers,
      body: payloadStr,
      signal: AbortSignal.timeout(10_000),
      redirect: "manual",
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
