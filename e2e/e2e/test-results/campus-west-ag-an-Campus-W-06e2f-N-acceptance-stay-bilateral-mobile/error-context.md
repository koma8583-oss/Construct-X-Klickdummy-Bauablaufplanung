# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: campus-west-ag-an.spec.ts >> Campus-West · AG/AN policy coordination >> seeded AN proposal, AG counterproposal, and AN acceptance stay bilateral
- Location: e2e/tests/campus-west-ag-an.spec.ts:33:7

# Error details

```
Error: {"error":"Snapshot resource requirement is incomplete"}

expect(received).toBe(expected) // Object.is equality

Expected: 201
Received: 500
```

# Page snapshot

```yaml
- generic [ref=e2]:
  - generic [ref=e3]:
    - generic [ref=e4]:
      - generic [ref=e5]:
        - generic [ref=e9]:
          - generic [ref=e10]: Construct-X Lean Construction Scheduling
          - generic [ref=e11]: General Contractor
        - button [ref=e12]
      - generic [ref=e16]: Baukoordination West GmbH
      - navigation [ref=e17]:
        - link "Übersicht" [ref=e18] [cursor=pointer]:
          - /url: /
        - link "Projekte" [ref=e27] [cursor=pointer]:
          - /url: /projects
        - link "Anfragen" [ref=e34] [cursor=pointer]:
          - /url: /leistungsanfragen
        - link "Datenraum" [ref=e41] [cursor=pointer]:
          - /url: /data-room
        - link "Hilfe" [ref=e48] [cursor=pointer]:
          - /url: /hilfe
        - link "Einstellungen" [ref=e55] [cursor=pointer]:
          - /url: /settings
      - generic [ref=e62]:
        - generic [ref=e63]:
          - generic [ref=e64]: B
          - generic [ref=e65]:
            - generic [ref=e66]: Baukoordination West GmbH
            - generic [ref=e67]: e2e-campus-west-ec92abd3-1376-47f1-bc08-3aa2d9892309-ag@example.test
        - button "Abmelden" [ref=e68]
    - generic [ref=e73]:
      - generic [ref=e74]:
        - button [ref=e75]
        - generic [ref=e77]:
          - generic [ref=e80]: Construct-X
          - generic [ref=e81]: General Contractor
      - main [ref=e82]:
        - generic [ref=e83]:
          - link "Zurück zur Übersicht" [ref=e84] [cursor=pointer]:
            - /url: /leistungsanfragen
          - generic [ref=e88]:
            - generic [ref=e89]:
              - heading "Leistungsanfrage" [level=1] [ref=e90]
              - generic [ref=e91]: e2e-campus-west-ec92abd3-1376-47f1-bc08-3aa2d9892309-BILATERAL
            - generic [ref=e92]:
              - 'generic "Anfragestatus: UNDER_REVIEW" [ref=e93]': In Prüfung
              - generic [ref=e94]: Nicht gesendet
              - generic [ref=e95]: Live
          - region "Aktuelle Aufgabe" [ref=e98]:
            - generic [ref=e103]:
              - paragraph [ref=e104]: Aktion erforderlich
              - heading "Terminänderung prüfen" [level=2] [ref=e105]
              - paragraph [ref=e106]: Die Gegenseite hat einen Änderungsvorschlag übermittelt.
              - button "Öffnen" [ref=e107]
          - generic [ref=e108]:
            - generic [ref=e109]: Leistungsanfrage
            - generic [ref=e114]:
              - generic [ref=e115]:
                - term [ref=e116]: Projekt
                - definition [ref=e117]:
                  - link "Campus-West" [ref=e118] [cursor=pointer]:
                    - /url: /projects/e2e-campus-west-ec92abd3-1376-47f1-bc08-3aa2d9892309:project
              - generic [ref=e119]:
                - term [ref=e120]: Leistung
                - definition [ref=e121]: L-401 Campus-West
              - generic [ref=e122]:
                - term [ref=e123]: Version
                - definition [ref=e124]: v1
              - generic [ref=e125]:
                - term [ref=e126]: Nachunternehmer
                - definition [ref=e127]: Stahlbau Ruhr GmbH
              - generic [ref=e128]:
                - term [ref=e129]: Antwortfrist
                - definition [ref=e130]: 30.04.2027 17:00
              - generic [ref=e131]:
                - term [ref=e132]: Anfragestatus
                - definition [ref=e133]:
                  - 'generic "Anfragestatus: UNDER_REVIEW" [ref=e134]': In Prüfung
              - generic [ref=e135]:
                - term [ref=e136]: Nachrichtenstatus
                - definition [ref=e137]:
                  - generic [ref=e138]: Nicht gesendet
            - group [ref=e139]:
              - generic "Alle Details der Leistungsanfrage" [ref=e140] [cursor=pointer]
            - group [ref=e141]:
              - generic "Ressourcenanforderungen" [ref=e142] [cursor=pointer]
          - generic [ref=e143]:
            - generic [ref=e144]: Abstimmung
            - generic [ref=e149]:
              - generic [ref=e150]:
                - generic [ref=e151]:
                  - generic [ref=e152]:
                    - heading "Neue Terminänderung vom Nachunternehmen" [level=2] [ref=e153]
                    - paragraph [ref=e154]: Die aktuelle Vereinbarung bleibt bestehen, bis beide Seiten den neuen Zeitraum bestätigt haben.
                  - generic [ref=e155]: Aktion erforderlich
                - generic [ref=e156]:
                  - generic [ref=e157]:
                    - paragraph [ref=e158]: Aktuelle Vereinbarung
                    - paragraph [ref=e159]: 10.05.2027 – 14.05.2027
                  - generic [ref=e160]:
                    - paragraph [ref=e161]: Offener Vorschlag
                    - paragraph [ref=e162]: 12.05.2027 – 16.05.2027
                    - paragraph [ref=e163]: Campus-West Terminverschiebung
                - generic [ref=e164]:
                  - generic [ref=e165]:
                    - text: Grund
                    - paragraph [ref=e166]: Terminliche Machbarkeit und Ressourcenplanung
                  - generic [ref=e167]:
                    - text: Auswirkungen
                    - paragraph [ref=e168]: Beginn +2 Tage, Ende +2 Tage. Abhängigkeiten und Ressourcen werden nach der Einigung neu geprüft.
                - paragraph [ref=e169]: "Delta: Beginn +2 Tage, Ende +2 Tage"
                - generic [ref=e170]:
                  - paragraph [ref=e171]: Verlauf
                  - generic [ref=e172]:
                    - generic [ref=e173]:
                      - generic [ref=e174]: REQUEST_CREATED
                      - generic [ref=e175]: 06.09.2026 06:58
                    - generic [ref=e176]:
                      - generic [ref=e177]: CHANGE_PROPOSAL_CREATED
                      - generic [ref=e178]: 06.09.2026 06:58
              - paragraph [ref=e179]: Noch keine Leistungsantwort eingegangen.
              - generic [ref=e180]:
                - generic [ref=e181]:
                  - heading "Zeitraum abstimmen" [level=3] [ref=e182]
                  - paragraph [ref=e183]: "Offener Vorschlag: 12.5.2027 – 16.5.2027"
                - generic [ref=e184]:
                  - button "Annehmen" [ref=e185]
                  - button "Ablehnen" [ref=e186]
                - generic [ref=e187]:
                  - generic [ref=e188]:
                    - text: Beginn
                    - textbox "Beginn" [ref=e189]: 2027-05-13
                  - generic [ref=e190]:
                    - text: Ende
                    - textbox "Ende" [ref=e191]: 2027-05-17
                  - textbox "Kommentar (optional)" [ref=e192]
                  - button "Gegenvorschlag senden" [ref=e193]
                - paragraph [ref=e194]: Snapshot resource requirement is incomplete
          - generic [ref=e196]:
            - generic [ref=e197]: Koordinationsstatus
            - generic [ref=e202]:
              - generic [ref=e203]:
                - paragraph [ref=e204]: Ausführungsbereitschaft
                - generic [ref=e205]:
                  - generic [ref=e206]:
                    - checkbox "Termin bestätigt" [ref=e207]
                    - text: Termin bestätigt
                  - generic [ref=e210]:
                    - checkbox "Arbeitsbereich bereit" [ref=e211]
                    - text: Arbeitsbereich bereit
                  - generic [ref=e214]:
                    - checkbox "Informationen vollständig" [ref=e215]
                    - text: Informationen vollständig
                  - generic [ref=e218]:
                    - checkbox "AG bereit" [ref=e219]
                    - text: AG bereit
                  - generic [ref=e222]:
                    - checkbox "AN bereit" [disabled] [ref=e223]
                    - text: AN bereit
                - paragraph [ref=e226]: Noch nicht ausführungsbereit
              - generic [ref=e227]:
                - generic [ref=e228]:
                  - paragraph [ref=e229]: Offene Risiken
                  - paragraph [ref=e232]: "0"
                - generic [ref=e233]:
                  - paragraph [ref=e234]: Offene Klärungen
                  - paragraph [ref=e238]: "0"
          - group [ref=e239]:
            - generic "Fristen und Erinnerungen" [ref=e240] [cursor=pointer]
          - generic [ref=e241]:
            - generic [ref=e242]: Verlauf
            - generic [ref=e252]:
              - generic [ref=e253]:
                - generic [ref=e254]: Leistungsanfrage e2e-campus-west-ec92abd3-1376-47f1-bc08-3aa2d9892309-BILATERAL
                - generic [ref=e255]: UNDER_REVIEW
                - link "Öffnen" [ref=e256] [cursor=pointer]:
                  - /url: /leistungsanfragen/e2e-campus-west-ec92abd3-1376-47f1-bc08-3aa2d9892309:request-BILATERAL
              - paragraph [ref=e259]: 06.09.2026 06:58
          - group [ref=e260]:
            - generic "Technische Details & Übertragung" [ref=e261] [cursor=pointer]
  - region "Notifications (F8)":
    - list
```

