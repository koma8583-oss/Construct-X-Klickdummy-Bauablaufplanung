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
        - button "Seitenleiste schließen" [ref=e12]
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
            - generic [ref=e67]: e2e-campus-west-9317ace4-6920-4405-aeda-604ff8819240-ag@example.test
        - button "Abmelden" [ref=e68]
    - main [ref=e74]:
      - generic [ref=e75]:
        - link "Zurück zur Übersicht" [ref=e76] [cursor=pointer]:
          - /url: /leistungsanfragen
        - generic [ref=e80]:
          - generic [ref=e81]:
            - heading "Leistungsanfrage" [level=1] [ref=e82]
            - generic [ref=e83]: e2e-campus-west-9317ace4-6920-4405-aeda-604ff8819240-BILATERAL
          - generic [ref=e84]:
            - 'generic "Anfragestatus: UNDER_REVIEW" [ref=e85]': In Prüfung
            - generic [ref=e86]: Nicht gesendet
            - generic [ref=e87]: Live
        - region "Aktuelle Aufgabe" [ref=e90]:
          - generic [ref=e95]:
            - paragraph [ref=e96]: Aktion erforderlich
            - heading "Terminänderung prüfen" [level=2] [ref=e97]
            - paragraph [ref=e98]: Die Gegenseite hat einen Änderungsvorschlag übermittelt.
            - button "Öffnen" [ref=e99]
        - generic [ref=e100]:
          - generic [ref=e101]: Leistungsanfrage
          - generic [ref=e106]:
            - generic [ref=e107]:
              - term [ref=e108]: Projekt
              - definition [ref=e109]:
                - link "Campus-West" [ref=e110] [cursor=pointer]:
                  - /url: /projects/e2e-campus-west-9317ace4-6920-4405-aeda-604ff8819240:project
            - generic [ref=e111]:
              - term [ref=e112]: Leistung
              - definition [ref=e113]: L-401 Campus-West
            - generic [ref=e114]:
              - term [ref=e115]: Version
              - definition [ref=e116]: v1
            - generic [ref=e117]:
              - term [ref=e118]: Nachunternehmer
              - definition [ref=e119]: Stahlbau Ruhr GmbH
            - generic [ref=e120]:
              - term [ref=e121]: Antwortfrist
              - definition [ref=e122]: 30.04.2027 17:00
            - generic [ref=e123]:
              - term [ref=e124]: Anfragestatus
              - definition [ref=e125]:
                - 'generic "Anfragestatus: UNDER_REVIEW" [ref=e126]': In Prüfung
            - generic [ref=e127]:
              - term [ref=e128]: Nachrichtenstatus
              - definition [ref=e129]:
                - generic [ref=e130]: Nicht gesendet
          - group [ref=e131]:
            - generic "Alle Details der Leistungsanfrage" [ref=e132] [cursor=pointer]
          - group [ref=e133]:
            - generic "Ressourcenanforderungen" [ref=e134] [cursor=pointer]
        - generic [ref=e135]:
          - generic [ref=e136]: Abstimmung
          - generic [ref=e141]:
            - generic [ref=e142]:
              - generic [ref=e143]:
                - generic [ref=e144]:
                  - heading "Neue Terminänderung vom Nachunternehmen" [level=2] [ref=e145]
                  - paragraph [ref=e146]: Die aktuelle Vereinbarung bleibt bestehen, bis beide Seiten den neuen Zeitraum bestätigt haben.
                - generic [ref=e147]: Aktion erforderlich
              - generic [ref=e148]:
                - generic [ref=e149]:
                  - paragraph [ref=e150]: Aktuelle Vereinbarung
                  - paragraph [ref=e151]: 10.05.2027 – 14.05.2027
                - generic [ref=e152]:
                  - paragraph [ref=e153]: Offener Vorschlag
                  - paragraph [ref=e154]: 12.05.2027 – 16.05.2027
                  - paragraph [ref=e155]: Campus-West Terminverschiebung
              - generic [ref=e156]:
                - generic [ref=e157]:
                  - text: Grund
                  - paragraph [ref=e158]: Terminliche Machbarkeit und Ressourcenplanung
                - generic [ref=e159]:
                  - text: Auswirkungen
                  - paragraph [ref=e160]: Beginn +2 Tage, Ende +2 Tage. Abhängigkeiten und Ressourcen werden nach der Einigung neu geprüft.
              - paragraph [ref=e161]: "Delta: Beginn +2 Tage, Ende +2 Tage"
              - generic [ref=e162]:
                - paragraph [ref=e163]: Verlauf
                - generic [ref=e164]:
                  - generic [ref=e165]:
                    - generic [ref=e166]: REQUEST_CREATED
                    - generic [ref=e167]: 06.09.2026 07:02
                  - generic [ref=e168]:
                    - generic [ref=e169]: CHANGE_PROPOSAL_CREATED
                    - generic [ref=e170]: 06.09.2026 07:02
            - paragraph [ref=e171]: Noch keine Leistungsantwort eingegangen.
            - generic [ref=e172]:
              - generic [ref=e173]:
                - heading "Zeitraum abstimmen" [level=3] [ref=e174]
                - paragraph [ref=e175]: "Offener Vorschlag: 12.5.2027 – 16.5.2027"
              - generic [ref=e176]:
                - button "Annehmen" [ref=e177]
                - button "Ablehnen" [ref=e178]
              - generic [ref=e179]:
                - generic [ref=e180]:
                  - text: Beginn
                  - textbox "Beginn" [ref=e181]: 2027-05-13
                - generic [ref=e182]:
                  - text: Ende
                  - textbox "Ende" [ref=e183]: 2027-05-17
                - textbox "Kommentar (optional)" [ref=e184]
                - button "Gegenvorschlag senden" [ref=e185]
              - paragraph [ref=e186]: Snapshot resource requirement is incomplete
        - generic [ref=e188]:
          - generic [ref=e189]: Koordinationsstatus
          - generic [ref=e194]:
            - generic [ref=e195]:
              - paragraph [ref=e196]: Ausführungsbereitschaft
              - generic [ref=e197]:
                - generic [ref=e198]:
                  - checkbox "Termin bestätigt" [ref=e199]
                  - text: Termin bestätigt
                - generic [ref=e202]:
                  - checkbox "Arbeitsbereich bereit" [ref=e203]
                  - text: Arbeitsbereich bereit
                - generic [ref=e206]:
                  - checkbox "Informationen vollständig" [ref=e207]
                  - text: Informationen vollständig
                - generic [ref=e210]:
                  - checkbox "AG bereit" [ref=e211]
                  - text: AG bereit
                - generic [ref=e214]:
                  - checkbox "AN bereit" [disabled] [ref=e215]
                  - text: AN bereit
              - paragraph [ref=e218]: Noch nicht ausführungsbereit
            - generic [ref=e219]:
              - generic [ref=e220]:
                - paragraph [ref=e221]: Offene Risiken
                - paragraph [ref=e224]: "0"
              - generic [ref=e225]:
                - paragraph [ref=e226]: Offene Klärungen
                - paragraph [ref=e230]: "0"
        - group [ref=e231]:
          - generic "Fristen und Erinnerungen" [ref=e232] [cursor=pointer]
        - generic [ref=e233]:
          - generic [ref=e234]: Verlauf
          - generic [ref=e244]:
            - generic [ref=e245]:
              - generic [ref=e246]: Leistungsanfrage e2e-campus-west-9317ace4-6920-4405-aeda-604ff8819240-BILATERAL
              - generic [ref=e247]: UNDER_REVIEW
              - link "Öffnen" [ref=e248] [cursor=pointer]:
                - /url: /leistungsanfragen/e2e-campus-west-9317ace4-6920-4405-aeda-604ff8819240:request-BILATERAL
            - paragraph [ref=e251]: 06.09.2026 07:02
        - group [ref=e252]:
          - generic "Technische Details & Übertragung" [ref=e253] [cursor=pointer]
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