import { describe, expect, it } from "vitest";
import {
  NotificationEnvelopeSchema,
  createNotificationEnvelope,
} from "@workspace/api-zod";
import {
  notificationTypeForMessageType,
  parseNotificationEnvelope,
} from "../services/dataspace/notification-envelope";

const messageId = "urn:uuid:f9a97301-a000-44dd-b9d8-78488a40c6bb";
const senderBpn = "BPNL000000000AAA";
const receiverBpn = "BPNL000000000ZZZ";

describe("Tractus-X notification envelope", () => {
  it("creates the standard header and keeps business data in content", () => {
    const envelope = createNotificationEnvelope({
      messageId,
      messageType: "TAKT_REQUEST_NOTIFICATION",
      senderBpn,
      receiverBpn,
      sentDateTime: "2026-09-01T13:00:00.000Z",
      expectedResponseBy: "2026-09-03T13:00:00.000Z",
      content: { taktRequestId: "request-1", subject: "Neue Anfrage" },
    });

    expect(envelope.header).toEqual({
      messageId,
      context: "TaktKoord-ServiceCoordination-TaktRequest:1.0.0",
      sentDateTime: "2026-09-01T13:00:00.000Z",
      senderBpn,
      receiverBpn,
      expectedResponseBy: "2026-09-03T13:00:00.000Z",
      version: "3.0.0",
    });
    expect(envelope.content).toEqual({
      taktRequestId: "request-1",
      subject: "Neue Anfrage",
    });
    expect(NotificationEnvelopeSchema.parse(envelope)).toEqual(envelope);
  });

  it("rejects technical organisation IDs as BPNs and malformed message IDs", () => {
    const result = NotificationEnvelopeSchema.safeParse({
      header: {
        messageId: "an-org-1",
        context: "TaktKoord-ServiceCoordination-TaktRequest:1.0.0",
        sentDateTime: "2026-09-01T13:00:00.000Z",
        senderBpn: "an-org-1",
        receiverBpn,
        version: "3.0.0",
      },
      content: {},
    });

    expect(result.success).toBe(false);
  });

  it("parses a connector body and has no implicit context fallback", () => {
    const envelope = createNotificationEnvelope({
      messageId: "f9a97301-a000-44dd-b9d8-78488a40c6bb",
      messageType: "TAKT_RESPONSE_SUBMITTED",
      senderBpn,
      receiverBpn,
      content: { decision: "ACCEPTED" },
    });

    expect(parseNotificationEnvelope(envelope).content).toEqual({ decision: "ACCEPTED" });
    expect(notificationTypeForMessageType("TAKT_RESPONSE_SUBMITTED")).toBe("TAKT_RESPONSE_SUBMITTED");
    expect(() => notificationTypeForMessageType("UNREGISTERED_EVENT")).toThrow(
      "No versioned notification context registered",
    );
  });
});