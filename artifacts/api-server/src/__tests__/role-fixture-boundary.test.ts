import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const fixtureFiles = {
  ag: "fixtures/ag-fixture.ts",
  an: "fixtures/an-fixture.ts",
  hub: "fixtures/hub-fixture.ts",
} as const;

function sourceFor(file: string) {
  return readFileSync(new URL(file, import.meta.url), "utf8");
}

describe("role-scoped API fixture builders", () => {
  it("exports one builder per physical role", () => {
    expect(sourceFor(fixtureFiles.ag)).toContain("export function buildAgFixture");
    expect(sourceFor(fixtureFiles.an)).toContain("export function buildAnFixture");
    expect(sourceFor(fixtureFiles.hub)).toContain("export function buildHubFixture");
  });

  it.each([
    ["ag", fixtureFiles.ag, "agDb", ["anDb", "hubDb", "messageOutboxTable", "resourceBookingsTable"]],
    ["an", fixtureFiles.an, "anDb", ["agDb", "hubDb", "messageOutboxTable", "projectsTable", "takteTable"]],
    ["hub", fixtureFiles.hub, "hubDb", ["agDb", "anDb", "projectsTable", "takteTable", "resourceBookingsTable"]],
  ] as const)(
    "%s fixture does not import another role or its tables",
    (_role, file, ownedConnection, forbiddenSymbols) => {
      const source = sourceFor(file);
      expect(source).toContain(ownedConnection);
      for (const forbiddenSymbol of forbiddenSymbols) {
        expect(source, `${file} must not reference ${forbiddenSymbol}`).not.toContain(
          forbiddenSymbol,
        );
      }
      expect(source).not.toMatch(/\b(?:db|pool)\s*\./);
      expect(source).not.toMatch(/\b(?:const|let|var)\s+(?:db|pool)\b/);
    },
  );

  it("keeps representative suites on named role fixture databases", () => {
    for (const file of [
      "ag-an-independent-coordination.test.ts",
      "resource-bookings.test.ts",
      "local-hub-transport.test.ts",
    ]) {
      const source = sourceFor(file);
      expect(source, `${file} must not alias a role connection as db`).not.toMatch(
        /\b(?:agDb|anDb|hubDb)\s+as\s+db\b/,
      );
      expect(source, `${file} must not use an unscoped db variable`).not.toMatch(
        /\bdb\./,
      );
    }
  });
});