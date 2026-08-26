import { describe, expect, it, vi } from "vitest";

vi.mock("node:dns/promises", () => ({
  lookup: vi.fn(async (hostname: string) => {
    if (hostname === "private.example.test") {
      return [{ address: "10.20.30.40", family: 4 }];
    }
    if (hostname === "mapped-private.example.test") {
      return [{ address: "::ffff:c0a8:0101", family: 6 }];
    }
    if (hostname === "documentation.example.test") {
      return [{ address: "198.51.100.10", family: 4 }];
    }
    if (hostname === "multicast.example.test") {
      return [{ address: "239.255.255.250", family: 4 }];
    }
    if (hostname === "reserved.example.test") {
      return [{ address: "240.0.0.1", family: 4 }];
    }
    return [{ address: "93.184.216.34", family: 4 }];
  }),
}));

import { validateWebhookTargetUrl } from "../lib/webhookDispatcher";
import { toWebhookSubscriptionDto } from "../routes/webhooks";

describe("webhook target SSRF protection", () => {
  it.each([
    "http://127.0.0.1",
    "http://127.12.34.56",
    "http://localhost",
    "http://10.0.0.1",
    "http://172.16.0.1",
    "http://172.31.255.255",
    "http://192.168.1.1",
    "http://169.254.169.254",
    "http://0.0.0.0",
    "http://[::ffff:127.0.0.1]",
    "http://[::ffff:192.168.1.1]",
    "http://[::ffff:169.254.169.254]",
    "http://[::1]",
    "http://192.0.0.1",
    "http://192.0.2.1",
    "http://192.31.196.1",
    "http://192.52.193.1",
    "http://192.88.99.1",
    "http://198.51.100.1",
    "http://192.175.48.1",
    "http://203.0.113.1",
    "http://224.0.0.1",
    "http://239.255.255.250",
    "http://240.0.0.1",
    "http://255.255.255.255",
  ])("rejects %s", async (url) => {
    await expect(validateWebhookTargetUrl(url)).rejects.toThrow();
  });

  it("rejects a hostname when any DNS result is private", async () => {
    await expect(
      validateWebhookTargetUrl("http://private.example.test"),
    ).rejects.toThrow(/blocked address/i);
  });

  it("rejects a hostname when DNS resolves to a mapped private IPv4 address", async () => {
    await expect(
      validateWebhookTargetUrl("http://mapped-private.example.test"),
    ).rejects.toThrow(/blocked address/i);
  });

  it("rejects documentation, multicast, and reserved DNS results", async () => {
    await expect(
      validateWebhookTargetUrl("http://documentation.example.test"),
    ).rejects.toThrow(/blocked address/i);
    await expect(
      validateWebhookTargetUrl("http://multicast.example.test"),
    ).rejects.toThrow(/blocked address/i);
    await expect(
      validateWebhookTargetUrl("http://reserved.example.test"),
    ).rejects.toThrow(/blocked address/i);
  });

  it("allows a publicly routable IPv4 target", async () => {
    await expect(
      validateWebhookTargetUrl("http://93.184.216.34"),
    ).resolves.toEqual(new URL("http://93.184.216.34"));
  });

  it("allows a hostname with only publicly routable DNS results", async () => {
    await expect(
      validateWebhookTargetUrl("http://public.example.test"),
    ).resolves.toEqual(new URL("http://public.example.test"));
  });

  it("requires HTTPS in production", async () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      await expect(validateWebhookTargetUrl("http://93.184.216.34")).rejects.toThrow(/HTTPS/);
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