import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { setAuthTokenGetter } from "@workspace/api-client-react";
import LeistungsanfragenInboxPage, { filterInboxItems, inboxItemType, inboxViewFor, nextActionOwner, type InboxItem } from "../leistungsanfragen-inbox";

const request = {
  id: "request-1",
  leistungsanfrageId: "request-1",
  taktRequestId: "request-1",
  localProjectionId: "local-request-1",
  requestNumber: "TKR-2026-0001",
  guOrgId: "ag-1",
  guOrgName: "Bau AG",
  nuOrgId: "an-1",
  projektId: "project-1",
  projectId: "project-1",
  status: "RECEIVED" as const,
  responseRequiredBy: "2030-10-16T12:00:00.000Z",
  receivedAt: "2026-10-10T09:00:00.000Z",
  detailsRetrievedAt: null,
  createdAt: "2026-10-10T09:00:00.000Z",
  updatedAt: "2026-10-10T09:00:00.000Z",
  leistungVersion: 1,
  taktVersion: 1,
  policySnapshot: null,
  resourceRequirementCount: 0,
  nextActionOwner: "AN" as const,
  nextAction: "RESPOND_TO_REQUEST" as const,
  coordinationState: "AN_ACTION_REQUIRED" as const,
  openProposal: null,
  takt: {
    id: "takt-1",
    taktBezeichnung: "Arbeitsbereich Trockenbau",
    kurzbezeichnung: "Trockenbau 2. OG",
    gewerk: "Trockenbau",
    zone: "2. OG",
    plannedStart: "2026-10-12",
    plannedEnd: "2026-10-16",
  },
  project: { id: "project-1", name: "Neubau Bochum", location: null },
} satisfies InboxItem;

const invitation = {
  id: "invitation-1",
  invitationId: "project-invitation-1",
  correlationId: "correlation-1",
  senderAgOrgId: "ag-1",
  senderAgOrgName: "Bau AG",
  receiverAnOrgId: "an-1",
  projectReference: "PROJ-001",
  projectName: "ANiib rohbau",
  projectDescription: "Rohbauarbeiten",
  projectLocation: "Bochum",
  invitationMessage: "Bitte treten Sie dem Projekt bei.",
  invitationExpiresAt: null,
  dataPublicationId: null,
  dataPublicationTitle: null,
  selectedFields: null,
  policySnapshot: {},
  status: "PENDING" as const,
  policyAcceptedAt: null,
  respondedAt: null,
  rejectedAt: null,
  createdAt: "2026-10-10T09:00:00.000Z",
  updatedAt: "2026-10-10T09:00:00.000Z",
};

function renderInbox() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><Router base=""><LeistungsanfragenInboxPage /></Router></QueryClientProvider>);
}

function json(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  setAuthTokenGetter(null);
});

describe("AN-Leistungsanfragen-Inbox", () => {
  it("zeigt Projekteinladungen als offene Elemente in den Anfragen", async () => {
    setAuthTokenGetter(() => "authenticated-an-test-token");
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/an/leistungsanfragen") return json([request]);
      if (url === "/api/an/project-invitations") return json([invitation]);
      return json({});
    });
    vi.stubGlobal("fetch", fetchMock);

    renderInbox();

    expect(await screen.findByTestId("text-request-title-request-1")).toHaveTextContent("Trockenbau 2. OG");
    expect(screen.getByTestId("text-project-invitation-title-invitation-1")).toHaveTextContent("ANiib rohbau");
    expect(screen.getByTestId("button-inbox-tab-open")).toHaveTextContent("Zu erledigen");
    expect(screen.getByTestId("button-inbox-tab-open")).toHaveTextContent("2");
    expect(screen.getByTestId("link-open-project-invitation-invitation-1")).toHaveAttribute("href", "/project-invitations");
  });

  it("kennzeichnet Terminänderungen getrennt von Leistungsanfragen", () => {
    const proposal = { ...request, openProposal: { id: "proposal-1", start: "2030-10-18T00:00:00.000Z", end: "2030-10-20T00:00:00.000Z", proposerRole: "AG" as const } };
    expect(inboxItemType(request)).toBe("SERVICE_REQUEST");
    expect(inboxItemType(proposal)).toBe("SCHEDULE_CHANGE");
    expect(inboxItemType(invitation)).toBe("PROJECT_JOIN");
    expect(inboxViewFor(invitation)).toBe("OPEN");
    expect(inboxViewFor({ ...invitation, status: "ACCEPTED" as const })).toBe("DONE");
  });

  it("filtert die gemeinsame Liste nach Vorgangstyp", () => {
    const proposal = { ...request, openProposal: { id: "proposal-1", start: "2030-10-18T00:00:00.000Z", end: "2030-10-20T00:00:00.000Z", proposerRole: "AG" as const } };
    const result = filterInboxItems([request, proposal, invitation], {
      inboxFilter: "ALL",
      typeFilter: "PROJECT_JOIN",
      deadlineFilter: "ALL",
      statusFilter: "ALL",
      coordinationFilter: "ALL",
      proposalFilter: "ALL",
      actionOwnerFilter: "ALL",
      scheduleFilter: "ALL",
    });
    expect(result).toEqual([invitation]);
  });

  it("ordnet die Ansichten anhand der nächsten Aktion statt anhand des technischen Status", () => {
    const agProposal = { ...request, status: "RESPONDED" as const, nextActionOwner: "AG" as const, nextAction: "DECIDE_RESPONSE" as const };
    const newAgProposal = { ...request, status: "RESPONDED" as const, nextActionOwner: "AG" as const, openProposal: { id: "proposal-1", start: "2030-10-18T00:00:00.000Z", end: "2030-10-20T00:00:00.000Z", proposerRole: "AG" as const } };
    const done = { ...request, status: "CONFIRMED" as const, nextActionOwner: null, nextAction: "NO_ACTION" as const, coordinationState: "AGREED" as const };
    expect(inboxViewFor(agProposal)).toBe("WAITING");
    expect(inboxViewFor(newAgProposal)).toBe("OPEN");
    expect(inboxViewFor(done)).toBe("DONE");
    expect(nextActionOwner(newAgProposal)).toBe("AN");
  });

  it("bringt einen neuen AG-Terminvorschlag prominent in Zu erledigen", async () => {
    const proposal = { ...request, status: "RESPONDED" as const, nextActionOwner: "AG" as const, openProposal: { id: "proposal-1", start: "2030-10-18T00:00:00.000Z", end: "2030-10-20T00:00:00.000Z", proposerRole: "AG" as const } };
    vi.stubGlobal("fetch", vi.fn(async () => json([proposal])));
    renderInbox();
    const card = await screen.findByTestId("card-request-request-1");
    expect(within(card).getByTestId("next-action-request-1")).toHaveTextContent("Neuer AG-Terminvorschlag");
    expect(within(card).getByRole("link", { name: "Trockenbau 2. OG" })).toHaveAttribute("href", "/leistungsanfragen/request-1");
  });

  it("filtert technische Status nur als sekundären Detailfilter", () => {
    const waiting = { ...request, status: "RESPONDED" as const, nextActionOwner: "AG" as const, nextAction: "DECIDE_RESPONSE" as const };
    const filtered = filterInboxItems([request, waiting], {
      inboxFilter: "OPEN",
      deadlineFilter: "ALL",
      statusFilter: "RECEIVED",
      coordinationFilter: "ALL",
      proposalFilter: "ALL",
      actionOwnerFilter: "ALL",
      scheduleFilter: "ALL",
    });
    expect(filtered).toEqual([request]);
  });
});