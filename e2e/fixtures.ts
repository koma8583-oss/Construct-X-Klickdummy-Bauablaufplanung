import { expect, request as apiRequest, test as base, type APIRequestContext, type BrowserContext } from "@playwright/test";
import { cleanupCampusWest, seedCampusWest, type Seed } from "./campus-west-seed";

export type PolicyClass = "WITHIN_BASELINE" | "REQUIRES_CONSENT" | "NOT_PERMITTED";
export type Scenario = {
  runId: string;
  ag: { email: string; password: string };
  an: Array<{ email: string; password: string }>;
  requests: Record<PolicyClass, string>;
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