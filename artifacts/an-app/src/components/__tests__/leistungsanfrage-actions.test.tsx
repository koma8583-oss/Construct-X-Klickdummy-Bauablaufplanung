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
          currentAgreement: {
            start: "2026-09-01T00:00:00.000Z",
            end: "2026-09-10T23:59:59.000Z",
          },
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

  it("zeigt die dauerhafte Zeitraum-Abstimmung nur bei einem offenen Vorschlag", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/coordination")) {
        return response({
          nextAction: "RESPOND_TO_CHANGE_PROPOSAL",
          nextActionOwner: "AN",
          currentAgreement: { start: "2026-09-01T00:00:00.000Z", end: "2026-09-10T23:59:59.000Z" },
          openProposal: {
            id: "proposal-1",
            start: "2026-09-03T00:00:00.000Z",
            end: "2026-09-07T23:59:59.000Z",
            proposerRole: "AG",
          },
        });
      }
      return response({});
    }));
    renderAuthenticated(
      <ProposalActions requestId="authenticated-request" />,
    );
    expect(await screen.findByText("Neuer Terminvorschlag")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Bestätigen" })).toBeInTheDocument();
  });

  it("rendert ohne offenen Gegenvorschlag keine dauerhafte Abstimmung", async () => {
    renderAuthenticated(<ProposalActions requestId="authenticated-request" />);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByText("Neuer Terminvorschlag")).not.toBeInTheDocument();
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

  it("explains that the AG must handle a request when AN has no action", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response({
      nextAction: "NO_ACTION",
      nextActionOwner: "AG",
    })));
    renderAuthenticated(<CurrentActionCard requestId="authenticated-request" />);
    expect(await screen.findByText("Keine Aktion erforderlich")).toBeInTheDocument();
    expect(await screen.findByText("Keine Aktion erforderlich. Anfrage muss durch den Auftraggeber bearbeitet werden.")).toBeInTheDocument();
  });
});