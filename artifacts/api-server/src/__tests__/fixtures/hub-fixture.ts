import {
  hubDb,
  organizationsTable,
} from "@workspace/db";
import { inArray } from "drizzle-orm";

export type HubFixtureOptions = {
  prefix: string;
  organizationIds?: readonly string[];
};

export type HubFixture = {
  readonly role: "hub";
  readonly prefix: string;
  readonly database: typeof hubDb;
  readonly organizationIds: readonly string[];
  seedOrganizations(
    rows?: readonly { id: string; name: string; type: "AG" | "AN" }[],
  ): Promise<void>;
  cleanupOrganizations(): Promise<void>;
};

export function buildHubFixture(options: HubFixtureOptions): HubFixture {
  const organizationIds = options.organizationIds ?? [`${options.prefix}-hub-org`];

  return {
    role: "hub",
    prefix: options.prefix,
    database: hubDb,
    organizationIds,
    async seedOrganizations(rows = organizationIds.map((id) => ({
      id,
      name: `${options.prefix} Hub participant`,
      type: "AN" as const,
    }))) {
      await hubDb.insert(organizationsTable).values([...rows]).onConflictDoNothing();
    },
    async cleanupOrganizations() {
      if (organizationIds.length === 0) return;
      await hubDb.delete(organizationsTable).where(
        inArray(organizationsTable.id, [...organizationIds]),
      ).catch(() => {});
    },
  };
}