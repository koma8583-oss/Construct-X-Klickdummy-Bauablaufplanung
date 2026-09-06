# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: campus-west-ag-an.spec.ts >> Campus-West terminology and proxy contract >> uses the German AG/AN terminology through the Replit proxy
- Location: e2e/tests/campus-west-ag-an.spec.ts:119:7

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByText(/auftraggeber/i).first()
Expected: visible
Timeout: 10000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 10000ms
  - waiting for getByText(/auftraggeber/i).first()

```

```yaml
- text: Construct-X Lean Construction Scheduling General Contractor
- button
- text: Baukoordination West GmbH
- navigation:
  - link "Übersicht":
    - /url: /
  - link "Projekte":
    - /url: /projects
  - link "Anfragen":
    - /url: /leistungsanfragen
  - link "Datenraum":
    - /url: /data-room
  - link "Hilfe":
    - /url: /hilfe
  - link "Einstellungen":
    - /url: /settings
- text: B Baukoordination West GmbH e2e-campus-west-c10094fb-6247-426b-9070-dd37a22f6160-ag@example.test
- button "Abmelden"
- button
- text: Construct-X General Contractor
- main:
  - main:
    - paragraph: Leitpult
    - heading "Übersicht" [level=1]
    - paragraph: Prozesslage und nächste Entscheidungen — gebündelt für Ihre laufenden Vorhaben.
    - text: Aktualisiert automatisch
    - region "Prozesskennzahlen":
      - text: Aufgaben offen 1
      - paragraph: Ihre nächsten Entscheidungen
      - text: Überfällig 0
      - paragraph: Alles im Zeitfenster
      - text: Einladungen offen 1
      - paragraph: Projektbeitritte ausstehend
      - text: Leistungsfreigaben ausstehend 0
      - paragraph: Für Partner noch nicht bestätigt
    - strong: "1"
    - text: aktive Projektzusammenarbeit · Kontext für Ihre Disposition
    - paragraph: Jetzt im Blick
    - heading "Nächste Aktionen" [level=2]
    - text: 4 offen
    - link "Änderungsvorschlag von Stahlbau Ruhr GmbH beantworten Offen Campus-West · Stahlbau Ruhr GmbH Campus-West • Stahlbau Ruhr GmbH":
      - /url: /leistungsanfragen/e2e-campus-west-c10094fb-6247-426b-9070-dd37a22f6160:request-BILATERAL
    - link "Daten für AN freigeben Offen Campus-West · Stahlbau Ruhr GmbH hat eine aktive Mitgliedschaft, aber noch keine Datenfreigabe. Campus-West • Stahlbau Ruhr GmbH":
      - /url: /projects/e2e-campus-west-c10094fb-6247-426b-9070-dd37a22f6160:project
    - link "Daten für AN freigeben Offen Campus-West · Elektro West GmbH hat eine aktive Mitgliedschaft, aber noch keine Datenfreigabe. Campus-West • Elektro West GmbH":
      - /url: /projects/e2e-campus-west-c10094fb-6247-426b-9070-dd37a22f6160:project
    - link "Daten für AN freigeben Offen Campus-West · TGA Technik GmbH hat eine aktive Mitgliedschaft, aber noch keine Datenfreigabe. Campus-West • TGA Technik GmbH":
      - /url: /projects/e2e-campus-west-c10094fb-6247-426b-9070-dd37a22f6160:project
    - paragraph: Verbindung
    - heading "Projektzusammenarbeit" [level=2]
    - paragraph: Campus-West
    - paragraph: Stahlbau Ruhr GmbH
    - text: Zusammenarbeit
    - paragraph: Projektbeitritt
    - paragraph: Mitgliedschaft aktiv
    - paragraph: Datenraum
    - paragraph: Noch keine Datenfreigabe
    - link "Daten für AN freigeben":
      - /url: /projects/e2e-campus-west-c10094fb-6247-426b-9070-dd37a22f6160:project
    - paragraph: Campus-West
    - paragraph: Elektro West GmbH
    - text: Zusammenarbeit
    - paragraph: Projektbeitritt
    - paragraph: Mitgliedschaft aktiv
    - paragraph: Datenraum
    - paragraph: Noch keine Datenfreigabe
    - link "Daten für AN freigeben":
      - /url: /projects/e2e-campus-west-c10094fb-6247-426b-9070-dd37a22f6160:project
    - paragraph: Campus-West
    - paragraph: TGA Technik GmbH
    - text: Zusammenarbeit
    - paragraph: Projektbeitritt
    - paragraph: Mitgliedschaft aktiv
    - paragraph: Datenraum
    - paragraph: Noch keine Datenfreigabe
    - link "Daten für AN freigeben":
      - /url: /projects/e2e-campus-west-c10094fb-6247-426b-9070-dd37a22f6160:project
    - paragraph: Campus-West
    - paragraph: Maler Süd GmbH
    - text: Zusammenarbeit
    - paragraph: Projektbeitritt
    - paragraph: Einladung offen
    - paragraph: Datenraum
    - paragraph: Noch keine Datenfreigabe
    - link "Zusammenarbeit öffnen":
      - /url: /projects/e2e-campus-west-c10094fb-6247-426b-9070-dd37a22f6160:project
    - paragraph: Planungshorizont
    - heading "Operativer Ausblick" [level=2]
    - link "Projekte öffnen":
      - /url: /projects
    - paragraph: Keine anstehenden Leistungen
    - paragraph: Im aktuellen Planungshorizont sind keine Termine hinterlegt.
