import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import Dashboard from "@/pages/dashboard";

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("AG-Dashboard Arbeitscockpit", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/api/dashboard/ag")) {
          return jsonResponse({
            kpis: {
              openTasks: 2,
              overdueTasks: 1,
              openInvitations: 1,
              pendingDataOffers: 1,
            },
            activeProjectsCount: 3,
            nextActions: [
              {
                id: "task:response-1",
                kind: "DECIDE_RESPONSE",
                title: "Antwort entscheiden",
                description: "Leistung · Partner AN",
                projectId: "project-1",
                projectName: "Neubau Halle Nord",
                partnerOrgId: "an-1",
                partnerName: "Montage Nord GmbH",
                dueAt: "2026-09-01T10:00:00.000Z",
                status: "OVERDUE",
                targetUrl: "/leistungsanfragen/request-1",
              },
            ],
            projectCollaborations: [
              {
                id: "membership-1",
                projectId: "project-1",
                projectName: "Neubau Halle Nord",
                partnerOrgId: "an-1",
                partnerName: "Montage Nord GmbH",
                membershipStatus: "ACTIVE",
                membershipLabel: "Mitgliedschaft aktiv",
                dataOfferStatus: "NOT_PUBLISHED",
                dataOfferLabel: "Noch keine Datenfreigabe",
                publicationId: null,
                targetUrl: "/projects/project-1",
              },
            ],
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

  it("zeigt Prozesslage und eine direkte Aktion für fehlende Datenfreigabe", async () => {
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

    expect(await screen.findByText("Daten für AN freigeben")).toBeInTheDocument();
    expect(screen.getAllByText("Überfällig").length).toBeGreaterThan(0);
    expect(screen.getByText("aktive Projektzusammenarbeiten")).toBeInTheDocument();
    expect(screen.getByTestId("link-collaboration-membership-1"))
      .toHaveAttribute("href", "/projects/project-1");
    expect(vi.mocked(fetch).mock.calls.some(([input]) =>
      String(input).includes("/api/dashboard/ag"),
    )).toBe(true);
  });
});