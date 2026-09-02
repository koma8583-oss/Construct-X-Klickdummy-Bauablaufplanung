import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import Dashboard from "@/pages/dashboard";

vi.mock("@/components/coordination-tasks-panel", () => ({
  CoordinationTasksPanel: () => <div data-testid="coordination-tasks-panel" />,
}));

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("AN-Dashboard Arbeitscockpit", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/api/dashboard/an")) {
          return jsonResponse({
            kpis: {
              openInvitations: 1,
              newDataOffers: 0,
              openRequests: 0,
              criticalDeadlines: 0,
            },
            openInvitations: [
              {
                id: "invitation-1",
                projectName: "Neubau Halle Nord",
                agName: "Bauplanung Nord AG",
                status: "PENDING",
                createdAt: "2026-09-01T08:00:00.000Z",
                 targetUrl: "/project-invitations",
              },
            ],
            newDataOffers: [],
            nextActions: [],
            projectCollaborations: [],
            operationalOutlook: [],
          });
        }
        return jsonResponse({});
      }),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("zeigt offene Projekteinladungen direkt auf dem Dashboard", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <Router base="">
          <Dashboard />
        </Router>
      </QueryClientProvider>,
    );

    expect(await screen.findByText("Neubau Halle Nord")).toBeInTheDocument();
    expect(screen.getByText("1 offen")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Alle Projekteinladungen öffnen" }),
    ).toHaveAttribute("href", "/project-invitations");
    expect(vi.mocked(fetch).mock.calls.some(([input]) =>
      String(input).includes("/api/dashboard/an"),
    )).toBe(true);
  });
});