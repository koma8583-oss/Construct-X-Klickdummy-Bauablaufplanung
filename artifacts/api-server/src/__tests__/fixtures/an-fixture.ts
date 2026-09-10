import {
  anDb,
  organizationsTable,
} from "@workspace/db";
import { inArray } from "drizzle-orm";

export type AnFixtureOptions = {
  prefix: string;
  organizationIds?: readonly string[];
};

export type AnFixture = {
  readonly role: "an";
  readonly prefix: string;
  readonly database: typeof anDb;
  readonly organizationIds: readonly string[];
  seedOrganizations(
    rows?: readonly { id: string; name: string; type: "AN" }[],
  ): Promise<void>;
  cleanupOrganizations(): Promise<void>;
};

export function buildAnFixture(options: AnFixtureOptions): AnFixture {
  const organizationIds = options.organizationIds ?? [`${options.prefix}-an-org`];

  return {
    role: "an",
    prefix: options.prefix,
    database: anDb,
    organizationIds,
    async seedOrganizations(rows = organizationIds.map((id) => ({
      id,
      name: `${options.prefix} AN organization`,
      type: "AN" as const,
    }))) {
      await anDb.insert(organizationsTable).values([...rows]).onConflictDoNothing();
    },
    async cleanupOrganizations() {
      if (organizationIds.length === 0) return;
      await anDb.delete(organizationsTable).where(
        inArray(organizationsTable.id, [...organizationIds]),
      ).catch(() => {});
    },
  };
}