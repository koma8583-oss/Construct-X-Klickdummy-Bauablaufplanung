import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setAuthTokenGetter } from "@workspace/api-client-react";
import { Route, Router } from "wouter";
import LeistungsanfrageDetailPage from "../leistungsanfrage-detail";

const requestId = "an-request-1";
const proposalId = "proposal-1";

const detail = {
  id: requestId,
  leistungsanfrageId: requestId,
  taktRequestId: "takt-request-1",
  localProjectionId: "local-projection-1",
  requestNumber: "LAF-2026-0001",
  status: "UNDER_REVIEW",
  leistungVersion: 1,
  taktVersion: 1,
  guOrgId: "ag-org-1",
  guOrgName: "Bau AG",
  nuOrgId: "an-org-1",
  projektId: "project-1",
  projectId: "project-1",
  plannedStart: "2026-09-01",
  plannedEnd: "2026-09-10",
  responseRequiredBy: "2026-08-30T12:00:00.000Z",
  receivedAt: "2026-08-25T09:00:00.000Z",
  detailsRetrievedAt: "2026-08-25T09:01:00.000Z",
  policySnapshot: null,
  resourceRequirementCount: 0,
  createdAt: "2026-08-25T09:00:00.000Z",
  updatedAt: "2026-08-25T09:01:00.000Z",
  schemaVersion: "1.0",
  snapshotPayload: {
    leistung: { name: "Trockenbau 2. OG", description: "Innenausbau im zweiten Obergeschoss" },
    plannedTimeWindow: {
      start: "2026-09-01T07:00:00.000Z",
      end: "2026-09-10T16:00:00.000Z",
    },
  },
  resourceRequirements: [],
  takt: {
    id: "takt-1",
    taktBezeichnung: "Trockenbau 2. OG",
    kurzbezeichnung: "Trockenbau 2. OG",
    gewerk: "Trockenbau",
    zone: "2. OG",
    plannedStart: "2026-09-01",
    plannedEnd: "2026-09-10",
  },
  project: { id: "project-1", name: "Neubau Bochum", location: "Baufeld West" },
};

type CoordinationState = {
  currentAgreement: { start: string; end: string } | null;
  nextActionOwner: "AG" | "AN" | null;
  openProposal: { id: string; start: string; end: string; comment: string | null; proposerRole?: "AG" | "AN" } | null;
};

const initialCoordination = (): CoordinationState => ({
  currentAgreement: { start: "2026-09-01T07:00:00.000Z", end: "2026-09-10T16:00:00.000Z" },
  nextActionOwner: "AN",
  openProposal: {
    id: proposalId,
    start: "2026-09-03T00:00:00.000Z",
    end: "2026-09-07T23:59:59.000Z",
    comment: "Bitte um Verschiebung",
    proposerRole: "AG",
  },
});

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function renderDetail(coordination: CoordinationState = initialCoordination()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (url.endsWith(`/api/an/leistungsanfragen/${requestId}/details`)) return jsonResponse(detail);
    if (url.endsWith(`/api/an/leistungsanfragen/${requestId}/coordination`)) return jsonResponse(coordination);
    if (url.endsWith(`/api/an/leistungsanfragen/${requestId}/resource-requirements`)) return jsonResponse([]);
    if (url.endsWith(`/api/an/leistungsanfragen/${requestId}/availability-checks/latest`)) return jsonResponse({ error: "No local availability checks found" }, 404);
    if (method === "POST" && url.endsWith(`/api/leistungsanfragen/${requestId}/responses`)) return jsonResponse({ responseId: "response-1", decision: "ACCEPTED", requestStatus: "RESPONDED" }, 201);
    if (method === "POST" && url.includes(`/api/an/leistungsanfragen/${requestId}/change-proposals`)) {
      const path = new URL(url, "http://localhost").pathname;
      if (path.endsWith(`/${proposalId}/accept`) || path.endsWith(`/${proposalId}/reject`)) {
        coordination.openProposal = null;
        coordination.nextActionOwner = "AG";
        return jsonResponse({ proposalId, decision: path.endsWith("/accept") ? "ACCEPTED" : "REJECTED" });
      }
      const body = JSON.parse(String(init?.body ?? "{}")) as { start: string; end: string };
      coordination.openProposal = { id: "counter-proposal-1", start: body.start, end: body.end, comment: null, proposerRole: "AN" };
      return jsonResponse(coordination.openProposal, 201);
    }
    return jsonResponse([]);
  });
  vi.stubGlobal("fetch", fetchMock);
  window.history.pushState({}, "", `/leistungsanfragen/${requestId}`);
  render(<QueryClientProvider client={client}><Router base="/"><Route path="/leistungsanfragen/:requestId" component={LeistungsanfrageDetailPage} /></Router></QueryClientProvider>);
  return fetchMock;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  setAuthTokenGetter(null);
  window.history.pushState({}, "", "/");
});

