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
  requestNumber: "TKR-2026-0001",
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
  responseRequiredBy: null,
  receivedAt: "2026-08-25T09:00:00.000Z",
  detailsRetrievedAt: "2026-08-25T09:01:00.000Z",
  policySnapshot: null,
  resourceRequirementCount: 0,
  createdAt: "2026-08-25T09:00:00.000Z",
  updatedAt: "2026-08-25T09:01:00.000Z",
  schemaVersion: "1.0",
  snapshotPayload: {
    kurzbezeichnung: "Trockenbau 2. OG",
    plannedTimeWindow: {
      start: "2026-09-01T00:00:00.000Z",
      end: "2026-09-10T23:59:59.000Z",
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
  project: {
    id: "project-1",
    name: "Neubau Bochum",
    location: "Baufeld West",
  },
};

type CoordinationState = {
  currentAgreement: { start: string; end: string } | null;
  nextActionOwner: "AG" | "AN" | null;
  openProposal: { id: string; start: string; end: string; comment: string | null } | null;
};

const initialCoordination = (): CoordinationState => ({
  currentAgreement: {
    start: "2026-09-01T00:00:00.000Z",
    end: "2026-09-10T23:59:59.000Z",
  },
  nextActionOwner: "AN",
  openProposal: {
    id: proposalId,
    start: "2026-09-03T00:00:00.000Z",
    end: "2026-09-07T23:59:59.000Z",
    comment: "Bitte um Verschiebung",
  },
});

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function renderDetail(
  coordination: CoordinationState = initialCoordination(),
  options: { detailStatus?: number; coordinationStatus?: number } = {},
) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string"
      ? input
      : input instanceof Request
        ? input.url
        : input.toString();
    const method = init?.method ?? (input instanceof Request ? input.method : "GET");

    if (url.endsWith(`/api/an/leistungsanfragen/${requestId}/details`)) {
      return jsonResponse(detail, options.detailStatus ?? 200);
    }
    if (url.endsWith(`/api/an/leistungsanfragen/${requestId}/coordination`)) {
      return jsonResponse(coordination, options.coordinationStatus ?? 200);
    }
    if (url.endsWith(`/api/an/leistungsanfragen/${requestId}/resource-requirements`)) {
      return jsonResponse([]);
    }
    if (url.endsWith(`/api/an/leistungsanfragen/${requestId}/availability-checks/latest`)) {
      return jsonResponse({ error: "No local availability checks found" }, 404);
    }
    if (method === "POST" && url.includes(`/api/an/leistungsanfragen/${requestId}/change-proposals`)) {
      const path = new URL(url, "http://localhost").pathname;
      if (path.endsWith(`/${proposalId}/accept`) || path.endsWith(`/${proposalId}/reject`)) {
        coordination.openProposal = null;
        coordination.nextActionOwner = "AG";
        return jsonResponse({ proposalId, decision: path.endsWith("/accept") ? "ACCEPTED" : "REJECTED" });
      }
      const body = JSON.parse(String(init?.body ?? "{}")) as { start: string; end: string };
      coordination.openProposal = {
        id: path.endsWith("/counter") ? "counter-proposal-1" : "proposed-1",
        start: body.start,
        end: body.end,
        comment: null,
      };
      coordination.nextActionOwner = "AN";
      return jsonResponse(coordination.openProposal, 201);
    }
    return jsonResponse([]);
  });

  vi.stubGlobal("fetch", fetchMock);
  window.history.pushState({}, "", `/leistungsanfragen/${requestId}`);
  render(
    <QueryClientProvider client={client}>
      <Router base="/">
        <Route path="/leistungsanfragen/:requestId" component={LeistungsanfrageDetailPage} />
      </Router>
    </QueryClientProvider>,
  );
  return fetchMock;
}

function proposalSection() {
  const heading = screen.getByRole("heading", { name: "Zeitraum abstimmen" });
  const section = heading.closest("section");
  if (!section) throw new Error("Proposal section was not rendered");
  return within(section);
}

