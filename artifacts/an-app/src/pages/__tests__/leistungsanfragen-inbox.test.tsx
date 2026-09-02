import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { setAuthTokenGetter } from "@workspace/api-client-react";
import LeistungsanfragenInboxPage, { filterInboxItems, type InboxItem } from "../leistungsanfragen-inbox";

const request = {
  id: "request-1",
  leistungsanfrageId: "request-1",
  localProjectionId: "local-request-1",
  requestNumber: "TKR-2026-0001",
  guOrgId: "ag-1",
  nuOrgId: "an-1",
  projektId: "project-1",
  projectId: "project-1",
  status: "RECEIVED",
  responseRequiredBy: "2026-10-16T12:00:00.000Z",
  receivedAt: "2026-10-10T09:00:00.000Z",
  detailsRetrievedAt: null,
  createdAt: "2026-10-10T09:00:00.000Z",
  updatedAt: "2026-10-10T09:00:00.000Z",
  leistungVersion: 1,
  taktVersion: 1,
  policySnapshot: null,
  resourceRequirementCount: 0,
  takt: {
    id: "takt-1",
    taktBezeichnung: "Arbeitsbereich Trockenbau",
    kurzbezeichnung: "Trockenbau 2. OG",
    gewerk: "Trockenbau",
    zone: "2. OG",
    plannedStart: "2026-10-12",
    plannedEnd: "2026-10-16",
  },
  project: {
    id: "project-1",
    name: "Neubau Bochum",
    location: null,
  },
};

function renderInbox() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Router base="/">
        <LeistungsanfragenInboxPage />
      </Router>
    </QueryClientProvider>,
  );
}

