import { readFile } from "node:fs/promises";

const reportPath = process.argv[2];
if (!reportPath) {
  throw new Error(
    "Usage: node scripts/assert-playwright-ci.mjs <playwright-json-report>",
  );
}

const report = JSON.parse(await readFile(reportPath, "utf8"));
const requiredProjects = ["desktop", "mobile"];
const projects = new Map(
  requiredProjects.map((name) => [
    name,
    { discovered: 0, executed: 0, skipped: 0 },
  ]),
);

const failedTests = [];

function visitSuite(suite) {
  for (const spec of suite.specs ?? []) {
    for (const test of spec.tests ?? []) {
      const state = projects.get(test.projectName);
      if (!state) continue;
      state.discovered += 1;
      const results = test.results ?? [];
      const skipped =
        test.status === "skipped" ||
        test.expectedStatus === "skipped" ||
        results.length === 0 ||
        results.every((result) => result.status === "skipped");
      if (skipped) state.skipped += 1;
      else state.executed += 1;
      if (
        test.status === "unexpected" ||
        results.some((result) =>
          result.status === "failed" || result.status === "timedOut",
        )
      ) {
        failedTests.push(
          [...(suite.title ? [suite.title] : []), spec.title, test.projectName]
            .filter(Boolean)
            .join(" › "),
        );
      }
    }
  }
  for (const child of suite.suites ?? []) visitSuite(child);
}

for (const suite of report.suites ?? []) visitSuite(suite);

const failures = [];
for (const [name, state] of projects) {
  if (state.discovered === 0) failures.push(`${name}: no tests discovered`);
  if (state.executed === 0) failures.push(`${name}: no tests executed`);
  if (state.skipped > 0)
    failures.push(`${name}: ${state.skipped} test(s) skipped`);
}
if ((report.errors ?? []).length > 0)
  failures.push("Playwright reported top-level errors");
if ((report.stats?.unexpected ?? 0) > 0)
  failures.push(`${report.stats.unexpected} unexpected result(s)`);
if ((report.stats?.flaky ?? 0) > 0)
  failures.push(`${report.stats.flaky} flaky result(s)`);
if ((report.stats?.skipped ?? 0) > 0)
  failures.push(`${report.stats.skipped} skipped result(s)`);

if (failures.length > 0) {
  for (const test of failedTests) {
    console.error(`::error::Playwright failed: ${test}`);
  }
  throw new Error(
    `Required Playwright execution incomplete:\n- ${failures.join("\n- ")}`,
  );
}

console.log(
  `Verified required Playwright projects: ${requiredProjects
    .map((name) => `${name} (${projects.get(name).executed} executed)`)
    .join(", ")}`,
);
