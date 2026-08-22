import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setAuthTokenGetter } from "@workspace/api-client-react";
import { CurrentActionCard } from "../current-action-card";

function response(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function renderCard(action: "NO_ACTION" | "DECIDE_RESPONSE", owner: "AG" | "AN") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <CurrentActionCard
        requestId="authenticated-request"
        action={action}
        owner={owner}
        responseRequiredBy="2026-09-15T12:00:00.000Z"
      />
    </QueryClientProvider>,
  );
}

describe("AG Leistungsanfrage current action after login", () => {
  beforeEach(() => {
    setAuthTokenGetter(() => "authenticated-ag-test-token");
    vi.stubGlobal("fetch", vi.fn(async () => response({
      nextAction: "NO_ACTION",
      nextActionOwner: "AN",
      responseRequiredBy: "2026-09-15T12:00:00.000Z",
    })));
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("shows the German action-required text for an authenticated request", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response({
      nextAction: "DECIDE_RESPONSE",
      nextActionOwner: "AG",
      responseRequiredBy: "2026-09-15T12:00:00.000Z",
    })));
    renderCard("DECIDE_RESPONSE", "AG");
    expect(await screen.findByText("Aktion erforderlich")).toBeInTheDocument();
    expect(screen.getByText("Antwort des AN prüfen")).toBeInTheDocument();
  });

  it("keeps the action card usable at 390px without horizontal overflow", async () => {
    Object.defineProperty(document.documentElement, "clientWidth", { configurable: true, value: 390 });
    renderCard("NO_ACTION", "AN");
    expect(await screen.findByText("Keine Aktion erforderlich")).toBeInTheDocument();
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(390);
  });
});