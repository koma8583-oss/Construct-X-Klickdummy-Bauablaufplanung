import { describe, expect, it } from "vitest";
import * as agSchema from "@workspace/db/schema/ag";
import * as anSchema from "@workspace/db/schema/an";
import * as hubSchema from "@workspace/db/schema/hub-database";

describe("AN role schema boundary", () => {
  it("does not export AG-owned coordination tables", () => {
    expect(anSchema).not.toHaveProperty("taktRequestsTable");
    expect(anSchema).not.toHaveProperty("taktRequestResourceRequirementsTable");
    expect(anSchema).not.toHaveProperty("taktResponsesTable");
  });

  it("keeps transport tables Hub-owned in the role schema compositions", () => {
    for (const schema of [agSchema, anSchema]) {
      expect(schema).not.toHaveProperty("messageOutboxTable");
      expect(schema).not.toHaveProperty("messageInboxTable");
      expect(schema).not.toHaveProperty("messageDeliveryAttemptsTable");
      expect(schema).not.toHaveProperty("dataspaceExchangesTable");
    }
    expect(hubSchema).toHaveProperty("messageOutboxTable");
    expect(hubSchema).toHaveProperty("messageInboxTable");
    expect(hubSchema).toHaveProperty("messageDeliveryAttemptsTable");
    expect(hubSchema).toHaveProperty("dataspaceExchangesTable");
  });
});