- region "Notifications (F8)":
  - list
```

# Test source

```ts
  22  |       await expect(page.getByTestId(decision === "ACCEPT" ? "policy-consent-accepted" : "policy-consent-rejected")).toBeVisible();
  23  |     });
  24  |   }
  25  | 
  26  |   test("NOT_PERMITTED does not reveal actionable performance details", async ({ anContext, scenario }) => {
  27  |     const page = await anContext.newPage();
  28  |     await gotoAnRequest(page, scenario.requests.NOT_PERMITTED);
  29  |     await expect(page.getByTestId("policy-not-permitted")).toBeVisible();
  30  |     await expect(page.getByRole("button", { name: /bestätigen|annehmen/i })).toHaveCount(0);
  31  |   });
  32  | 
  33  |   test("seeded AN proposal, AG counterproposal, and AN acceptance stay bilateral", async ({ agContext, anContext, scenario }) => {
  34  |     const ag = await agContext.newPage();
  35  |     await ag.goto(`/leistungsanfragen/${scenario.bilateralRequestId}`);
  36  |     await expect(ag.getByText("Offener Vorschlag", { exact: true })).toBeVisible();
  37  |     await ag.getByLabel("Beginn").fill("2027-05-13");
  38  |     await ag.getByLabel("Ende").fill("2027-05-17");
  39  |     const [counterResponse] = await Promise.all([
  40  |       ag.waitForResponse((response) => response.url().includes("/change-proposals/") && response.url().endsWith("/counter")),
  41  |       ag.getByRole("button", { name: /gegenvorschlag senden/i }).click(),
  42  |     ]);
  43  |     expect(counterResponse.status(), await counterResponse.text()).toBe(201);
  44  |     const an = await anContext.newPage();
  45  |     await an.goto(`/an/leistungsanfragen/${scenario.bilateralRequestId}`);
  46  |     await expect(an.getByRole("heading", { name: /rückmeldung senden/i, level: 1 })).toBeVisible();
  47  |     await an.getByRole("button", { name: /termin bestätigen/i }).click();
  48  |     const [firstResponse, responseRequest] = await Promise.all([
  49  |       an.waitForResponse((response) => response.url().includes("/responses") && response.request().method() === "POST"),
  50  |       an.waitForRequest((request) => request.url().includes("/responses") && request.method() === "POST"),
  51  |       an.getByRole("button", { name: "Rückmeldung senden", exact: true }).click(),
  52  |     ]);
  53  |     expect(firstResponse.status(), await firstResponse.text()).toBe(201);
  54  |     const retry = await an.request.post(responseRequest.url(), { data: responseRequest.postDataJSON() });
  55  |     expect(retry.status(), await retry.text()).toBe(200);
  56  |     expect((await retry.json()).responseId).toBe((await firstResponse.json()).responseId);
  57  |   });
  58  | 
  59  |   test("multi-service / multi-AN assignments remain separately visible", async ({ agContext, scenario }) => {
  60  |     const page = await agContext.newPage();
  61  |     await page.goto("/leistungsanfragen");
  62  |     await expect(page.getByRole("button", { name: /L-301 Campus-West/ })).toHaveCount(2);
  63  |     await expect(page.getByRole("button", { name: /L-401 Campus-West/ })).toHaveCount(2);
  64  |     await expect(page.getByText(/Campus-West/i).first()).toBeVisible();
  65  |   });
  66  | 
  67  |   test("a multi-AN resource release partially succeeds: AN1 coordinates while AN2 is blocked", async ({ anContext, an2Context, scenario }) => {
  68  |     const [feasible, blocked] = await Promise.all([
  69  |       anContext.request.post(`/api/an/takt-requests/${scenario.requests.WITHIN_BASELINE}/availability-checks`),
  70  |       an2Context.request.post(`/api/an/takt-requests/${scenario.requests.NOT_PERMITTED}/availability-checks`),
  71  |     ]);
  72  |     expect(feasible.status(), await feasible.text()).toBe(201);
  73  |     expect((await feasible.json()).publicResultPayload.recommendedDecision).toBe("ACCEPTED");
  74  |     expect(blocked.status(), await blocked.text()).toBe(409);
  75  |     expect((await blocked.json()).error).toMatch(/POLICY|NOT_PERMITTED/i);
  76  |   });
  77  | 
  78  |   test("AN1 cannot cross-read AN2/AN3 policies, snapshots, resources, or schedules", async ({ anContext, scenario }) => {
  79  |     const paths = [
  80  |       `/api/an/takt-requests/${scenario.requests.NOT_PERMITTED}/snapshot`,
  81  |       `/api/an/leistungsanfragen/${scenario.boundaryRequestIds.an3Expiring}/details`,
  82  |       `/api/an/takt-requests/${scenario.requests.NOT_PERMITTED}/resource-requirements`,
  83  |       `/api/an/leistungsanfragen/${scenario.requests.NOT_PERMITTED}/coordination`,
  84  |       `/api/an/nu/resource-types/${scenario.resourceTypeIds[1]}`,
  85  |     ];
  86  |     for (const path of paths) {
  87  |       const response = await anContext.request.get(path);
  88  |       expect([403, 404], `${path}: ${await response.text()}`).toContain(response.status());
  89  |     }
  90  | 
  91  |     const resources = await anContext.request.get("/api/an/resources");
  92  |     expect(resources.status(), await resources.text()).toBe(200);
  93  |     expect((await resources.json()).every((resource: { id: string }) => resource.id === scenario.resourceIds[0])).toBe(true);
  94  |   });
  95  | 
  96  |   test("AN3 exposes the validity boundary and AN4 joins before rejecting its child policy", async ({ an3Context, an4Context, scenario }) => {
  97  |     const an3Details = await an3Context.request.get(`/api/an/takt-requests/${scenario.boundaryRequestIds.an3Expiring}/details`);
  98  |     expect(an3Details.status(), await an3Details.text()).toBe(200);
  99  |     expect((await an3Details.json()).effectivePolicy.validUntil).toBe("2027-06-30T23:59:59.000Z");
  100 | 
  101 |     const invitations = await an4Context.request.get("/api/an/project-invitations");
  102 |     expect(invitations.status(), await invitations.text()).toBe(200);
  103 |     const invitation = (await invitations.json()).find((row: { id: string; receiverAnOrgId: string; status: string }) => row.status === "PENDING");
  104 |     expect(invitation).toBeTruthy();
  105 |     const joined = await an4Context.request.post(`/api/an/project-invitations/${invitation.id}/accept`, {
  106 |       data: { policyAccepted: true },
  107 |     });
  108 |     expect(joined.status(), await joined.text()).toBe(200);
  109 | 
  110 |     const page = await an4Context.newPage();
  111 |     await gotoAnRequest(page, scenario.boundaryRequestIds.an4ChildReject);
  112 |     await expect(page.getByTestId("policy-consent-panel")).toBeVisible();
  113 |     await page.getByTestId("button-reject-policy").click();
  114 |     await expect(page.getByTestId("policy-consent-rejected")).toBeVisible();
  115 |   });
  116 | });
  117 | 
  118 | test.describe("Campus-West terminology and proxy contract", () => {
  119 |   test("uses the German AG/AN terminology through the Replit proxy", async ({ agContext, anContext }) => {
  120 |     const [ag, an] = await Promise.all([agContext.newPage(), anContext.newPage()]);
  121 |     await Promise.all([ag.goto("/"), an.goto("/an/")]);
> 122 |     await expect(ag.getByText(/auftraggeber/i).first()).toBeVisible();
      |                                                         ^ Error: expect(locator).toBeVisible() failed
  123 |     await expect(an.getByText(/nachunternehmen/i).first()).toBeVisible();
  124 |     const forbiddenLegacyTerms = /\b(?:Takt|Takte|Taktfenster|Taktvorschlag|TaktKoord)\b/i;
  125 |     expect(await ag.locator("body").innerText()).not.toMatch(forbiddenLegacyTerms);
  126 |     expect(await an.locator("body").innerText()).not.toMatch(forbiddenLegacyTerms);
  127 |   });
  128 | });
```