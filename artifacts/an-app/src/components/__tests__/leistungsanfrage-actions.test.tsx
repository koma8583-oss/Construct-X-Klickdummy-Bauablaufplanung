import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setAuthTokenGetter } from "@workspace/api-client-react";
import { CurrentActionCard } from "../current-action-card";
import { ProposalActions } from "../proposal-actions";

function response(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function renderAuthenticated(children: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{children}</QueryClientProvider>);
}

describe("authenticated AN Leistungsanfrage actions", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    setAuthTokenGetter(() => "authenticated-an-test-token");
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/coordination")) {
        return response({
          nextAction: "RESPOND_TO_REQUEST",
          nextActionOwner: "AN",
          responseRequiredBy: "2026-09-15T12:00:00.000Z",
          openProposal: null,
        });
      }
      return response({});
    }));
  });

  it("shows the German action text and deadline after authenticated login data loads", async () => {
    renderAuthenticated(
      <CurrentActionCard requestId="authenticated-request" action="NO_ACTION" owner="AG" />,
    );
    expect(await screen.findByText("Aktion erforderlich")).toBeInTheDocument();
    expect(screen.getByText("Leistungsanfrage beantworten")).toBeInTheDocument();
    expect(screen.getByText(/Antwort bis:/)).toBeInTheDocument();
  });

  it("renders ProposalActions at most once for one detail view", async () => {
    renderAuthenticated(
      <>
        <CurrentActionCard requestId="authenticated-request" />
        <ProposalActions requestId="authenticated-request" />
      </>,
    );
    expect(await screen.findByText("Leistungsanfrage beantworten")).toBeInTheDocument();
    expect(screen.getAllByText("Zeitraum abstimmen")).toHaveLength(1);
  });

  it("does not introduce horizontal overflow at the 390px mobile width", async () => {
    Object.defineProperty(document.documentElement, "clientWidth", { configurable: true, value: 390 });
    renderAuthenticated(
      <div style={{ width: "390px" }}>
        <CurrentActionCard requestId="authenticated-request" />
        <ProposalActions requestId="authenticated-request" />
      </div>,
    );
    await screen.findByText("Leistungsanfrage beantworten");
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(390);
  });
});