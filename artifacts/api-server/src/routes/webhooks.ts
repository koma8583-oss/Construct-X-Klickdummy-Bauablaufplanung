import { Router } from "express";
import { db } from "@workspace/db";
import { webhookSubscriptionsTable, webhookEventsTable } from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";
import { requireJwt } from "../middlewares/requireJwt";
import { z } from "zod";
import { InvalidWebhookTargetUrlError, validateWebhookTargetUrl } from "../lib/webhookDispatcher";

const router = Router();

export function toWebhookSubscriptionDto(sub: typeof webhookSubscriptionsTable.$inferSelect) {
  return {
    id: sub.id,
    orgId: sub.orgId,
    url: sub.url,
    events: sub.events,
    active: sub.active,
    secretConfigured: Boolean(sub.secret),
    createdAt: sub.createdAt,
  };
}

// GET /webhooks
router.get("/webhooks", requireJwt, async (req, res): Promise<void> => {
  const orgId = req.user!.orgId!;
  const subscriptions = await db
    .select()
    .from(webhookSubscriptionsTable)
    .where(eq(webhookSubscriptionsTable.orgId, orgId));

  res.json(subscriptions.map(toWebhookSubscriptionDto));
});

// POST /webhooks
router.post("/webhooks", requireJwt, async (req, res): Promise<void> => {
  const schema = z.object({
    url: z.string().url(),
    events: z.array(z.string()).min(1),
    secret: z.string().optional(),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  try {
    await validateWebhookTargetUrl(parsed.data.url);
  } catch (error) {
    if (error instanceof InvalidWebhookTargetUrlError) {
      res.status(400).json({ error: error.message });
      return;
    }
    throw error;
  }

  const [sub] = await db
    .insert(webhookSubscriptionsTable)
    .values({ ...parsed.data, orgId: req.user!.orgId! })
    .returning();

  res.status(201).json(toWebhookSubscriptionDto(sub));
});

// PATCH /webhooks/:webhookId
router.patch(
  "/webhooks/:webhookId",
  requireJwt,
  async (req, res): Promise<void> => {
    const schema = z.object({
      url: z.string().url().optional(),
      events: z.array(z.string()).optional(),
      active: z.boolean().optional(),
      secret: z.string().optional(),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    if (parsed.data.url) {
      try {
        await validateWebhookTargetUrl(parsed.data.url);
      } catch (error) {
        if (error instanceof InvalidWebhookTargetUrlError) {
          res.status(400).json({ error: error.message });
          return;
        }
        throw error;
      }
    }

    const [sub] = await db
      .update(webhookSubscriptionsTable)
      .set(parsed.data)
      .where(
        and(
          eq(webhookSubscriptionsTable.id, (req.params.webhookId as string)),
          eq(webhookSubscriptionsTable.orgId, req.user!.orgId!),
        ),
      )
      .returning();

    if (!sub) {
      res.status(404).json({ error: "Webhook not found" });
      return;
    }

    res.json(toWebhookSubscriptionDto(sub));
  },
);

// DELETE /webhooks/:webhookId
router.delete(
  "/webhooks/:webhookId",
  requireJwt,
  async (req, res): Promise<void> => {
    await db
      .delete(webhookSubscriptionsTable)
      .where(
        and(
          eq(webhookSubscriptionsTable.id, (req.params.webhookId as string)),
          eq(webhookSubscriptionsTable.orgId, req.user!.orgId!),
        ),
      );
    res.status(204).send();
  },
);

// GET /webhooks/events
router.get(
  "/webhooks/events",
  requireJwt,
  async (req, res): Promise<void> => {
    const orgId = req.user!.orgId!;
    const status = req.query.status as string | undefined;

    const subscriptions = await db
      .select({ id: webhookSubscriptionsTable.id })
      .from(webhookSubscriptionsTable)
      .where(eq(webhookSubscriptionsTable.orgId, orgId));

    const subIds = subscriptions.map((s) => s.id);
    if (subIds.length === 0) {
      res.json([]);
      return;
    }

    let query = db
      .select()
      .from(webhookEventsTable)
      .where(and(
        inArray(webhookEventsTable.subscriptionId, subIds),
        ...(status ? [eq(webhookEventsTable.status, status as "PENDING" | "DELIVERED" | "FAILED")] : []),
      ))
      .$dynamic();

    const events = await query.orderBy(webhookEventsTable.createdAt).limit(100);
    res.json(events);
  },
);

export default router;
