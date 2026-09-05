import { expect, test as base, type BrowserContext } from "@playwright/test";
import { cleanupCampusWest, seedCampusWest, type Seed } from "./campus-west-seed";

export type PolicyClass = "WITHIN_BASELINE" | "REQUIRES_CONSENT" | "NOT_PERMITTED";
export type Scenario = {
  runId: string;
  ag: { email: string; password: string };
  an: Array<{ email: string; password: string }>;
  requests: Record<PolicyClass, string>;
  bilateralRequestId: string;
  multiRequestIds: string[];
};

type Fixtures = {
  scenario: Scenario;
  agContext: BrowserContext;
  anContext: BrowserContext;
};

const baseUrl = () => process.env.E2E_BASE_URL ?? "http://localhost:80";

async function signIn(context: BrowserContext, appPath: "/" | "/an/", account: Scenario["ag"]): Promise<void> {
  const page = await context.newPage();
  await page.goto(new URL(`${appPath}login`, baseUrl()).toString());
  await page.getByLabel(/e-mail|email/i).fill(account.email);
  await page.getByLabel(/passwort|password/i).fill(account.password);
  await page.getByRole("button", { name: /anmelden|log in/i }).click();
  await expect(page).not.toHaveURL(/\/login/);
  await page.close();
}

export const test = base.extend<Fixtures>({
  scenario: [async ({}, use) => {
    const value = await seedCampusWest();
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
});

export { expect };