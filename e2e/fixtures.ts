import { expect, request as apiRequest, test as base, type APIRequestContext, type BrowserContext } from "@playwright/test";
import {
  cleanupCampusWest,
  restrictProjectAgreementPurposes,
  seedCampusWest,
  type Seed,
} from "./campus-west-seed";

export type PolicyClass = "WITHIN_BASELINE" | "REQUIRES_CONSENT" | "NOT_PERMITTED";
export type Scenario = {
  runId: string;
  ag: { email: string; password: string };
  an: Array<{ email: string; password: string }>;
  requests: Record<PolicyClass, string>;
  consentDeltaClass: PolicyClass;
  notPermittedAttempt: {
    status: number;
    code: string;
    requestCountBefore: number;
    requestCountAfter: number;
    projectionCountBefore: number;
    projectionCountAfter: number;
  };
  bilateralRequestId: string;
  bilateralProposalId: string;
  multiRequestIds: string[];
};

type Fixtures = {
  scenario: Seed;
  agContext: BrowserContext;
  anContext: BrowserContext;
  an2Context: BrowserContext;
  an3Context: BrowserContext;
  an4Context: BrowserContext;
  agApi: APIRequestContext;
  anApi: APIRequestContext;
  an2Api: APIRequestContext;
  an3Api: APIRequestContext;
  an4Api: APIRequestContext;
};

const baseUrl = () => process.env.E2E_BASE_URL ?? "http://localhost:80";
const accessTokens = new WeakMap<BrowserContext, string>();

async function signIn(context: BrowserContext, appPath: "/" | "/an/", account: Scenario["ag"]): Promise<void> {
  const page = await context.newPage();
  await page.goto(new URL(`${appPath}login`, baseUrl()).toString());
  await page.getByLabel(/e-mail|email/i).fill(account.email);
  await page.getByLabel(/passwort|password/i).fill(account.password);
  const loginResponse = page.waitForResponse((response) =>
    response.request().method() === "POST" && response.url().includes("/auth-service/login"),
  );
  await page.getByRole("button", { name: /anmelden|log in/i }).click();
  const { accessToken } = await (await loginResponse).json() as { accessToken?: unknown };
  if (typeof accessToken !== "string" || !accessToken) {
    throw new Error("Login did not return an access token");
  }
  accessTokens.set(context, accessToken);
  await expect(page).not.toHaveURL(/\/login/);
  await page.close();
}

async function authenticatedApi(
  context: BrowserContext,
): Promise<APIRequestContext> {
  const accessToken = accessTokens.get(context);
  if (!accessToken) throw new Error("No access token is available for the browser context");
  return apiRequest.newContext({
    baseURL: baseUrl(),
    extraHTTPHeaders: { Authorization: `Bearer ${accessToken}` },
  });
}

async function authenticatedSeedApi(account: { email: string; password: string }): Promise<APIRequestContext> {
  const anonymous = await apiRequest.newContext({ baseURL: baseUrl() });
  const login = await anonymous.post("/auth-service/login", {
    data: { email: account.email, password: account.password },
  });
  if (!login.ok()) {
    throw new Error(`Seed login failed (${login.status()}): ${await login.text()}`);
  }
  const body = await login.json() as { accessToken?: unknown };
  await anonymous.dispose();
  if (typeof body.accessToken !== "string" || !body.accessToken) {
    throw new Error("Seed login did not return an access token");
  }
  return apiRequest.newContext({
    baseURL: baseUrl(),
    extraHTTPHeaders: { Authorization: `Bearer ${body.accessToken}` },
  });
}

async function requireOk(response: Awaited<ReturnType<APIRequestContext["get"]>> | Awaited<ReturnType<APIRequestContext["post"]>>, label: string): Promise<any> {
  const text = await response.text();
  if (!response.ok()) throw new Error(`${label} failed (${response.status()}): ${text}`);
  return text ? JSON.parse(text) : {};
}

