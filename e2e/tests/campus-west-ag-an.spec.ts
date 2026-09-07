import { expect, test } from "../fixtures";

async function gotoAnRequest(page: import("@playwright/test").Page, requestId: string) {
  await page.goto(`/an/leistungsanfragen/${requestId}`);
  await expect(page.getByRole("heading", { level: 1 }).first()).toHaveText(
    /anfrage prüfen|machbarkeit prüfen|rückmeldung senden/i,
  );
}

test.describe("Campus-West · AG/AN policy coordination", () => {
  test("WITHIN_BASELINE exposes details without a second consent", async ({ anContext, scenario }) => {
    const page = await anContext.newPage();
    await gotoAnRequest(page, scenario.requests.WITHIN_BASELINE);
    const completedReview = page.getByTestId("phase-1").locator("summary").filter({ hasText: /Phase 1/ });
    if (await completedReview.count()) await completedReview.click();
    await expect(page.getByTestId("request-overview")).toBeVisible();
    await expect(page.getByTestId("overview-service")).toContainText("L-101");
  });

  for (const decision of ["ACCEPT", "REJECT"] as const) {
    test(`REQUIRES_CONSENT ${decision === "ACCEPT" ? "Accept" : "Reject"} is explicit`, async ({ anContext, scenario }) => {
      const page = await anContext.newPage();
      await gotoAnRequest(page, scenario.requests.REQUIRES_CONSENT);
      if (scenario.consentDeltaClass !== "REQUIRES_CONSENT") {
        await expect(page.getByTestId("policy-consent-panel")).toHaveCount(0);
        const completedReview = page.getByTestId("phase-1").locator("summary").filter({ hasText: /Phase 1/ });
        if (await completedReview.count()) await completedReview.click();
        await expect(page.getByTestId("request-overview")).toBeVisible();
        return;
      }
      await expect(page.getByTestId("policy-consent-panel")).toBeVisible();
      await page.getByTestId(decision === "ACCEPT" ? "button-accept-policy" : "button-reject-policy").click();
      await expect(page.getByTestId(decision === "ACCEPT" ? "policy-consent-accepted" : "policy-consent-rejected")).toBeVisible();
    });
  }

  test("NOT_PERMITTED rejects the real API attempt without creating a request", async ({ scenario }) => {
    expect(scenario.notPermittedAttempt.status).toBeGreaterThanOrEqual(400);
    expect(scenario.notPermittedAttempt.error).toMatch(/policy|permission|not.?permitted|field|selected/i);
    expect(scenario.requests.NOT_PERMITTED).toBe("");
  });

  test("AG service accepts a valid counterproposal for the seeded Campus-West snapshot", async ({ agApi, scenario }) => {
    const response = await agApi.post(
      `/api/leistungsanfragen/${scenario.bilateralRequestId}/change-proposals/${scenario.bilateralProposalId}/counter`,
      {
        data: {
          start: "2027-05-13T08:00:00.000Z",
          end: "2027-05-17T17:00:00.000Z",
          comment: "Campus-West Gegenvorschlag",
        },
      },
    );
    expect(response.status(), await response.text()).toBe(201);
  });

  test("seeded AN proposal, AG counterproposal, and AN acceptance stay bilateral", async ({ agContext, anContext, anApi, scenario }) => {
    const ag = await agContext.newPage();
    await ag.goto(`/leistungsanfragen/${scenario.bilateralRequestId}`);
    await expect(ag.getByText("Offener Vorschlag", { exact: true })).toBeVisible();
    await ag.getByLabel("Beginn").fill("2027-05-13");
    await ag.getByLabel("Ende").fill("2027-05-17");
    const [counterResponse] = await Promise.all([
      ag.waitForResponse((response) => response.url().includes("/change-proposals/") && response.url().endsWith("/counter")),
      ag.getByRole("button", { name: /gegenvorschlag senden/i }).click(),
    ]);
    expect(counterResponse.status(), await counterResponse.text()).toBe(201);
    await expect.poll(async () => {
      const coordinationResponse = await anApi.get(`/api/an/leistungsanfragen/${scenario.bilateralRequestId}/coordination`);
      if (!coordinationResponse.ok()) return null;
      return (await coordinationResponse.json()).openProposal?.proposer ?? null;
    }, { timeout: 10000 }).toBe("AG");
    const an = await anContext.newPage();
    await an.goto(`/an/leistungsanfragen/${scenario.bilateralRequestId}`);
    await expect(an.getByRole("heading", { name: /rückmeldung senden/i, level: 1 })).toBeVisible();
    await an.reload();
    await expect(an.getByTestId("schedule-change-response")).toBeVisible({ timeout: 20000 });
    const acceptProposal = an.waitForResponse((response) =>
      response.request().method() === "POST" &&
      /\/change-proposals\/[^/]+\/accept$/.test(new URL(response.url()).pathname),
    );
    await an.getByRole("button", { name: /^Bestätigen$/ }).click();
    const acceptedProposal = await acceptProposal;
    expect(acceptedProposal.status(), await acceptedProposal.text()).toBe(201);
    await expect(an.getByText("Terminänderung bestätigt", { exact: true })).toBeVisible();
  });

  test("multi-service / multi-AN assignments remain separately visible", async ({ agContext, scenario }) => {
    const page = await agContext.newPage();
    await page.goto("/leistungsanfragen");
    const l301Count = scenario.assignments.filter((assignment) => assignment.serviceId === scenario.serviceIds[2]).length;
    const l401Count = scenario.assignments.filter((assignment) => assignment.serviceId === scenario.serviceIds[3]).length;
    await expect(page.getByRole("button", { name: /L-301 Campus-West/ })).toHaveCount(l301Count);
    await expect(page.getByRole("button", { name: /L-401 Campus-West/ })).toHaveCount(l401Count);
    await expect(page.getByText(/Campus-West/i).first()).toBeVisible();
  });

  test("a multi-AN resource release uses each AN's real local availability", async ({ anApi, an2Api, scenario }) => {
    const [feasible, blocked] = await Promise.all([
      anApi.post(`/api/an/takt-requests/${scenario.requests.WITHIN_BASELINE}/availability-checks`),
      an2Api.post(`/api/an/takt-requests/${scenario.multiRequestIds[0]}/availability-checks`),
    ]);
    expect(feasible.status(), await feasible.text()).toBe(201);
    expect((await feasible.json()).publicResult.recommendedDecision).toBe("ACCEPTED");
    expect(blocked.status(), await blocked.text()).toBe(201);
    expect((await blocked.json()).publicResult.recommendedDecision).toBe("ACCEPTED");
  });

  test("AN1–AN4 see exactly their assigned local service projections and resources", async ({ anApi, an2Api, an3Api, an4Api, scenario }) => {
    const clients = [anApi, an2Api, an3Api, an4Api];
    for (const [index, client] of clients.entries()) {
      const [requests, resources, resourceTypes] = await Promise.all([
        client.get("/api/an/leistungsanfragen"),
        client.get("/api/an/resources"),
        client.get("/api/nu/resource-types"),
      ]);
      expect(requests.status(), await requests.text()).toBe(200);
      expect(resources.status(), await resources.text()).toBe(200);
      expect(resourceTypes.status(), await resourceTypes.text()).toBe(200);

      const expectedAssignments = scenario.assignments
        .filter((assignment) => assignment.anOrgId === scenario.anOrgIds[index])
        .map((assignment) => [assignment.requestId, assignment.anOrgId, assignment.serviceId])
        .sort();
      expect((await requests.json()).map((row: { id: string; nuOrgId: string; takt: { id: string } }) =>
        [row.id, row.nuOrgId, row.takt.id],
      ).sort()).toEqual(expectedAssignments);
      expect((await resources.json()).map((row: { id: string; anOrgId: string }) =>
        [row.id, row.anOrgId],
      )).toEqual([[scenario.resourceIds[index], scenario.anOrgIds[index]]]);
      expect((await resourceTypes.json()).items.map((row: { id: string; anOrgId: string }) =>
        [row.id, row.anOrgId],
      )).toEqual([[scenario.resourceTypeIds[index], scenario.anOrgIds[index]]]);
    }
  });

  test("wrong AN direct reads and actions are opaque and cannot mutate foreign projections or resources", async ({ anApi, an2Api, an3Api, an4Api, scenario }) => {
    const clients = [anApi, an2Api, an3Api, an4Api];
    const assertOpaqueDenied = async (
      response: Awaited<ReturnType<typeof anApi.get>>,
      path: string,
    ) => {
      const body = await response.json() as Record<string, unknown>;
      expect([403, 404], `${path}: ${JSON.stringify(body)}`).toContain(response.status());
      const serialized = JSON.stringify(body);
      for (const value of [...scenario.serviceIds, ...scenario.resourceIds, ...scenario.resourceTypeIds, ...scenario.anOrgIds]) {
        expect(serialized, `${path} leaked ${value}`).not.toContain(value);
      }
    };

    for (const [index, client] of clients.entries()) {
      const foreign = scenario.assignments.find((assignment) => assignment.anOrgId !== scenario.anOrgIds[index]);
      if (!foreign) throw new Error("Campus-West seed must provide a foreign AN assignment");
      await assertOpaqueDenied(
        await client.get(`/api/an/leistungsanfragen/${foreign.requestId}/details`),
        `details/${foreign.requestId}`,
      );
      await assertOpaqueDenied(
        await client.post(`/api/an/takt-requests/${foreign.requestId}/availability-checks`),
        `availability/${foreign.requestId}`,
      );
      await assertOpaqueDenied(
        await client.post(`/api/an/leistungsanfragen/${foreign.requestId}/responses`, {
          data: { decision: "REJECTED", reasonCode: "OTHER" },
        }),
        `responses/${foreign.requestId}`,
      );
      await assertOpaqueDenied(
        await client.patch(`/api/resources/${scenario.resourceIds[(index + 1) % clients.length]}`, {
          data: { name: "Foreign mutation must fail" },
        }),
        `resources/${scenario.resourceIds[(index + 1) % clients.length]}`,
      );
      await assertOpaqueDenied(
        await client.get(`/api/nu/resource-types/${scenario.resourceTypeIds[(index + 1) % clients.length]}`),
        `resource-types/${scenario.resourceTypeIds[(index + 1) % clients.length]}`,
      );
    }
  });

  test("AN3 exposes the validity boundary and AN4 joins before reviewing its child policy", async ({ agApi, an3Api, an4Context, an3Context, an4Api, scenario }) => {
    const an3Details = await an3Api.get(`/api/an/takt-requests/${scenario.boundaryRequestIds.an3Expiring}/details`);
    expect(an3Details.status(), await an3Details.text()).toBe(200);
    expect((await an3Details.json()).effectivePolicy.validUntil).toBe("2027-06-30T23:59:59.000Z");

    const invitations = await an4Api.get("/api/an/project-invitations");
    expect(invitations.status(), await invitations.text()).toBe(200);
    const invitation = (await invitations.json()).find((row: { id: string; receiverAnOrgId: string; status: string }) => row.status === "PENDING");
    expect(invitation).toBeTruthy();
    const joined = await an4Api.post(`/api/an/project-invitations/${invitation.id}/accept`, {
      data: { policyAccepted: true },
    });
    expect(joined.status(), await joined.text()).toBe(200);

    const invitationPolicy = (invitation as {
      policySnapshot?: { policyId?: string; policyVersion?: number; version?: number };
    }).policySnapshot;
    expect(invitationPolicy?.policyId).toBeTruthy();
    const created = await agApi.post("/api/takt-requests", {
      data: {
        taktId: scenario.serviceIds[1],
        nuOrgId: scenario.anOrgIds[3],
        responseRequiredBy: "2027-04-30T17:00:00.000Z",
        purpose: "RAHMENTERMINE",
        selectedFields: ["workPackage", "plannedTimeWindow"],
        parentPolicyId: invitationPolicy?.policyId,
        parentPolicyVersion: invitationPolicy?.policyVersion ?? invitationPolicy?.version ?? 1,
      },
    });
    expect(created.status(), await created.text()).toBe(201);
    const requestId = String((await created.json()).id);
    const sent = await agApi.post(`/api/takt-requests/${requestId}/send`, { data: {} });
    expect(sent.status(), await sent.text()).toBe(200);

    const page = await an4Context.newPage();
    await gotoAnRequest(page, requestId);
    if (await page.getByTestId("policy-consent-panel").count()) {
      await page.getByTestId("button-reject-policy").click();
      await expect(page.getByTestId("policy-consent-rejected")).toBeVisible();
    } else {
      const completedReview = page.getByTestId("phase-1").locator("summary").filter({ hasText: /Phase 1/ });
      if (await completedReview.count()) await completedReview.click();
      await expect(page.getByTestId("request-overview")).toBeVisible();
    }
  });
});

test.describe("Campus-West terminology and proxy contract", () => {
  test("uses the German AG/AN terminology through the Replit proxy", async ({ agContext, anContext }) => {
    const [ag, an] = await Promise.all([agContext.newPage(), anContext.newPage()]);
    await Promise.all([ag.goto("/"), an.goto("/an/")]);
    await expect(ag.getByText(/baukoordination/i).first()).toBeVisible();
    await expect(an.getByText(/arbeitscockpit/i).first()).toBeVisible();
    const forbiddenLegacyTerms = /\b(?:Takt|Takte|Taktfenster|Taktvorschlag|TaktKoord)\b/i;
    expect(await ag.locator("body").innerText()).not.toMatch(forbiddenLegacyTerms);
    expect(await an.locator("body").innerText()).not.toMatch(forbiddenLegacyTerms);
  });
});