describe("AN Leistungsanfrage detail", () => {
  it("zeigt nur die aktuelle Phase groß und hält abgeschlossene Phasen kompakt", async () => {
    renderDetail();
    expect(await screen.findByTestId("text-detail-title")).toHaveTextContent("Machbarkeit prüfen");
    expect(screen.getByTestId("phase-1")).toBeInTheDocument();
    expect(screen.getByTestId("phase-2")).toBeInTheDocument();
    expect(screen.getByTestId("phase-3-preview")).toHaveTextContent("Rückmeldung senden");
    expect(screen.getByTestId("secondary-request-details")).not.toHaveAttribute("open");
    expect(screen.getByTestId("overview-service")).toHaveTextContent("Trockenbau 2. OG");
    expect(screen.getByTestId("overview-period")).toHaveTextContent("01.09.2026 – 10.09.2026");
  });

  it("bestätigt ohne erneute Datumseingabe exakt das angefragte Zeitfenster", async () => {
    const noProposal = initialCoordination();
    noProposal.openProposal = null;
    const fetchMock = renderDetail(noProposal);
    const user = userEvent.setup();
    await user.click(await screen.findByTestId("button-continue-without-availability"));
    await user.click(await screen.findByTestId("button-decision-accepted"));
    expect(screen.queryByLabelText("Beginn 1")).not.toBeInTheDocument();
    await user.click(screen.getByTestId("button-submit-response"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      `/api/leistungsanfragen/${requestId}/responses`,
      expect.objectContaining({ method: "POST", body: JSON.stringify({ decision: "ACCEPTED", acceptedTimeWindow: { start: "2026-09-01T07:00:00.000Z", end: "2026-09-10T16:00:00.000Z" } }) }),
    ));
    expect(await screen.findByTestId("response-sent")).toHaveTextContent("Antwort gesendet – Auftraggeber ist am Zug.");
  });

  it("zeigt Datumsfelder ausschließlich bei einer vorgeschlagenen Alternative", async () => {
    const noProposal = initialCoordination();
    noProposal.openProposal = null;
    renderDetail(noProposal);
    const user = userEvent.setup();
    expect(screen.queryByTestId("input-alternative-start-0")).not.toBeInTheDocument();
    await user.click(await screen.findByTestId("button-continue-without-availability"));
    await user.click(await screen.findByTestId("button-decision-alternative"));
    expect(screen.getByTestId("input-alternative-start-0")).toBeInTheDocument();
    expect(screen.getByTestId("input-alternative-end-0")).toBeInTheDocument();
    expect(screen.queryByTestId("select-reason-code")).not.toBeInTheDocument();
    await user.click(screen.getByTestId("button-decision-rejected"));
    expect(screen.getByTestId("select-reason-code")).toBeInTheDocument();
    expect(screen.queryByTestId("input-alternative-start-0")).not.toBeInTheDocument();
  });

  it("zeigt die dauerhafte Zeitraum-Abstimmung nur bei einem offenen Vorschlag des AG", async () => {
    renderDetail();
    const user = userEvent.setup();
    await user.click(await screen.findByTestId("button-continue-without-availability"));
    expect(await screen.findByRole("heading", { name: "Neuer Terminvorschlag" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Bestätigen" })).toBeInTheDocument();

    cleanup();
    const noProposal = initialCoordination();
    noProposal.openProposal = null;
    renderDetail(noProposal);
    await screen.findByTestId("text-detail-title");
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Neuer Terminvorschlag" })).not.toBeInTheDocument());

    cleanup();
    const proposalFromAn = initialCoordination();
    proposalFromAn.openProposal = { ...proposalFromAn.openProposal!, proposerRole: "AN" };
    renderDetail(proposalFromAn);
    await screen.findByTestId("text-detail-title");
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Neuer Terminvorschlag" })).not.toBeInTheDocument());
  });

  it("übernimmt Empfehlungen der Verfügbarkeitsprüfung direkt in die Rückmeldung", async () => {
    const fetchMock = renderDetail();
    const user = userEvent.setup();
    cleanup();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const recommendationFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith(`/api/an/leistungsanfragen/${requestId}/details`)) return jsonResponse(detail);
      if (url.endsWith(`/api/an/leistungsanfragen/${requestId}/coordination`)) return jsonResponse({ ...initialCoordination(), openProposal: null });
      if (url.endsWith(`/api/an/leistungsanfragen/${requestId}/resource-requirements`)) return jsonResponse([]);
      if (url.endsWith(`/api/an/leistungsanfragen/${requestId}/availability-checks/latest`)) return jsonResponse({ status: "COMPLETED", result: "FEASIBLE", publicResultPayload: { recommendedDecision: "ACCEPTED", alternatives: [] } });
      if (init?.method === "POST" && url.endsWith(`/api/leistungsanfragen/${requestId}/responses`)) return jsonResponse({ responseId: "response-1" }, 201);
      return jsonResponse([]);
    });
    vi.stubGlobal("fetch", recommendationFetch);
    window.history.pushState({}, "", `/leistungsanfragen/${requestId}`);
    render(<QueryClientProvider client={client}><Router base="/"><Route path="/leistungsanfragen/:requestId" component={LeistungsanfrageDetailPage} /></Router></QueryClientProvider>);
    await user.click(await screen.findByTestId("button-use-availability-recommendation"));
    expect(screen.getByTestId("current-phase")).toHaveTextContent("3 · Rückmeldung senden");
    expect(screen.getByTestId("button-decision-accepted")).toHaveAttribute("aria-pressed", "true");
    expect(fetchMock).toBeDefined();
  });

  it("sendet Gegenentscheidungen über den AN-lokalen Pfad", async () => {
    const fetchMock = renderDetail();
    const user = userEvent.setup();
    await user.click(await screen.findByTestId("button-continue-without-availability"));
    await screen.findByRole("heading", { name: "Neuer Terminvorschlag" });
    const section = screen.getByRole("heading", { name: "Neuer Terminvorschlag" }).closest("section");
    if (!section) throw new Error("proposal section missing");
    fireEvent.change(within(section).getByLabelText("Neuer Beginn"), { target: { value: "2026-09-12" } });
    fireEvent.change(within(section).getByLabelText("Neues Ende"), { target: { value: "2026-09-16" } });
    await user.click(within(section).getByRole("button", { name: "Alternative vorschlagen" }));
    await waitFor(() => expect(fetchMock.mock.calls.map(([url]) => String(url))).toContain(`/api/an/leistungsanfragen/${requestId}/change-proposals/${proposalId}/counter`));
  });

  it("zeigt für eine nicht zugeordnete Projektion keine AN-Aktionen", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => String(input).endsWith("/details") ? jsonResponse({}, 404) : jsonResponse([])));
    window.history.pushState({}, "", `/leistungsanfragen/${requestId}`);
    render(<QueryClientProvider client={client}><Router base="/"><Route path="/leistungsanfragen/:requestId" component={LeistungsanfrageDetailPage} /></Router></QueryClientProvider>);
    expect(await screen.findByRole("heading", { name: "Leistungsanfrage nicht verfügbar" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Neuer Terminvorschlag" })).not.toBeInTheDocument();
  });
});