async function createAndSendRequest(
  agApi: APIRequestContext,
  seed: Seed,
  parentByAn: Map<string, { id: string; version: number }>,
  input: { key: string; serviceIndex: number; anIndex: number; purpose?: string; selectedFields?: string[] },
): Promise<string> {
  const parent = parentByAn.get(seed.anOrgIds[input.anIndex]);
  if (!parent) throw new Error(`No active project agreement for AN${input.anIndex + 1}`);
  const created = await requireOk(await agApi.post("/api/takt-requests", {
    data: {
      taktId: seed.serviceIds[input.serviceIndex],
      nuOrgId: seed.anOrgIds[input.anIndex],
      responseRequiredBy: "2027-04-30T17:00:00.000Z",
      purpose: input.purpose ?? "LEISTUNGSKOORDINATION",
      selectedFields: input.selectedFields ?? ["workPackage", "plannedTimeWindow", "resourceRequirements"],
      parentPolicyId: parent.id,
      parentPolicyVersion: parent.version,
    },
  }), `create ${input.key}`);
  const requestId = String(created.id);
  await requireOk(await agApi.post(`/api/takt-requests/${requestId}/send`, {
    data: {},
  }), `send ${input.key}`);
  return requestId;
}

type ScenarioMode = "within" | "consent" | "denied" | "full";

