import { describe, expect, it, vi } from "vitest";

vi.mock("node:dns/promises", () => ({
  lookup: vi.fn(async (hostname: string) => {
    if (hostname === "private.example.test") {
      return [{ address: "10.20.30.40", family: 4 }];
    }
    return [{ address: "203.0.113.10", family: 4 }];
  }),
}));

import { validateWebhookTargetUrl } from "../lib/webhookDispatcher";
import { toWebhookSubscriptionDto } from "../routes/webhooks";

describe("webhook target SSRF protection", () => {
  it.each([
    "http://127.0.0.1",
    "http://localhost",
    "http://10.0.0.1",
    "http://192.168.1.1",
    "http://169.254.169.254",
    "http://[::1]",
  ])("rejects %s", async (url) => {
    await expect(validateWebhookTargetUrl(url)).rejects.toThrow();
  });

  it("rejects a hostname when any DNS result is private", async () => {
    await expect(
      validateWebhookTargetUrl("http://private.example.test"),
    ).rejects.toThrow(/blocked address/i);
  });

  it("requires HTTPS in production", async () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      await expect(validateWebhookTargetUrl("http://203.0.113.10")).rejects.toThrow(/HTTPS/);
    } finally {
      process.env.NODE_ENV = previous;
    }
  });
});

describe("webhook subscription DTO", () => {
  it("never exposes the configured secret", () => {
    const dto = toWebhookSubscriptionDto({
      id: "sub-1",
      orgId: "org-1",
      url: "https://example.test/hooks",
      events: ["LEISTUNG_UPDATED"],
      active: true,
      secret: "must-not-leak",
      createdAt: new Date("2026-08-25T00:00:00Z"),
    });

    expect(dto).toEqual(expect.objectContaining({
      id: "sub-1",
      secretConfigured: true,
    }));
    expect(dto).not.toHaveProperty("secret");
  });
});