import { expect, test } from "../fixtures";

async function gotoAnRequest(page: import("@playwright/test").Page, requestId: string) {
  await page.goto(`/an/leistungsanfragen/${requestId}`);
  await expect(page.getByRole("heading", { name: /anfrage prüfen/i, level: 1 })).toBeVisible();
}

test.describe("Campus-West · AG/AN policy coordination", () => {
  test("WITHIN_BASELINE exposes details without a second consent", async ({ anContext, scenario }) => {
    const page = await anContext.newPage();
    await gotoAnRequest(page, scenario.requests.WITHIN_BASELINE);
    await expect(page.getByTestId("request-overview")).toBeVisible();
    await expect(page.getByTestId("overview-service")).toContainText("L-101");
  });

  for (const decision of ["ACCEPT", "REJECT"] as const) {
    test(`REQUIRES_CONSENT ${decision === "ACCEPT" ? "Accept" : "Reject"} is explicit`, async ({ anContext, scenario }) => {
      const page = await anContext.newPage();
      await gotoAnRequest(page, scenario.requests.REQUIRES_CONSENT);
      await expect(page.getByTestId("policy-consent-panel")).toBeVisible();
      await page.getByTestId(decision === "ACCEPT" ? "button-accept-policy" : "button-reject-policy").click();
      await expect(page.getByTestId(decision === "ACCEPT" ? "policy-consent-accepted" : "policy-consent-rejected")).toBeVisible();
    });
  }

  test("NOT_PERMITTED does not reveal actionable performance details", async ({ anContext, scenario }) => {
    const page = await anContext.newPage();
    await gotoAnRequest(page, scenario.requests.NOT_PERMITTED);
    await expect(page.getByTestId("policy-not-permitted")).toBeVisible();
    await expect(page.getByRole("button", { name: /bestätigen|annehmen/i })).toHaveCount(0);
  });

  test("seeded AN proposal, AG counterproposal, and AN acceptance stay bilateral", async ({ agContext, anContext, scenario }) => {
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
    const an = await anContext.newPage();
    await an.goto(`/an/leistungsanfragen/${scenario.bilateralRequestId}`);
    await expect(an.getByRole("heading", { name: /rückmeldung senden/i, level: 1 })).toBeVisible();
    await an.getByRole("button", { name: /termin bestätigen/i }).click();
    const [firstResponse, responseRequest] = await Promise.all([
      an.waitForResponse((response) => response.url().includes("/responses") && response.request().method() === "POST"),
      an.waitForRequest((request) => request.url().includes("/responses") && request.method() === "POST"),
      an.getByRole("button", { name: "Rückmeldung senden", exact: true }).click(),
    ]);
    expect(firstResponse.status(), await firstResponse.text()).toBe(201);
    const retry = await an.request.post(responseRequest.url(), { data: responseRequest.postDataJSON() });
    expect(retry.status(), await retry.text()).toBe(200);
    expect((await retry.json()).responseId).toBe((await firstResponse.json()).responseId);
  });

  test("multi-service / multi-AN assignments remain separately visible", async ({ agContext, scenario }) => {
    const page = await agContext.newPage();
    await page.goto("/leistungsanfragen");
    await expect(page.getByRole("button", { name: /L-301 Campus-West/ })).toHaveCount(2);
    await expect(page.getByRole("button", { name: /L-401 Campus-West/ })).toHaveCount(2);
    await expect(page.getByText(/Campus-West/i).first()).toBeVisible();
  });

  test("a multi-AN resource release partially succeeds: AN1 coordinates while AN2 is blocked", async ({ anContext, an2Context, scenario }) => {
    const [feasible, blocked] = await Promise.all([
      anContext.request.post(`/api/an/takt-requests/${scenario.requests.WITHIN_BASELINE}/availability-checks`),
      an2Context.request.post(`/api/an/takt-requests/${scenario.requests.NOT_PERMITTED}/availability-checks`),
    ]);
    expect(feasible.status(), await feasible.text()).toBe(201);
    expect((await feasible.json()).publicResultPayload.recommendedDecision).toBe("ACCEPTED");
    expect(blocked.status(), await blocked.text()).toBe(409);
    expect((await blocked.json()).error).toMatch(/POLICY|NOT_PERMITTED/i);
  });

  test("AN1 cannot cross-read AN2/AN3 policies, snapshots, resources, or schedules", async ({ anContext, scenario }) => {
    const paths = [
      `/api/an/takt-requests/${scenario.requests.NOT_PERMITTED}/snapshot`,
      `/api/an/leistungsanfragen/${scenario.boundaryRequestIds.an3Expiring}/details`,
      `/api/an/takt-requests/${scenario.requests.NOT_PERMITTED}/resource-requirements`,
      `/api/an/leistungsanfragen/${scenario.requests.NOT_PERMITTED}/coordination`,
      `/api/an/nu/resource-types/${scenario.resourceTypeIds[1]}`,
    ];
    for (const path of paths) {
      const response = await anContext.request.get(path);
      expect([403, 404], `${path}: ${await response.text()}`).toContain(response.status());
    }

    const resources = await anContext.request.get("/api/an/resources");
    expect(resources.status(), await resources.text()).toBe(200);
    expect((await resources.json()).every((resource: { id: string }) => resource.id === scenario.resourceIds[0])).toBe(true);
  });

  test("AN3 exposes the validity boundary and AN4 joins before rejecting its child policy", async ({ an3Context, an4Context, scenario }) => {
    const an3Details = await an3Context.request.get(`/api/an/takt-requests/${scenario.boundaryRequestIds.an3Expiring}/details`);
    expect(an3Details.status(), await an3Details.text()).toBe(200);
    expect((await an3Details.json()).effectivePolicy.validUntil).toBe("2027-06-30T23:59:59.000Z");

    const invitations = await an4Context.request.get("/api/an/project-invitations");
    expect(invitations.status(), await invitations.text()).toBe(200);
    const invitation = (await invitations.json()).find((row: { id: string; receiverAnOrgId: string; status: string }) => row.status === "PENDING");
    expect(invitation).toBeTruthy();
    const joined = await an4Context.request.post(`/api/an/project-invitations/${invitation.id}/accept`, {
      data: { policyAccepted: true },
    });
    expect(joined.status(), await joined.text()).toBe(200);

    const page = await an4Context.newPage();
    await gotoAnRequest(page, scenario.boundaryRequestIds.an4ChildReject);
    await expect(page.getByTestId("policy-consent-panel")).toBeVisible();
    await page.getByTestId("button-reject-policy").click();
    await expect(page.getByTestId("policy-consent-rejected")).toBeVisible();
  });
});

test.describe("Campus-West terminology and proxy contract", () => {
  test("uses the German AG/AN terminology through the Replit proxy", async ({ agContext, anContext }) => {
    const [ag, an] = await Promise.all([agContext.newPage(), anContext.newPage()]);
    await Promise.all([ag.goto("/"), an.goto("/an/")]);
    await expect(ag.getByText(/auftraggeber/i).first()).toBeVisible();
    await expect(an.getByText(/nachunternehmen/i).first()).toBeVisible();
    const forbiddenLegacyTerms = /\b(?:Takt|Takte|Taktfenster|Taktvorschlag|TaktKoord)\b/i;
    expect(await ag.locator("body").innerText()).not.toMatch(forbiddenLegacyTerms);
    expect(await an.locator("body").innerText()).not.toMatch(forbiddenLegacyTerms);
  });
});