async function prepareCampusWest(seed: Seed, mode: ScenarioMode): Promise<void> {
  const agApi = await authenticatedSeedApi(seed.ag);
  const anApis = await Promise.all(seed.an.map(authenticatedSeedApi));
  try {
    const participants = await requireOk(await agApi.get(
      `/api/dataspace/participants?organizationType=AN&projectId=${encodeURIComponent(seed.projectId)}`,
    ), "list Dataspace participants") as Array<{ localOrgId?: string; participantId: string }>;
    const participantIds = participants
      .filter((participant) => seed.anOrgIds.includes(String(participant.localOrgId)))
      .map((participant) => participant.participantId);
    if (participantIds.length !== seed.anOrgIds.length) {
      throw new Error(`Expected ${seed.anOrgIds.length} prepared AN participants, found ${participantIds.length}`);
    }
    await requireOk(await agApi.post(`/api/projects/${seed.projectId}/invitation-packages`, {
      data: {
        participantIds,
        policyTemplateId: "PROJECT_MEMBERSHIP",
        title: "Projektaufnahme – Campus-West",
        invitationMessage: "Bitte prüfen Sie die Projektaufnahme.",
        validUntil: "2027-06-30T23:59:59.000Z",
        idempotencyKey: `${seed.runId.slice(-12)}-membership`,
      },
    }), "send project invitations");

    // Three ANs accept through the real invitation endpoint. AN4 remains
    // pending so the browser test can perform the acceptance UI flow.
    for (const [index, api] of anApis.entries()) {
      if (index === 3) continue;
      const invitations = await requireOk(await api.get("/api/an/project-invitations"), `list AN${index + 1} invitations`) as Array<{ id: string; projectReference?: string; status: string }>;
      const invitation = invitations.find((row) => row.projectReference === seed.projectId && row.status === "PENDING");
      if (!invitation) throw new Error(`No pending Campus-West invitation for AN${index + 1}`);
      await requireOk(await api.post(`/api/an/project-invitations/${invitation.id}/accept`, {
        data: { policyAccepted: true },
      }), `accept AN${index + 1} project invitation`);
    }

    const memberships = await requireOk(await agApi.get(`/api/projects/${seed.projectId}/memberships`), "read accepted memberships") as Array<{
      anOrgId: string;
      status: string;
      projectAgreementPolicyId?: string | null;
      projectAgreement?: { version?: number | null } | null;
    }>;
    const active = memberships.filter((membership) =>
      membership.status === "ACTIVE" && membership.projectAgreementPolicyId,
    );
    const agreementDetails = new Map<string, { id: string; version: number }>();
    for (const membership of active) {
      agreementDetails.set(membership.anOrgId, {
        id: String(membership.projectAgreementPolicyId),
        version: Number(membership.projectAgreement?.version ?? 1),
      });
    }

    if (mode === "within") {
      seed.requests.WITHIN_BASELINE = await createAndSendRequest(agApi, seed, agreementDetails, {
        key: "WITHIN_BASELINE", serviceIndex: 0, anIndex: 0,
      });
      return;
    }

    if (mode === "consent") {
      const consent = await createAndSendRequest(agApi, seed, agreementDetails, {
        key: "REQUIRES_CONSENT", serviceIndex: 1, anIndex: 0, purpose: "RAHMENTERMINE",
        selectedFields: ["workPackage", "plannedTimeWindow"],
      });
      const consentDetails = await requireOk(
        await anApis[0].get(`/api/an/takt-requests/${consent}/details`),
        "read consent policy classification",
      );
      const consentDeltaClass =
        consentDetails.effectivePolicy?.deltaClass ?? consentDetails.policyDeltaClass;
      if (consentDeltaClass !== "REQUIRES_CONSENT") {
        throw new Error(`Expected REQUIRES_CONSENT, received ${String(consentDeltaClass)}`);
      }
      seed.requests.REQUIRES_CONSENT = consent;
      seed.consentDeltaClass = consentDeltaClass;
      return;
    }

    if (mode === "denied") {
      const parent = agreementDetails.get(seed.anOrgIds[0]);
      if (!parent) throw new Error("No active project agreement for AN1");
      await restrictProjectAgreementPurposes(parent.id, ["LEISTUNGSKOORDINATION"]);
      const requestsBeforeDenied = await requireOk(
        await agApi.get("/api/takt-requests"),
        "list requests before forbidden attempt",
      ) as unknown[];
      const projectionsBeforeDenied = await requireOk(
        await anApis[0].get("/api/an/leistungsanfragen"),
        "list projections before forbidden attempt",
      ) as unknown[];
      const denied = await agApi.post("/api/takt-requests", {
        data: {
          taktId: seed.serviceIds[2],
          nuOrgId: seed.anOrgIds[0],
          responseRequiredBy: "2027-04-30T17:00:00.000Z",
          purpose: "RAHMENTERMINE",
          selectedFields: ["workPackage", "plannedTimeWindow"],
          parentPolicyId: parent.id,
          parentPolicyVersion: parent.version,
        },
      });
      const deniedBody = await denied.json() as { error?: string; code?: string };
      const requestsAfterDenied = await requireOk(
        await agApi.get("/api/takt-requests"),
        "list requests after forbidden attempt",
      ) as unknown[];
      const projectionsAfterDenied = await requireOk(
        await anApis[0].get("/api/an/leistungsanfragen"),
        "list projections after forbidden attempt",
      ) as unknown[];
      if (denied.status() !== 409 || (deniedBody.code ?? deniedBody.error) !== "POLICY_NOT_PERMITTED") {
        throw new Error(`Expected POLICY_NOT_PERMITTED (409), received ${denied.status()}: ${JSON.stringify(deniedBody)}`);
      }
      if (
        requestsAfterDenied.length !== requestsBeforeDenied.length ||
        projectionsAfterDenied.length !== projectionsBeforeDenied.length
      ) {
        throw new Error("Forbidden policy attempt created a request or AN projection");
      }
      seed.notPermittedAttempt = {
        status: denied.status(),
        code: deniedBody.code ?? deniedBody.error ?? "",
        requestCountBefore: requestsBeforeDenied.length,
        requestCountAfter: requestsAfterDenied.length,
        projectionCountBefore: projectionsBeforeDenied.length,
        projectionCountAfter: projectionsAfterDenied.length,
      };
      seed.requests.NOT_PERMITTED = "";
      return;
    }

    const within = await createAndSendRequest(agApi, seed, agreementDetails, {
      key: "WITHIN_BASELINE", serviceIndex: 0, anIndex: 0,
    });
    const consent = await createAndSendRequest(agApi, seed, agreementDetails, {
      key: "REQUIRES_CONSENT", serviceIndex: 1, anIndex: 0, purpose: "RAHMENTERMINE",
      selectedFields: ["workPackage", "plannedTimeWindow"],
    });
    const consentDetails = await requireOk(
      await anApis[0].get(`/api/an/takt-requests/${consent}/details`),
      "read full-scenario consent policy classification",
    );
    const consentDeltaClass =
      consentDetails.effectivePolicy?.deltaClass ?? consentDetails.policyDeltaClass;
    if (consentDeltaClass !== "REQUIRES_CONSENT") {
      throw new Error(`Expected REQUIRES_CONSENT, received ${String(consentDeltaClass)}`);
    }
    const bilateral = await createAndSendRequest(agApi, seed, agreementDetails, {
      key: "BILATERAL", serviceIndex: 3, anIndex: 0, purpose: "RAHMENTERMINE",
      selectedFields: ["workPackage", "plannedTimeWindow"],
    });
    const multiOne = await createAndSendRequest(agApi, seed, agreementDetails, {
      key: "MULTI_1", serviceIndex: 2, anIndex: 1,
    });
    const multiTwo = await createAndSendRequest(agApi, seed, agreementDetails, {
      key: "MULTI_2", serviceIndex: 3, anIndex: 2,
    });
    const expiring = await createAndSendRequest(agApi, seed, agreementDetails, {
      key: "AN3_EXPIRING", serviceIndex: 1, anIndex: 2,
    });

    seed.requests.WITHIN_BASELINE = within;
    seed.requests.REQUIRES_CONSENT = consent;
    seed.consentDeltaClass = consentDeltaClass;
    seed.bilateralRequestId = bilateral;
    seed.multiRequestIds = [multiOne, multiTwo];
    seed.boundaryRequestIds.an3Expiring = expiring;
    seed.assignments = [
      { requestId: within, anOrgId: seed.anOrgIds[0], serviceId: seed.serviceIds[0] },
      { requestId: consent, anOrgId: seed.anOrgIds[0], serviceId: seed.serviceIds[1] },
      { requestId: bilateral, anOrgId: seed.anOrgIds[0], serviceId: seed.serviceIds[3] },
      { requestId: multiOne, anOrgId: seed.anOrgIds[1], serviceId: seed.serviceIds[2] },
      { requestId: multiTwo, anOrgId: seed.anOrgIds[2], serviceId: seed.serviceIds[3] },
      { requestId: expiring, anOrgId: seed.anOrgIds[2], serviceId: seed.serviceIds[1] },
    ];

    // Complete the first bilateral request through the response API, then
    // create an open AN schedule proposal that the AG browser resolves later.
    await requireOk(await anApis[0].post(`/api/an/takt-requests/${bilateral}/policy-consent`, {
      data: { decision: "ACCEPT" },
    }), "accept bilateral schedule policy");
    const bilateralResponse = await requireOk(await anApis[0].post(`/api/an/takt-requests/${bilateral}/responses`, {
      data: { decision: "ACCEPTED", acceptedTimeWindow: { start: "2027-05-10T00:00:00.000Z", end: "2027-05-14T23:59:59.000Z" } },
    }), "accept bilateral service request");
    if (String(bilateralResponse.taktRequestId) !== bilateral) {
      throw new Error(`Bilateral response addressed ${String(bilateralResponse.taktRequestId)} instead of ${bilateral}`);
    }
    const bilateralDetail = await requireOk(
      await agApi.get(`/api/takt-requests/${bilateral}`),
      "read bilateral response postcondition",
    );
    if (!bilateralDetail.response) {
      throw new Error(`Bilateral response was not projected to AG: ${JSON.stringify(bilateralDetail)}`);
    }
    await requireOk(await agApi.post(`/api/takt-requests/${bilateral}/gu-decisions`, {
      data: { decisionType: "CONFIRM_ACCEPTED", comment: "Campus-West Ausgangstermin bestätigt" },
    }), "confirm bilateral service request");
    const anCoordination = await requireOk(
      await anApis[0].get(`/api/an/takt-requests/${bilateral}/coordination`),
      "read AN bilateral coordination",
    );
    if (!anCoordination.currentAgreement) {
      throw new Error(`AN did not receive the confirmed agreement: ${JSON.stringify(anCoordination)}`);
    }
    const proposal = await requireOk(await anApis[0].post(`/api/an/takt-requests/${bilateral}/change-proposals`, {
      data: {
        start: "2027-05-12T08:00:00.000Z",
        end: "2027-05-16T17:00:00.000Z",
        comment: "Campus-West Terminverschiebung",
      },
    }), "create bilateral schedule proposal");
    seed.bilateralProposalId = String(proposal.id ?? proposal.proposalId);
  } finally {
    await Promise.all([agApi.dispose(), ...anApis.map((api) => api.dispose())]);
  }
}

