import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import RequestsPage from "../requests";

const localRequest = {
  id: "external-request-1",
  leistungsanfrageId: "external-request-1",
  taktRequestId: "external-request-1",
  localProjectionId: "local-request-1",
  requestNumber: "TKR-2026-0001",
  status: "RECEIVED",
  guOrgId: "ag-1",
  nuOrgId: "an-1",
  projektId: "project-1",
  projectId: "project-1",
  plannedStart: "2026-09-01",
  plannedEnd: "2026-09-02",
  responseRequiredBy: null,
  receivedAt: "2026-08-25T09:00:00.000Z",
  detailsRetrievedAt: null,
  policySnapshot: null,
  resourceRequirementCount: 1,
  createdAt: "2026-08-25T09:00:00.000Z",
  updatedAt: "2026-08-25T09:00:00.000Z",
  takt: {
    id: "leistung-1",
    taktBezeichnung: "Trockenbau 2. OG",
    gewerk: "Trockenbau",
    zone: "2. OG",
    plannedStart: "2026-09-01",
    plannedEnd: "2026-09-02",
  },
  project: { id: "project-1", name: "Neubau Bochum", location: null },
};

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Router base="/">
        <RequestsPage />
      </Router>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("AN Leistungsanfragen worklist", () => {
  it("consumes the generated AN-local contract and preserves the worklist view", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => new Response(
      JSON.stringify([localRequest]),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ));
    vi.stubGlobal("fetch", fetchMock);

    renderPage();

    expect(await screen.findByText("Neubau Bochum")).toBeInTheDocument();
    expect(screen.getByText(/Trockenbau 2\. OG/)).toBeInTheDocument();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/an/leistungsanfragen",
      expect.objectContaining({ method: "GET" }),
    ));
  });
});