# Test source

```ts
  1   | import { expect, test } from "../fixtures";
  2   | 
  3   | async function gotoAnRequest(page: import("@playwright/test").Page, requestId: string) {
  4   |   await page.goto(`/an/leistungsanfragen/${requestId}`);
  5   |   await expect(page.getByRole("heading", { name: /anfrage prüfen/i, level: 1 })).toBeVisible();
  6   | }
  7   | 
  8   | test.describe("Campus-West · AG/AN policy coordination", () => {
  9   |   test("WITHIN_BASELINE exposes details without a second consent", async ({ anContext, scenario }) => {
  10  |     const page = await anContext.newPage();
  11  |     await gotoAnRequest(page, scenario.requests.WITHIN_BASELINE);
  12  |     await expect(page.getByTestId("request-overview")).toBeVisible();
  13  |     await expect(page.getByTestId("overview-service")).toContainText("L-101");
  14  |   });
  15  | 
  16  |   for (const decision of ["ACCEPT", "REJECT"] as const) {
  17  |     test(`REQUIRES_CONSENT ${decision === "ACCEPT" ? "Accept" : "Reject"} is explicit`, async ({ anContext, scenario }) => {
  18  |       const page = await anContext.newPage();
  19  |       await gotoAnRequest(page, scenario.requests.REQUIRES_CONSENT);
  20  |       await expect(page.getByTestId("policy-consent-panel")).toBeVisible();
  21  |       await page.getByTestId(decision === "ACCEPT" ? "button-accept-policy" : "button-reject-policy").click();
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
> 43  |     expect(counterResponse.status(), await counterResponse.text()).toBe(201);
      |                                                                    ^ Error: {"error":"Snapshot resource requirement is incomplete"}
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
  122 |     await expect(ag.getByText(/auftraggeber/i).first()).toBeVisible();
  123 |     await expect(an.getByText(/nachunternehmen/i).first()).toBeVisible();
  124 |     const forbiddenLegacyTerms = /\b(?:Takt|Takte|Taktfenster|Taktvorschlag|TaktKoord)\b/i;
  125 |     expect(await ag.locator("body").innerText()).not.toMatch(forbiddenLegacyTerms);
  126 |     expect(await an.locator("body").innerText()).not.toMatch(forbiddenLegacyTerms);
  127 |   });
  128 | });
```