function json(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("gemeinsame AN-Anfragen-Inbox", () => {
  it("zeigt lokale Projekteinladungen und Leistungsanfragen gemeinsam", async () => {
    setAuthTokenGetter(() => "authenticated-an-test-token");
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/an/leistungsanfragen") return json([request]);
      if (url === "/api/an/project-invitations") {
        return json([{
          id: "invitation-1",
          invitationId: "project-invitation-1",
          correlationId: "correlation-1",
          senderAgOrgId: "ag-1",
          receiverAnOrgId: "an-1",
          projectReference: "P-2026-1",
          projectName: "Neubau Bochum",
          policySnapshot: { name: "Projektpolicy", purpose: "Taktkoordination" },
          status: "PENDING",
          createdAt: "2026-10-11T09:00:00.000Z",
          updatedAt: "2026-10-11T09:00:00.000Z",
        }]);
      }
      return json({});
    });
    vi.stubGlobal("fetch", fetchMock);

    const { container } = renderInbox();

    expect(await screen.findByText("Projekteinladung")).toBeInTheDocument();
    expect(screen.getByTestId("text-inbox-title")).toHaveTextContent("Anfragen & Einladungen");
    expect(screen.getByText("Projekt beitreten")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Trockenbau 2. OG" })).toHaveAttribute(
      "href",
      expect.stringContaining("/leistungsanfragen/request-1"),
    );
    expect(container.textContent?.indexOf("Neubau Bochum")).toBeLessThan(
      container.textContent?.indexOf("Trockenbau 2. OG") ?? -1,
    );
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual(expect.arrayContaining([
      "/api/an/leistungsanfragen",
      "/api/an/project-invitations",
    ]));
  });

  it("zeigt reine Projekteinladungen mit Policy-Vorschau und ohne Datenzugriff an", async () => {
    setAuthTokenGetter(() => "authenticated-an-test-token");
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("/api/takt-requests")) return json([]);
      if (url === "/api/an/project-invitations") {
        return json([{
          id: "legacy-invitation",
          invitationId: "project-invitation-legacy",
          correlationId: "correlation-legacy",
          senderAgOrgId: "ag-legacy",
          receiverAnOrgId: "an-1",
          projectReference: "P-LEGACY-1",
          projectName: "Bestandsprojekt",
          projectDescription: "Sanierung des Bestandsgebäudes",
          projectLocation: "Baufeld West",
          policySnapshot: {
            policyId: "tk-policy-legacy",
            templateVersion: 1,
            code: "PROJECT_MEMBERSHIP",
            name: "Projektaufnahme",
            description: "Grundlegende Projektinformationen für die Aufnahme.",
            purpose: "projectMembership",
            permissions: ["READ", "USE_AS_PROJECT_PARTNER"],
            prohibitions: ["REDISTRIBUTE", "AI_TRAINING"],
            validUntil: "2026-12-31T00:00:00.000Z",
          },
          status: "PENDING",
          createdAt: "2026-10-11T09:00:00.000Z",
          updatedAt: "2026-10-11T09:00:00.000Z",
        }]);
      }
      return json({});
    });
    vi.stubGlobal("fetch", fetchMock);

    renderInbox();

    await screen.findByTestId("card-invitation-legacy-invitation");
    const card = screen.getByTestId("card-invitation-legacy-invitation");
    expect(within(card).getAllByText("Projektaufnahme").length).toBeGreaterThan(0);
    expect(within(card).queryByText("P-LEGACY-1")).not.toBeInTheDocument();
    expect(within(card).getByText("READ, USE_AS_PROJECT_PARTNER")).toBeInTheDocument();
    expect(within(card).getByText("REDISTRIBUTE, AI_TRAINING")).toBeInTheDocument();
    expect(within(card).getByText(/keine Leistungsfreigabe und erzeugt keinen EDC-Vertrag/i)).toBeInTheDocument();
    expect(within(card).queryByText("Datenangebot:")).not.toBeInTheDocument();
  });

  it("rendert lokale AN-Projektionen ohne optionale Koordinationsfelder", async () => {
    setAuthTokenGetter(() => "authenticated-an-test-token");
    const { scheduleDelta: _scheduleDelta, ...localProjectionRequest } = request;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/an/leistungsanfragen") return json([localProjectionRequest]);
      if (url === "/api/an/project-invitations") return json([]);
      return json({});
    });
    vi.stubGlobal("fetch", fetchMock);

    renderInbox();

    expect(await screen.findByTestId("card-request-request-1")).toBeInTheDocument();
    expect(screen.getByText("Kein Ressourcenbedarf veröffentlicht")).toBeInTheDocument();
  });

  it("applies service-request filters without treating invitations as service requests", async () => {
    const mixedInbox: InboxItem[] = [
      {
        kind: "invitation",
        data: {
          id: "invitation-filter-1",
          invitationId: "project-invitation-filter-1",
          correlationId: "correlation-filter-1",
          senderAgOrgId: "ag-1",
          receiverAnOrgId: "an-1",
          projectReference: "P-2026-filter",
          projectName: "Einladung für Filtertest",
          policySnapshot: {},
          status: "PENDING",
          createdAt: "2026-10-11T09:00:00.000Z",
          updatedAt: "2026-10-11T09:00:00.000Z",
        },
        receivedAt: "2026-10-11T09:00:00.000Z",
        isOpen: true,
      },
      {
        kind: "service-request",
        data: request as InboxItem["data"],
        receivedAt: request.createdAt,
        isOpen: true,
      },
    ];

    const filtered = filterInboxItems(mixedInbox, {
      inboxFilter: "OPEN",
      deadlineFilter: "ALL",
      statusFilter: "RECEIVED",
      coordinationFilter: "ALL",
      proposalFilter: "ALL",
      actionOwnerFilter: "ALL",
      scheduleFilter: "ALL",
    });

    expect(filtered).toHaveLength(1);
    expect(filtered[0].kind).toBe("service-request");
  });

  it("entscheidet eine Einladung über die bestehende lokale Invitation-API", async () => {
    setAuthTokenGetter(() => "authenticated-an-test-token");
    let invitationStatus = "PENDING";
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/an/leistungsanfragen") return json([]);
      if (url === "/api/an/project-invitations") {
        return json([{
          id: "invitation-2",
          invitationId: "project-invitation-2",
          correlationId: "correlation-2",
          senderAgOrgId: "ag-2",
          receiverAnOrgId: "an-1",
          projectReference: "P-2026-2",
          projectName: "Umbau Essen",
          policySnapshot: { name: "Projektpolicy" },
          status: invitationStatus,
          createdAt: "2026-10-11T09:00:00.000Z",
          updatedAt: "2026-10-11T09:00:00.000Z",
          respondedAt: invitationStatus === "ACCEPTED" ? "2026-10-11T10:00:00.000Z" : null,
        }]);
      }
      if (url === "/api/an/project-invitations/invitation-2/accept" && init?.method === "POST") {
        expect(init.body).toBe(JSON.stringify({ policyAccepted: true }));
        invitationStatus = "ACCEPTED";
        return json({});
      }
      return json({});
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    renderInbox();

    await screen.findByTestId("card-invitation-invitation-2");
    const card = screen.getByTestId("card-invitation-invitation-2");
    await user.click(within(card).getByRole("checkbox"));
    await user.click(within(card).getByRole("button", { name: "Projekt beitreten" }));

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Projekt beitreten" })).not.toBeInTheDocument();
    });
    expect(screen.getByText("Keine offenen Anfragen oder Einladungen")).toBeInTheDocument();
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toContain(
      "/api/an/project-invitations/invitation-2/accept",
    );
  });
});