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
    await an.getByRole("button", { name: "Rückmeldung senden", exact: true }).click();
  });

  test("multi-service / multi-AN assignments remain separately visible", async ({ agContext, scenario }) => {
    const page = await agContext.newPage();
    await page.goto("/leistungsanfragen");
    await expect(page.getByRole("button", { name: /L-301 Campus-West/ })).toHaveCount(2);
    await expect(page.getByRole("button", { name: /L-401 Campus-West/ })).toHaveCount(2);
    await expect(page.getByText(/Campus-West/i).first()).toBeVisible();
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