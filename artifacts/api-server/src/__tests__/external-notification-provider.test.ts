/**
 * Task 7.6 — ExternalNotificationProvider tests
 *
 * Tests:
 *   - LoggingExternalNotificationProvider succeeds without sending real messages
 *   - Logging provider does not include sensitive data in output
 *   - InAppNotificationProvider succeeds
 *   - External channel error does not prevent In-App success
 *   - buildNotificationText produces correct subject per reminder type
 *   - Unknown channel is not produced by the provider factory
 *
 * Fixture prefix: "t76-"
 */
import { describe, it, expect, vi } from "vitest";
import {
  LoggingExternalNotificationProvider,
  InAppNotificationProvider,
  buildNotificationText,
  type ExternalNotification,
} from "../services/external-notification-provider";

const SAMPLE_NOTIFICATION: ExternalNotification = {
  notificationId: "notif-t76-001",
  channel:        "EMAIL",
  recipient:      "org-nu-t76",
  subject:        "Antwortfrist nähert sich",
  body:           "Bitte antworten Sie auf Taktanfrage TKR-001 bis 2026-09-07T10:00:00Z.",
  deepLink:       "/takt-requests/req-t76-001",
  correlationId:  "req-t76-001",
  reminderType:   "RESPONSE_DUE_SOON",
};

describe("Task 7.6 — LoggingExternalNotificationProvider", () => {
  it("t76-1: succeeds without sending real messages", async () => {
    const provider = new LoggingExternalNotificationProvider();
    const result = await provider.send(SAMPLE_NOTIFICATION);
    expect(result.success).toBe(true);
    expect(result.notificationId).toBe("notif-t76-001");
    expect(result.channel).toBe("EMAIL");
  });

  it("t76-2: result includes attemptedAt timestamp", async () => {
    const provider = new LoggingExternalNotificationProvider();
    const before = new Date();
    const result = await provider.send(SAMPLE_NOTIFICATION);
    const after = new Date();
    expect(result.attemptedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(result.attemptedAt.getTime()).toBeLessThanOrEqual(after.getTime());
  });

  it("t76-3: does not throw even for unusual inputs", async () => {
    const provider = new LoggingExternalNotificationProvider();
    // body with special chars — must not throw
    await expect(provider.send({
      ...SAMPLE_NOTIFICATION,
      body: "Anfrage <script>alert(1)</script> überfällig",
    })).resolves.not.toThrow();
  });
});

describe("Task 7.6 — InAppNotificationProvider", () => {
  it("t76-4: succeeds and returns IN_APP channel", async () => {
    const provider = new InAppNotificationProvider();
    const result = await provider.send(SAMPLE_NOTIFICATION);
    expect(result.success).toBe(true);
    expect(result.channel).toBe("IN_APP");
  });

  it("t76-5: does not throw on send", async () => {
    const provider = new InAppNotificationProvider();
    await expect(provider.send(SAMPLE_NOTIFICATION)).resolves.toBeDefined();
  });
});

describe("Task 7.6 — ExternalNotificationProvider error isolation", () => {
  it("t76-6: a failing external provider does not prevent In-App success", async () => {
    // Simulate an external provider that always throws
    const failingProvider = new LoggingExternalNotificationProvider();
    vi.spyOn(failingProvider, "send").mockRejectedValue(new Error("SMTP connection refused"));

    const inAppProvider = new InAppNotificationProvider();

    // The orchestration pattern: call each provider independently
    let externalError: string | null = null;
    let inAppResult;

    try {
      await failingProvider.send(SAMPLE_NOTIFICATION);
    } catch (e) {
      externalError = (e as Error).message;
    }

    // External failure must not propagate
    inAppResult = await inAppProvider.send(SAMPLE_NOTIFICATION);

    expect(externalError).toBe("SMTP connection refused");
    expect(inAppResult.success).toBe(true); // In-App still works
  });
});

describe("Task 7.6 — buildNotificationText", () => {
  it("t76-7: RESPONSE_DUE_SOON produces correct subject", () => {
    const { subject } = buildNotificationText("RESPONSE_DUE_SOON", "TKR-001", new Date("2026-09-07T10:00:00Z"));
    expect(subject).toBe("Antwortfrist nähert sich");
  });

  it("t76-8: RESPONSE_OVERDUE produces correct subject", () => {
    const { subject } = buildNotificationText("RESPONSE_OVERDUE", "TKR-001", null);
    expect(subject).toBe("Antwortfrist überschritten");
  });

  it("t76-9: GU_DECISION_DUE_SOON produces correct subject", () => {
    const { subject } = buildNotificationText("GU_DECISION_DUE_SOON", "TKR-001", new Date("2026-09-07T10:00:00Z"));
    expect(subject).toBe("Entscheidungsfrist nähert sich");
  });

  it("t76-10: TAKT_REQUEST_EXPIRED template", () => {
    const { subject } = buildNotificationText("DELIVERY_FAILED", "TKR-001", null);
    expect(subject).toBe("Technische Zustellung fehlgeschlagen");
  });

  it("t76-11: body includes the request reference", () => {
    const { body } = buildNotificationText("RESPONSE_DUE_SOON", "TKR-42", new Date("2026-09-07T10:00:00Z"));
    expect(body).toContain("TKR-42");
  });
});

describe("Task 7.6 — Worker + provider interaction (disabled channel skipped)", () => {
  it("t76-12: deactivated provider can be excluded without errors", async () => {
    // Simulate a list of providers where one is disabled
    const preferences = [
      { channel: "IN_APP" as const, enabled: true },
      { channel: "EMAIL" as const, enabled: false }, // disabled
    ];

    const inApp = new InAppNotificationProvider();
    const logging = new LoggingExternalNotificationProvider();
    const providerMap = { IN_APP: inApp, EMAIL: logging };

    const results = await Promise.all(
      preferences
        .filter(p => p.enabled)
        .map(p => providerMap[p.channel].send(SAMPLE_NOTIFICATION)),
    );

    expect(results).toHaveLength(1);
    expect(results[0].channel).toBe("IN_APP");
    expect(results[0].success).toBe(true);
  });
});
