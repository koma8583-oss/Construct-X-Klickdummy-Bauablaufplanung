import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const openapi = readFileSync(
  new URL("../../../../lib/api-spec/openapi.yaml", import.meta.url),
  "utf8",
);

describe("AN Leistungsanfrage OpenAPI contract", () => {
  it("defines AN-local list and detail schemas independently from AG DTOs", () => {
    expect(openapi).toContain("/an/leistungsanfragen:");
    expect(openapi).toContain("operationId: listAnLeistungsanfragen");
    expect(openapi).toContain("$ref: \"#/components/schemas/AnLeistungsanfrageListItem\"");
    expect(openapi).toContain("/an/leistungsanfragen/{leistungsanfrageId}/details:");
    expect(openapi).toContain("operationId: getAnLeistungsanfrageDetails");
    expect(openapi).toContain("$ref: \"#/components/schemas/AnLeistungsanfrageDetails\"");
    expect(openapi).toContain("AnLeistungsanfrageListItem:");
    expect(openapi).toContain("AnLeistungsanfrageDetails:");
    expect(openapi).toContain("AnLeistungsanfrageResourceRequirement:");
  });
});