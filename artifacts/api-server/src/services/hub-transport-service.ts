/**
 * Hub-owned transport facade.
 *
 * AG and AN domain services must not import transport tables or use their
 * domain-role database clients for transport state. This module is the only
 * application service in the API that owns those table accesses; callers pass
 * business payloads and receive transport DTOs back.
 */
import {
  hubDb,
  hubMessagesTable,
  messageDeliveryAttemptsTable,
  messageInboxTable,
  messageOutboxTable,
  type HubMessage,
  type InsertMessageOutbox,
} from "@workspace/db";
import { and, asc, desc, eq, inArray, or, sql } from "drizzle-orm";
import {
  MessageNotFoundError,
  RecipientForbiddenError,
} from "../lib/transport/transport-errors";
import type { DataspaceMessageStatus, DataspaceMessageType } from "@workspace/api-zod";

export async function enqueueHubMessage(message: InsertMessageOutbox) {
  const [row] = await hubDb
    .insert(messageOutboxTable)
    .values(message)
    .onConflictDoNothing({ target: messageOutboxTable.messageId })
    .returning();
  return row ?? null;
}

export async function getHubOutboxMessage(
  messageId: string,
  scope?: {
    senderOrgId?: string;
    recipientOrgId?: string;
    messageType?: DataspaceMessageType;
  },
) {
  const conditions = [eq(messageOutboxTable.messageId, messageId)];
  if (scope?.senderOrgId) conditions.push(eq(messageOutboxTable.senderOrgId, scope.senderOrgId));
  if (scope?.recipientOrgId) conditions.push(eq(messageOutboxTable.recipientOrgId, scope.recipientOrgId));
  if (scope?.messageType) conditions.push(eq(messageOutboxTable.messageType, scope.messageType as never));
  const [row] = await hubDb
    .select()
    .from(messageOutboxTable)
    .where(and(...conditions))
    .limit(1);
  return row ?? null;
}

export async function listHubOutboxByCorrelation(
  correlationId: string,
  messageType?: DataspaceMessageType,
) {
  const conditions = [eq(messageOutboxTable.correlationId, correlationId)];
  if (messageType) conditions.push(eq(messageOutboxTable.messageType, messageType as never));
  return hubDb
    .select()
    .from(messageOutboxTable)
    .where(and(...conditions))
    .orderBy(asc(messageOutboxTable.createdAt));
}

export async function listHubOutboxMessages(messageIds: string[]) {
  if (messageIds.length === 0) return [];
  return hubDb
    .select()
    .from(messageOutboxTable)
    .where(inArray(messageOutboxTable.messageId, messageIds as [string, ...string[]]));
}

export async function listHubDeliveryAttempts(messageIds: string[]) {
  if (messageIds.length === 0) return [];
  return hubDb
    .select()
    .from(messageDeliveryAttemptsTable)
    .where(inArray(messageDeliveryAttemptsTable.messageId, messageIds as [string, ...string[]]))
    .orderBy(
      asc(messageDeliveryAttemptsTable.attemptedAt),
      asc(messageDeliveryAttemptsTable.attemptNumber),
    );
}

export async function getHubInboxMessage(messageId: string, recipientOrgId: string) {
  const [row] = await hubDb
    .select()
    .from(messageInboxTable)
    .where(and(
      eq(messageInboxTable.messageId, messageId),
      eq(messageInboxTable.recipientOrgId, recipientOrgId),
    ))
    .limit(1);
  return row ?? null;
}

export async function listHubInbox(
  recipientOrgId: string,
  filters: {
    status?: DataspaceMessageStatus;
    messageType?: DataspaceMessageType;
    correlationId?: string;
    limit?: number;
    offset?: number;
  } = {},
) {
  const conditions = [eq(messageInboxTable.recipientOrgId, recipientOrgId)];
  if (filters.status) conditions.push(eq(messageInboxTable.status, filters.status as never));
  if (filters.messageType) conditions.push(eq(messageInboxTable.messageType, filters.messageType as never));
  if (filters.correlationId) conditions.push(eq(messageInboxTable.correlationId, filters.correlationId));
  return hubDb
    .select()
    .from(messageInboxTable)
    .where(and(...conditions))
    .orderBy(desc(messageInboxTable.receivedAt))
    .limit(filters.limit ?? 50)
    .offset(filters.offset ?? 0);
}

export async function markHubInboxMessageAsRead(
  messageId: string,
  recipientOrgId: string,
) {
  const [owned] = await hubDb
    .update(messageInboxTable)
    .set({
      status: "READ",
      readAt: new Date(),
    })
    .where(and(
      eq(messageInboxTable.messageId, messageId),
      eq(messageInboxTable.recipientOrgId, recipientOrgId),
    ))
    .returning();
  if (owned) return owned;

  const [existing] = await hubDb
    .select({ messageId: messageInboxTable.messageId })
    .from(messageInboxTable)
    .where(eq(messageInboxTable.messageId, messageId))
    .limit(1);
  if (!existing) throw new MessageNotFoundError(messageId);
  throw new RecipientForbiddenError(messageId, recipientOrgId);
}

export async function writeHubMessage(input: {
  type: HubMessage["type"];
  senderOrgId: string;
  recipientOrgId: string;
  correlationId?: string | null;
  delegationId?: string | null;
  payload?: Record<string, unknown> | null;
}) {
  const [row] = await hubDb
    .insert(hubMessagesTable)
    .values(input)
    .returning();
  return row;
}

export async function getHubOutboxFailureSummary(senderOrgId: string) {
  const [row] = await hubDb
    .select({
      pending: sql<number>`COUNT(*) FILTER (WHERE ${messageOutboxTable.status} = 'PENDING')`,
      delivered: sql<number>`COUNT(*) FILTER (WHERE ${messageOutboxTable.status} = 'DELIVERED')`,
      failed: sql<number>`COUNT(*) FILTER (WHERE ${messageOutboxTable.status} = 'FAILED')`,
      retries: sql<number>`COALESCE(SUM(${messageOutboxTable.attemptCount}) FILTER (WHERE ${messageOutboxTable.status} = 'FAILED'), 0)`,
    })
    .from(messageOutboxTable)
    .where(eq(messageOutboxTable.senderOrgId, senderOrgId));
  return row;
}

export async function listHubFailedMessages(
  senderOrgId: string,
  messageTypes: DataspaceMessageType[],
) {
  if (messageTypes.length === 0) return [];
  return hubDb
    .select()
    .from(messageOutboxTable)
    .where(and(
      eq(messageOutboxTable.senderOrgId, senderOrgId),
      eq(messageOutboxTable.status, "FAILED"),
      inArray(messageOutboxTable.messageType, messageTypes as [never, ...never[]]),
    ));
}