import {
  agDb,
  organizationsTable,
  usersTable,
} from "@workspace/db";
import { inArray } from "drizzle-orm";

export type AgFixtureOptions = {
  prefix: string;
  organizationIds?: readonly string[];
  userIds?: readonly string[];
};

export type AgFixture = {
  readonly role: "ag";
  readonly prefix: string;
  readonly database: typeof agDb;
  readonly organizationIds: readonly string[];
  readonly userIds: readonly string[];
  seedOrganizations(
    rows?: readonly { id: string; name: string; type: "AG" | "AN" }[],
  ): Promise<void>;
  seedUsers(
    rows?: readonly {
      id: string;
      name: string;
      email: string;
      passwordHash: string;
    }[],
  ): Promise<void>;
  cleanupIdentity(): Promise<void>;
};

export function buildAgFixture(options: AgFixtureOptions): AgFixture {
  const organizationIds = options.organizationIds ?? [`${options.prefix}-ag-org`];
  const userIds = options.userIds ?? [`${options.prefix}-ag-user`];

  return {
    role: "ag",
    prefix: options.prefix,
    database: agDb,
    organizationIds,
    userIds,
    async seedOrganizations(rows = organizationIds.map((id) => ({
      id,
      name: `${options.prefix} organization directory row`,
      type: "AG" as const,
    }))) {
      await agDb.insert(organizationsTable).values([...rows]).onConflictDoNothing();
    },
    async seedUsers(rows = userIds.map((id) => ({
      id,
      name: `${options.prefix} AG user`,
      email: `${id}@test.invalid`,
      passwordHash: "fixture-password-hash",
    }))) {
      await agDb.insert(usersTable).values([...rows]).onConflictDoNothing();
    },
    async cleanupIdentity() {
      if (userIds.length > 0) {
        await agDb.delete(usersTable).where(
          // The fixture owns only the explicitly supplied identities.
          // Callers must remove domain rows before invoking this hook.
          inArray(usersTable.id, [...userIds]),
        ).catch(() => {});
      }
      if (organizationIds.length > 0) {
        await agDb.delete(organizationsTable).where(
          inArray(organizationsTable.id, [...organizationIds]),
        ).catch(() => {});
      }
    },
  };
}