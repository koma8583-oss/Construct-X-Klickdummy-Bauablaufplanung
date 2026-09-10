import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getListLeistungsanfrageResourceRequirementsQueryKey, setAuthTokenGetter } from "@workspace/api-client-react";
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

type DetailRenderOptions = {
  client?: QueryClient;
  detailRetryResponse?: unknown;
  availabilityResponse?: Response;
  availabilityRetryResponse?: Response | Promise<Response>;
  availabilityMutationResponse?: Response;
  resourceMutationResponse?: Response;
  resourceRetryResponse?: Response | Promise<Response>;
};

function renderDetail(
  coordination: CoordinationState = initialCoordination(),
  detailResponse = detail,
  resourceResponse = jsonResponse([]),
  options: DetailRenderOptions = {},
) {
  const client = options.client ?? new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  let resourceRequestCount = 0;
  let detailRequestCount = 0;
  let availabilityRequestCount = 0;
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (url.endsWith(`/api/an/leistungsanfragen/${requestId}/details`)) {
      const response = detailRequestCount === 0 ? detailResponse : options.detailRetryResponse ?? detailResponse;
      detailRequestCount += 1;
      return jsonResponse(response);
    }
    if (url.endsWith(`/api/an/leistungsanfragen/${requestId}/coordination`)) return jsonResponse(coordination);
    if (
      url.endsWith(`/api/an/leistungsanfragen/${requestId}/resource-requirements`)
      || url.endsWith(`/api/leistungsanfragen/${requestId}/resource-requirements`)
      || url.includes(`/api/an/leistungsanfragen/${requestId}/resource-requirements/`)
      || url.includes(`/api/leistungsanfragen/${requestId}/resource-requirements/`)
    ) {
      if (method !== "GET") return options.resourceMutationResponse ?? jsonResponse({});
      const response = resourceRequestCount === 0 ? resourceResponse : options.resourceRetryResponse ?? resourceResponse;
      resourceRequestCount += 1;
      return response;
    }
    if (method === "POST" && url.endsWith(`/api/leistungsanfragen/${requestId}/availability-checks`)) {
      return options.availabilityMutationResponse ?? jsonResponse({});
    }
    if (url.endsWith(`/api/an/leistungsanfragen/${requestId}/availability-checks/latest`)) {
      const response = availabilityRequestCount === 0
        ? options.availabilityResponse
        : options.availabilityRetryResponse ?? options.availabilityResponse;
      availabilityRequestCount += 1;
      return response ?? jsonResponse({ error: "No local availability checks found" }, 404);
    }
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

  it("erklärt einen Policy-Block beim Laden des Ressourcenbedarfs", async () => {
    renderDetail(initialCoordination(), detail, jsonResponse({ error: "POLICY_NOT_PERMITTED" }, 409));

    const block = await screen.findByTestId("resource-policy-block");
    expect(block).toHaveTextContent("Ressourcendetails durch Policy gesperrt");
    expect(block).toHaveTextContent("Projektvereinbarung");
    expect(screen.queryByText("Ressourcenbedarf konnte nicht aktualisiert werden")).not.toBeInTheDocument();
    expect(screen.queryByTestId("button-retry-resources")).not.toBeInTheDocument();
  });

  it("nennt die Zustimmung als nächsten Schritt bei geschützten Ressourcendetails", async () => {
    renderDetail(initialCoordination(), detail, jsonResponse({ error: "POLICY_CONSENT_REQUIRED" }, 409));

    const block = await screen.findByTestId("resource-policy-block");
    expect(block).toHaveTextContent("Ressourcendetails noch nicht freigegeben");
    expect(block).toHaveTextContent("Bestätigen Sie zuerst");
  });

  it("aktualisiert geschützte Abfragen direkt nach der Zustimmung", async () => {
    const consentRequired = {
      ...detail,
      policyDeltaClass: "REQUIRES_CONSENT",
      policyConsentStatus: "PENDING",
      policyDetailsAvailable: false,
      policyDiff: { summary: ["Zeitraum wurde erweitert"], changed: ["Zeitraum"] },
    };
    const accepted = {
      ...consentRequired,
      policyConsentStatus: "ACCEPTED",
      policyDetailsAvailable: true,
    };
    const resourceAfterConsent = [{
      id: "resource-after-consent",
      resourceTypeName: "Team",
      resourceTypeCode: "TEAM",
      requiredCapacity: 2,
      capacityUnit: "Personen",
      utilizationPercent: 100,
      periodStart: "2026-09-01",
      periodEnd: "2026-09-10",
      requiredQualification: null,
      notes: null,
    }];
    const fetchMock = renderDetail(
      initialCoordination(),
      consentRequired,
      jsonResponse({ error: "POLICY_CONSENT_REQUIRED" }, 409),
      {
        detailRetryResponse: accepted,
        availabilityResponse: jsonResponse({ error: "POLICY_CONSENT_REQUIRED" }, 409),
        availabilityRetryResponse: jsonResponse({ status: "COMPLETED", result: "FEASIBLE", publicResult: {} }),
        resourceRetryResponse: jsonResponse(resourceAfterConsent),
      },
    );

    await userEvent.setup().click(await screen.findByTestId("button-accept-policy"));

    await waitFor(() => {
      expect(screen.getByTestId("policy-consent-accepted")).toBeInTheDocument();
      expect(screen.getByTestId("resource-row-resource-after-consent")).toBeInTheDocument();
      expect(screen.getByTestId("availability-result")).toHaveTextContent("Machbar");
    });
    expect(screen.queryByTestId("policy-consent-panel")).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toContain(`/api/an/leistungsanfragen/${requestId}/policy-consent`);
  });

  it("zeigt den Zustimmungsstatus bis zum Abschluss jedes geschützten Refreshs", async () => {
    Object.defineProperty(document.documentElement, "clientWidth", { configurable: true, value: 390 });
    const consentRequired = {
      ...detail,
      policyDeltaClass: "REQUIRES_CONSENT",
      policyConsentStatus: "PENDING",
      policyDetailsAvailable: false,
      policyDiff: { summary: ["Zeitraum wurde erweitert"], changed: ["Zeitraum"] },
    };
    const accepted = {
      ...consentRequired,
      policyConsentStatus: "ACCEPTED",
      policyDetailsAvailable: true,
    };
    let resolveAvailabilityRefresh!: (response: Response) => void;
    const delayedAvailabilityRefresh = new Promise<Response>((resolve) => {
      resolveAvailabilityRefresh = resolve;
    });

    renderDetail(
      initialCoordination(),
      consentRequired,
      jsonResponse({ error: "POLICY_CONSENT_REQUIRED" }, 409),
      {
        detailRetryResponse: accepted,
        availabilityResponse: jsonResponse({ error: "POLICY_CONSENT_REQUIRED" }, 409),
        availabilityRetryResponse: delayedAvailabilityRefresh,
        resourceRetryResponse: jsonResponse({ error: "POLICY_CONSENT_REQUIRED" }, 409),
      },
    );

    await userEvent.setup().click(await screen.findByTestId("button-accept-policy"));

    const refreshStatus = await screen.findByTestId("policy-refresh-status");
    expect(refreshStatus).toHaveTextContent("Policy-Zugriff bestätigt");
    expect(screen.getByTestId("policy-refresh-sections")).toHaveClass("grid", "min-w-0", "sm:flex");
    expect(screen.getByTestId("policy-refresh-details")).toHaveTextContent("Anfrage:");
    expect(screen.getByTestId("policy-refresh-resources")).toHaveTextContent("Ressourcen:");
    expect(screen.getByTestId("policy-refresh-availability")).toHaveTextContent("Verfügbarkeit:");
    await waitFor(() => {
      expect(screen.getByTestId("policy-refresh-resources")).toHaveTextContent("siehe Hinweis");
      expect(screen.getByTestId("policy-refresh-availability")).toHaveTextContent("wird aktualisiert");
    });
    expect(screen.getByTestId("resource-policy-block")).toHaveTextContent("noch nicht freigegeben");

    resolveAvailabilityRefresh(jsonResponse({ status: "COMPLETED", result: "FEASIBLE", publicResult: {} }));

    await waitFor(() => {
      expect(screen.queryByTestId("policy-refresh-status")).not.toBeInTheDocument();
      expect(screen.getByTestId("availability-result")).toHaveTextContent("Machbar");
    });
  });

  it("behält die Zustimmung nach Verlassen und erneutem Öffnen der kanonischen Leistungsanfrage", async () => {
    const consentRequired = {
      ...detail,
      policyDeltaClass: "REQUIRES_CONSENT",
      policyConsentStatus: "PENDING",
      policyDetailsAvailable: false,
      policyDiff: { summary: ["Zeitraum wurde erweitert"], changed: ["Zeitraum"] },
    };
    const accepted = {
      ...consentRequired,
      policyConsentStatus: "ACCEPTED",
      policyDetailsAvailable: true,
    };
    const resourceAfterConsent = [{
      id: "resource-after-reopen",
      resourceTypeName: "Team",
      resourceTypeCode: "TEAM",
      requiredCapacity: 2,
      capacityUnit: "Personen",
      utilizationPercent: 100,
      periodStart: "2026-09-01",
      periodEnd: "2026-09-10",
      requiredQualification: null,
      notes: null,
    }];
    const availabilityAfterConsent = jsonResponse({
      status: "COMPLETED",
      result: "FEASIBLE",
      publicResult: {},
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const firstFetch = renderDetail(
      { ...initialCoordination(), openProposal: null },
      consentRequired,
      jsonResponse({ error: "POLICY_CONSENT_REQUIRED" }, 409),
      {
        client,
        detailRetryResponse: accepted,
        availabilityResponse: jsonResponse({ error: "POLICY_CONSENT_REQUIRED" }, 409),
        availabilityRetryResponse: availabilityAfterConsent,
        resourceRetryResponse: jsonResponse(resourceAfterConsent),
      },
    );
    const user = userEvent.setup();

    await user.click(await screen.findByTestId("button-accept-policy"));
    await waitFor(() => {
      expect(screen.getByTestId("policy-consent-accepted")).toBeInTheDocument();
      expect(screen.getByTestId("resource-row-resource-after-reopen")).toBeInTheDocument();
      expect(screen.getByTestId("availability-result")).toHaveTextContent("Machbar");
    });
    expect(firstFetch.mock.calls.map(([url]) => String(url))).toContain(`/api/an/leistungsanfragen/${requestId}/policy-consent`);

    cleanup();
    window.history.pushState({}, "", "/leistungsanfragen");

    const reopenedFetch = renderDetail(
      { ...initialCoordination(), openProposal: null },
      accepted,
      jsonResponse(resourceAfterConsent),
      { client, availabilityResponse: availabilityAfterConsent },
    );

    expect(window.location.pathname).toBe(`/leistungsanfragen/${requestId}`);
    await waitFor(() => {
      expect(screen.queryByTestId("policy-consent-panel")).not.toBeInTheDocument();
      expect(screen.queryByTestId("policy-consent-rejected")).not.toBeInTheDocument();
      expect(screen.getByTestId("policy-consent-accepted")).toBeInTheDocument();
      expect(screen.getByTestId("resource-row-resource-after-reopen")).toBeInTheDocument();
      expect(screen.getByTestId("availability-result")).toHaveTextContent("Machbar");
    });
    expect(reopenedFetch.mock.calls.map(([url]) => String(url))).toEqual(
      expect.arrayContaining([
        `/api/an/leistungsanfragen/${requestId}/details`,
        `/api/leistungsanfragen/${requestId}/resource-requirements`,
        `/api/an/leistungsanfragen/${requestId}/availability-checks/latest`,
      ]),
    );
  });

  it("behält unterschiedliche Policy-Gründe bei einem fehlgeschlagenen Refresh", async () => {
    const consentRequired = {
      ...detail,
      policyDeltaClass: "REQUIRES_CONSENT",
      policyConsentStatus: "PENDING",
      policyDetailsAvailable: false,
      policyDiff: { summary: ["Zeitraum wurde erweitert"], changed: ["Zeitraum"] },
    };
    const accepted = {
      ...consentRequired,
      policyConsentStatus: "ACCEPTED",
      policyDetailsAvailable: true,
    };
    renderDetail(
      initialCoordination(),
      consentRequired,
      jsonResponse({ error: "POLICY_CONSENT_REQUIRED" }, 409),
      {
        detailRetryResponse: accepted,
        availabilityResponse: jsonResponse({ error: "POLICY_CONSENT_REQUIRED" }, 409),
        availabilityRetryResponse: jsonResponse({ error: "NOT_PERMITTED" }, 409),
        resourceRetryResponse: jsonResponse({ error: "POLICY_CONSENT_REQUIRED" }, 409),
      },
    );

    await userEvent.setup().click(await screen.findByTestId("button-accept-policy"));

    await waitFor(() => {
      expect(screen.getByTestId("availability-policy-block")).toHaveTextContent("durch Policy gesperrt");
      expect(screen.getByTestId("resource-policy-block")).toHaveTextContent("noch nicht freigegeben");
    });
    expect(screen.queryByText("Ressourcenbedarf konnte nicht aktualisiert werden")).not.toBeInTheDocument();
  });

  it("bietet bei einem vorübergehenden Ressourcenfehler eine lokale Wiederholung an", async () => {
    const retryResponse = [{
      id: "resource-after-retry",
      resourceTypeName: "Team",
      resourceTypeCode: "TEAM",
      requiredCapacity: 2,
      capacityUnit: "Personen",
      utilizationPercent: 100,
      periodStart: "2026-09-01",
      periodEnd: "2026-09-10",
      requiredQualification: null,
      notes: null,
    }];
    const fetchMock = renderDetail(initialCoordination(), detail, jsonResponse({ error: "Server temporarily unavailable" }, 503), {
      resourceRetryResponse: jsonResponse(retryResponse),
    });

    const retry = await screen.findByTestId("button-retry-resources");
    expect(screen.getByText("Ressourcenbedarf konnte nicht geladen werden. Bitte versuchen Sie es erneut.")).toBeInTheDocument();
    expect(screen.getByText("Noch kein Ressourcenbedarf erfasst. Ergänzen Sie nur den Bedarf, der für Ihre Rückmeldung relevant ist.")).toBeInTheDocument();
    await userEvent.setup().click(retry);

    await waitFor(() => expect(screen.getByTestId("resource-row-resource-after-retry")).toBeInTheDocument());
    expect(fetchMock.mock.calls.filter(([url, init]) =>
      (String(url).endsWith(`/api/an/leistungsanfragen/${requestId}/resource-requirements`)
        || String(url).endsWith(`/api/leistungsanfragen/${requestId}/resource-requirements`))
      && (init?.method ?? "GET") === "GET",
    )).toHaveLength(2);
    expect(screen.queryByTestId("button-retry-resources")).not.toBeInTheDocument();
  });

  it("hält Warnung und lokale Wiederholung nach einem erneut fehlgeschlagenen Ressourcen-Refresh verfügbar", async () => {
    const loadedResources = [{
      id: "resource-before-outage",
      resourceTypeName: "Team",
      resourceTypeCode: "TEAM",
      requiredCapacity: 2,
      capacityUnit: "Personen",
      utilizationPercent: 100,
      periodStart: "2026-09-01",
      periodEnd: "2026-09-10",
      requiredQualification: null,
      notes: null,
    }];
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const fetchMock = renderDetail(
      initialCoordination(),
      detail,
      jsonResponse(loadedResources),
      {
        client,
        resourceRetryResponse: jsonResponse({ error: "Gateway timeout" }, 504),
      },
    );

    expect(await screen.findByTestId("resource-row-resource-before-outage")).toBeInTheDocument();
    const warning = "Ressourcenbedarf konnte nicht aktualisiert werden. Die angezeigten Angaben stammen aus dem letzten erfolgreichen Abruf und können veraltet sein.";
    await client.refetchQueries({ queryKey: getListLeistungsanfrageResourceRequirementsQueryKey(requestId) });

    await waitFor(() => {
      expect(screen.getByText(warning)).toBeInTheDocument();
      expect(screen.getByTestId("button-retry-resources")).toBeEnabled();
      expect(screen.getByTestId("resource-row-resource-before-outage")).toBeInTheDocument();
    });
    expect(fetchMock.mock.calls.filter(([url, init]) =>
      (String(url).endsWith(`/api/an/leistungsanfragen/${requestId}/resource-requirements`)
        || String(url).endsWith(`/api/leistungsanfragen/${requestId}/resource-requirements`))
      && (init?.method ?? "GET") === "GET",
    )).toHaveLength(2);
    expect(screen.queryByTestId("resource-policy-block")).not.toBeInTheDocument();

    await userEvent.setup().click(screen.getByTestId("button-retry-resources"));
    await waitFor(() => expect(screen.getByTestId("button-retry-resources")).toBeEnabled());
    expect(screen.getByText(warning)).toBeInTheDocument();
  });

  it("erklärt einen Policy-Block beim Start der Verfügbarkeitsprüfung", async () => {
    renderDetail(initialCoordination(), detail, jsonResponse([]), {
      availabilityMutationResponse: jsonResponse({
        error: "POLICY_CONSENT_REQUIRED",
        code: "POLICY_CONSENT_REQUIRED",
        action: "AVAILABILITY",
      }, 409),
    });

    const user = userEvent.setup();
    await user.click(await screen.findByTestId("button-run-availability"));
    const block = await screen.findByTestId("availability-policy-block");
    expect(block).toHaveTextContent("Verfügbarkeitsprüfung noch nicht freigegeben");
    expect(block).toHaveTextContent("Bestätigen Sie zuerst");
  });

  it("erklärt einen Policy-Block bei einer geschützten Ressourcenänderung", async () => {
    const resource = [{
      id: "resource-1",
      resourceTypeName: "Team",
      resourceTypeCode: "TEAM",
      requiredCapacity: 2,
      capacityUnit: "Personen",
      utilizationPercent: 100,
      periodStart: "2026-09-01",
      periodEnd: "2026-09-10",
      requiredQualification: null,
      notes: null,
    }];
    renderDetail(initialCoordination(), detail, jsonResponse(resource), {
      resourceMutationResponse: jsonResponse({
        error: "NOT_PERMITTED",
        code: "NOT_PERMITTED",
        action: "RESOURCE",
      }, 409),
    });

    const user = userEvent.setup();
    vi.stubGlobal("confirm", vi.fn(() => true));
    await user.click(await screen.findByTestId("button-delete-resource-resource-1"));
    const block = await screen.findByTestId("resource-policy-block");
    expect(block).toHaveTextContent("Ressourcendetails durch Policy gesperrt");
    expect(block).toHaveTextContent("Projektvereinbarung");
  });

  it("führt eine Anfrage innerhalb der Projektvereinbarung von Details über Machbarkeit zur Rückmeldung", async () => {
    const receivedWithinBaseline = {
      ...detail,
      status: "RECEIVED",
      detailsRetrievedAt: null,
      policyDeltaClass: "WITHIN_BASELINE",
      policyDetailsAvailable: true,
    };
    const fetchMock = renderDetail({ ...initialCoordination(), openProposal: null }, receivedWithinBaseline);
    const user = userEvent.setup();

    expect(await screen.findByTestId("text-detail-title")).toHaveTextContent("Anfrage prüfen");
    expect(screen.getByText("Diese Anfrage erfolgt auf Grundlage Ihrer Projektvereinbarung")).toBeInTheDocument();
    await user.click(screen.getByTestId("button-review-request"));
    await waitFor(() => expect(fetchMock.mock.calls.map(([url]) => String(url))).toContain(`/api/an/leistungsanfragen/${requestId}/details/review`));
    expect(await screen.findByTestId("text-detail-title")).toHaveTextContent("Machbarkeit prüfen");
    await user.click(screen.getByTestId("button-continue-without-availability"));
    expect(await screen.findByTestId("text-detail-title")).toHaveTextContent("Rückmeldung senden");
  });

  it("beschränkt REQUIRES_CONSENT auf Metadaten, Diff und die beiden Entscheidungen", async () => {
    const consentRequired = {
      ...detail,
      status: "RECEIVED",
      detailsRetrievedAt: null,
      policyDeltaClass: "REQUIRES_CONSENT",
      policyConsentStatus: "PENDING",
      policyDetailsAvailable: false,
      policyDiff: { summary: ["Zeitraum wurde erweitert"], changed: ["Zeitraum"] },
    };
    renderDetail({ ...initialCoordination(), openProposal: null }, consentRequired);

    const panel = await screen.findByTestId("policy-consent-panel");
    expect(within(panel).getByText("Zeitraum wurde erweitert")).toBeInTheDocument();
    expect(within(panel).getByText(/Geänderte Bereiche: Zeitraum/)).toBeInTheDocument();
    expect(within(panel).getByTestId("button-accept-policy")).toBeEnabled();
    expect(within(panel).getByTestId("button-reject-policy")).toBeEnabled();
    expect(screen.queryByTestId("request-overview")).not.toBeInTheDocument();
    expect(screen.queryByTestId("resource-block")).not.toBeInTheDocument();
    expect(screen.queryByTestId("phase-progress")).not.toBeInTheDocument();
  });

  it("zeigt im Ressourcenbedarf keine Angaben aus dem veröffentlichten Anfrage-Snapshot", async () => {
    const detailWithPublishedRequirement = {
      ...detail,
      resourceRequirements: [{
        id: "published-resource",
        resourceTypeName: "Fremde interne Ressource",
        resourceTypeCode: "INTERNAL",
        requiredCapacity: 99,
        capacityUnit: "Personen",
        utilizationPercent: 100,
        periodStart: "2026-09-01",
        periodEnd: "2026-09-10",
        requiredQualification: null,
        notes: "Nicht aus dem AN-Arbeitsstand",
      }],
    };
    renderDetail({ ...initialCoordination(), openProposal: null }, detailWithPublishedRequirement);

    expect(await screen.findByTestId("resource-block")).toHaveTextContent("Noch kein Ressourcenbedarf erfasst");
    expect(screen.queryByText("Fremde interne Ressource")).not.toBeInTheDocument();
    expect(screen.queryByText("Nicht aus dem AN-Arbeitsstand")).not.toBeInTheDocument();
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

  it("bestätigt einen AG-Terminvorschlag genau einmal und sperrt die Aktion währenddessen", async () => {
    const fetchMock = renderDetail();
    const user = userEvent.setup();
    await user.click(await screen.findByTestId("button-continue-without-availability"));
    const section = (await screen.findByRole("heading", { name: "Neuer Terminvorschlag" })).closest("section");
    if (!section) throw new Error("proposal section missing");
    await user.click(within(section).getByRole("button", { name: "Bestätigen" }));

    await waitFor(() => expect(fetchMock.mock.calls.filter(([url, init]) =>
      String(url) === `/api/an/leistungsanfragen/${requestId}/change-proposals/${proposalId}/accept`
      && (init as RequestInit | undefined)?.method === "POST",
    )).toHaveLength(1));
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Neuer Terminvorschlag" })).not.toBeInTheDocument());
  });

  it("wartet bei einem bereits beantworteten Auftrag auf die Koordination vor dem ersten Aktionszustand", async () => {
    const delayedDetail = { ...detail, status: "RESPONDED" };
    const coordination = initialCoordination();
    let resolveCoordination: ((response: Response) => void) | undefined;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith(`/api/an/leistungsanfragen/${requestId}/details`)) return jsonResponse(delayedDetail);
      if (url.endsWith(`/api/an/leistungsanfragen/${requestId}/coordination`)) {
        return new Promise<Response>((resolve) => { resolveCoordination = resolve; });
      }
      if (url.endsWith(`/api/an/leistungsanfragen/${requestId}/resource-requirements`)) return jsonResponse([]);
      if (url.endsWith(`/api/an/leistungsanfragen/${requestId}/availability-checks/latest`)) return jsonResponse({}, 404);
      return jsonResponse([]);
    });
    vi.stubGlobal("fetch", fetchMock);
    window.history.pushState({}, "", `/leistungsanfragen/${requestId}`);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(<QueryClientProvider client={client}><Router base="/"><Route path="/leistungsanfragen/:requestId" component={LeistungsanfrageDetailPage} /></Router></QueryClientProvider>);

    await waitFor(() => expect(screen.queryByTestId("terminal-notice")).not.toBeInTheDocument());
    expect(screen.queryByTestId("schedule-change-response")).not.toBeInTheDocument();
    resolveCoordination?.(jsonResponse(coordination));
    await expect(screen.findByTestId("schedule-change-response")).resolves.toBeInTheDocument();
    expect(screen.queryByTestId("terminal-notice")).not.toBeInTheDocument();
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