export const test = base.extend<Fixtures>({
  scenario: [async ({}, use, testInfo) => {
    const value = await seedCampusWest();
    const mode: ScenarioMode = testInfo.title.includes("WITHIN_BASELINE")
      ? "within"
      : testInfo.title.includes("REQUIRES_CONSENT")
        ? "consent"
        : testInfo.title.includes("NOT_PERMITTED")
          ? "denied"
          : "full";
    await prepareCampusWest(value, mode);
    try {
      await use(value);
    } finally {
      await cleanupCampusWest(value as Seed);
    }
  }, { scope: "test" }],
  agContext: async ({ browser, scenario }, use, testInfo) => {
    const viewport = testInfo.project.use.viewport as { width: number; height: number } | undefined;
    const context = await browser.newContext({ baseURL: baseUrl(), viewport });
    await signIn(context, "/", scenario.ag);
    await use(context);
    await context.close();
  },
  anContext: async ({ browser, scenario }, use, testInfo) => {
    const viewport = testInfo.project.use.viewport as { width: number; height: number } | undefined;
    const context = await browser.newContext({ baseURL: baseUrl(), viewport });
    await signIn(context, "/an/", scenario.an[0]);
    await use(context);
    await context.close();
  },
  an2Context: async ({ browser, scenario }, use, testInfo) => {
    const viewport = testInfo.project.use.viewport as { width: number; height: number } | undefined;
    const context = await browser.newContext({ baseURL: baseUrl(), viewport });
    await signIn(context, "/an/", scenario.an[1]);
    await use(context);
    await context.close();
  },
  an3Context: async ({ browser, scenario }, use, testInfo) => {
    const viewport = testInfo.project.use.viewport as { width: number; height: number } | undefined;
    const context = await browser.newContext({ baseURL: baseUrl(), viewport });
    await signIn(context, "/an/", scenario.an[2]);
    await use(context);
    await context.close();
  },
  an4Context: async ({ browser, scenario }, use, testInfo) => {
    const viewport = testInfo.project.use.viewport as { width: number; height: number } | undefined;
    const context = await browser.newContext({ baseURL: baseUrl(), viewport });
    await signIn(context, "/an/", scenario.an[3]);
    await use(context);
    await context.close();
  },
  agApi: async ({ agContext }, use) => {
    const api = await authenticatedApi(agContext);
    await use(api);
    await api.dispose();
  },
  anApi: async ({ anContext }, use) => {
    const api = await authenticatedApi(anContext);
    await use(api);
    await api.dispose();
  },
  an2Api: async ({ an2Context }, use) => {
    const api = await authenticatedApi(an2Context);
    await use(api);
    await api.dispose();
  },
  an3Api: async ({ an3Context }, use) => {
    const api = await authenticatedApi(an3Context);
    await use(api);
    await api.dispose();
  },
  an4Api: async ({ an4Context }, use) => {
    const api = await authenticatedApi(an4Context);
    await use(api);
    await api.dispose();
  },
});

export { expect };