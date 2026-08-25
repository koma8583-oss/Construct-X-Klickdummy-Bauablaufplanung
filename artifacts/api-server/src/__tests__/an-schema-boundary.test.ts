import { describe, expect, it } from "vitest";
import * as anSchema from "@workspace/db/schema/an";

describe("AN role schema boundary", () => {
  it("does not export AG-owned coordination tables", () => {
    expect(anSchema).not.toHaveProperty("taktRequestsTable");
    expect(anSchema).not.toHaveProperty("taktRequestResourceRequirementsTable");
    expect(anSchema).not.toHaveProperty("taktResponsesTable");
  });
});