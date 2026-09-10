import { readFile } from "node:fs/promises";

const reportPath = process.argv[2];
if (!reportPath) {
  throw new Error(
    "Usage: node scripts/assert-playwright-matrix.mjs <playwright-list-json-report>",
  );
}

const report = JSON.parse(await readFile(reportPath, "utf8"));
const requiredProjects = ["desktop", "mobile"];
const requiredScenarios = new Map([
  ["within", "within-baseline policy scenario"],
  ["consent", "consent policy scenario"],
  ["denied", "denied policy scenario"],
  ["full", "full coordination scenario"],
]);
const projects = new Map(
  requiredProjects.map((name) => [
    name,
    new Set(),
  ]),
);
const discoveredProjects = new Set();

function visitSuite(suite, scenario) {
  const matchedScenario = [...requiredScenarios.entries()].find(
    ([, title]) => title === suite.title,
  )?.[0];
  const nextScenario = matchedScenario ?? scenario;

  for (const spec of suite.specs ?? []) {
    for (const test of spec.tests ?? []) {
      if (projects.has(test.projectName)) {
        discoveredProjects.add(test.projectName);
      }
      if (projects.has(test.projectName) && nextScenario) {
        projects.get(test.projectName).add(nextScenario);
      }
    }
  }

  for (const child of suite.suites ?? []) {
    visitSuite(child, nextScenario);
  }
}

for (const suite of report.suites ?? []) {
  visitSuite(suite);
}

const failures = [];
for (const [project, scenarios] of projects) {
  if (!discoveredProjects.has(project)) {
    failures.push(`${project}: project has no discovered tests`);
    continue;
  }
  if (scenarios.size === 0) {
    failures.push(`${project}: no policy scenario tests discovered`);
    continue;
  }

  for (const [name, title] of requiredScenarios) {
    if (!scenarios.has(name)) {
      failures.push(
        `${project}: missing ${name} policy scenario (expected a test in "${title}")`,
      );
    }
  }
}

if ((report.errors ?? []).length > 0) {
  failures.push("Playwright reported discovery errors");
}

if (failures.length > 0) {
  throw new Error(
    `Required Playwright policy scenario matrix incomplete:\n- ${failures.join("\n- ")}`,
  );
}

console.log(
  `Verified policy scenario matrix: ${requiredProjects
    .map((project) => `${project} (${requiredScenarios.size} scenarios)`)
    .join(", ")}`,
);