async function fillProposalDates(user: ReturnType<typeof userEvent.setup>) {
  fireEvent.change(proposalSection().getByLabelText("Beginn"), { target: { value: "2026-09-12" } });
  fireEvent.change(proposalSection().getByLabelText("Ende"), { target: { value: "2026-09-16" } });
  await user.click(proposalSection().getByRole("button", { name: /Zeitraum vorschlagen|Gegenvorschlag senden/ }));
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  setAuthTokenGetter(null);
  window.history.pushState({}, "", "/");
});

describe("AN Leistungsanfrage detail coordination", () => {
  it("loads an authenticated AN detail with an open proposal and accepts it via AN-local routes", async () => {
    setAuthTokenGetter(() => "authenticated-an-test-token");
    const fetchMock = renderDetail();

    expect(await screen.findByTestId("text-detail-title")).toHaveTextContent("Trockenbau 2. OG");
    expect(await screen.findByText(/Offener Vorschlag:/)).toBeInTheDocument();

    await userEvent.setup().click(proposalSection().getByRole("button", { name: "Annehmen" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      `/api/an/leistungsanfragen/${requestId}/change-proposals/${proposalId}/accept`,
      expect.objectContaining({ method: "POST", credentials: "include" }),
    ));
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Zeitraum abstimmen" })).not.toBeInTheDocument());
    expect(fetchMock.mock.calls.map(([url]) => String(url))).not.toContain(
      `/api/leistungsanfragen/${requestId}/change-proposals/${proposalId}/accept`,
    );
  });

  it("rejects an open proposal and refreshes the visible coordination state", async () => {
    const fetchMock = renderDetail();

    await screen.findByText(/Offener Vorschlag:/);
    await userEvent.setup().click(proposalSection().getByRole("button", { name: "Ablehnen" }));

    await waitFor(() => expect(fetchMock.mock.calls.map(([url]) => String(url))).toContain(
      `/api/an/leistungsanfragen/${requestId}/change-proposals/${proposalId}/reject`,
    ));
    await waitFor(() => expect(screen.queryByText(/Offener Vorschlag:/)).not.toBeInTheDocument());
  });

  it("sends AN-local counter proposals and shows the updated open proposal", async () => {
    const fetchMock = renderDetail();
    const user = userEvent.setup();

    await screen.findByText(/Offener Vorschlag:/);
    await fillProposalDates(user);

    await waitFor(() => expect(fetchMock.mock.calls.map(([url]) => String(url))).toContain(
      `/api/an/leistungsanfragen/${requestId}/change-proposals/${proposalId}/counter`,
    ));
    await waitFor(() => expect(screen.getByText(/Offener Vorschlag:/)).toBeInTheDocument());
    expect(fetchMock.mock.calls.map(([url]) => String(url))).not.toContain(
      `/api/leistungsanfragen/${requestId}/change-proposals/${proposalId}/counter`,
    );
  });

  it("proposes a new period through the AN-local route when no proposal is open", async () => {
    const coordination = initialCoordination();
    coordination.openProposal = null;
    const fetchMock = renderDetail(coordination);
    const user = userEvent.setup();

    expect(await screen.findByText("Sie können einen Zeitraum vorschlagen.")).toBeInTheDocument();
    await fillProposalDates(user);

    await waitFor(() => expect(fetchMock.mock.calls.map(([url]) => String(url))).toContain(
      `/api/an/leistungsanfragen/${requestId}/change-proposals`,
    ));
    await waitFor(() => expect(screen.getByText(/Offener Vorschlag:/)).toBeInTheDocument());
    expect(fetchMock.mock.calls.map(([url]) => String(url))).not.toContain(
      `/api/leistungsanfragen/${requestId}/change-proposals`,
    );
  });

  it("does not render AN actions for a mismatched request projection", async () => {
    renderDetail(initialCoordination(), { detailStatus: 404 });

    expect(await screen.findByRole("heading", { name: "Leistungsanfrage nicht verfügbar" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Zeitraum abstimmen" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Annehmen" })).not.toBeInTheDocument();
  });

  it("does not render AN actions when the session is not an AN organisation", async () => {
    renderDetail(initialCoordination(), { coordinationStatus: 403 });

    expect(await screen.findByTestId("text-detail-title")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Zeitraum abstimmen" })).not.toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Annehmen" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Zeitraum vorschlagen" })).not.toBeInTheDocument();
  });
});