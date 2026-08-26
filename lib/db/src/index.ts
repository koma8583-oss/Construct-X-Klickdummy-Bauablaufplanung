import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { AsyncLocalStorage } from "node:async_hooks";
import * as schema from "./schema";

const { Pool } = pg;

export type DatabaseRole = "ag" | "an" | "hub";

const roleEnvironmentVariables: Record<DatabaseRole, string> = {
  ag: "AG_DATABASE_URL",
  an: "AN_DATABASE_URL",
  hub: "HUB_DATABASE_URL",
};

/**
 * The single-database setup is an explicit development/test-only mode. It is
 * intentionally not inferred from the presence of DATABASE_URL because that
 * would make a production deployment silently lose its physical boundary.
 */
const SHARED_DATABASE_POC_ENV = "TAKTKOORD_SHARED_DATABASE_POC";

type DatabaseConfiguration = {
  mode: "separate" | "shared-poc";
  connectionStrings: Record<DatabaseRole, string>;
};

type DatabaseIdentity = {
  databaseName: string;
  connectionUser: string;
};

function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

function isSharedDatabasePocRequested(): boolean {
  return process.env[SHARED_DATABASE_POC_ENV] === "true";
}

function getDatabaseConfiguration(): DatabaseConfiguration {
  const sharedPocRequested = isSharedDatabasePocRequested();
  const sharedUrl = process.env.DATABASE_URL;
  const roleUrls = (Object.keys(roleEnvironmentVariables) as DatabaseRole[]).map(
    (role) => [role, process.env[roleEnvironmentVariables[role]]] as const,
  );
  const hasRoleUrl = roleUrls.some(([, url]) => Boolean(url));

  if (sharedPocRequested) {
    if (isProduction()) {
      throw new Error(
        `${SHARED_DATABASE_POC_ENV}=true is only permitted outside production. ` +
          "Configure separate AG_DATABASE_URL, AN_DATABASE_URL, and HUB_DATABASE_URL.",
      );
    }
    if (!sharedUrl) {
      throw new Error(
        `${SHARED_DATABASE_POC_ENV}=true requires DATABASE_URL. ` +
          "Configure separate role URLs instead when physical database separation is required.",
      );
    }
    if (hasRoleUrl) {
      throw new Error(
        `${SHARED_DATABASE_POC_ENV}=true requires DATABASE_URL without any role-specific ` +
          "database URLs; refusing to ignore an ambiguous mixed configuration.",
      );
    }
    return {
      mode: "shared-poc",
      connectionStrings: { ag: sharedUrl, an: sharedUrl, hub: sharedUrl },
    };
  }

  const missing = roleUrls
    .filter(([, url]) => !url)
    .map(([role]) => roleEnvironmentVariables[role]);
  if (missing.length > 0) {
    const sharedHint = sharedUrl
      ? ` For the non-production shared-database PoC only, set ${SHARED_DATABASE_POC_ENV}=true.`
      : "";
    throw new Error(
      `Separate database configuration is required. Missing: ${missing.join(", ")}. ` +
        "Set all three role URLs." + sharedHint,
    );
  }

  return {
    mode: "separate",
    connectionStrings: Object.fromEntries(
      roleUrls.map(([role, url]) => [role, url!]),
    ) as Record<DatabaseRole, string>,
  };
}

async function readDatabaseIdentity(
  role: DatabaseRole,
  connectionString: string,
): Promise<DatabaseIdentity> {
  const rolePool = new Pool({ connectionString });
  try {
    const result = await rolePool.query<{
      database_name: string;
      connection_user: string;
    }>("SELECT current_database() AS database_name, current_user AS connection_user");
    const identity = result.rows[0];
    if (!identity?.database_name || !identity.connection_user) {
      throw new Error("PostgreSQL returned an incomplete connection identity");
    }
    return {
      databaseName: identity.database_name,
      connectionUser: identity.connection_user,
    };
  } catch {
    // Do not rethrow the driver error: connection errors can contain the
    // connection string, including a password.
    throw new Error(
      `Unable to validate the ${role.toUpperCase()} PostgreSQL target. ` +
        "Check its database URL and credentials.",
    );
  } finally {
    await rolePool.end();
  }
}

function findDuplicateRoles(
  identities: Record<DatabaseRole, DatabaseIdentity>,
  field: keyof DatabaseIdentity,
): string[] {
  const roles = Object.keys(identities) as DatabaseRole[];
  const duplicates: string[] = [];
  for (let index = 0; index < roles.length; index += 1) {
    for (let nextIndex = index + 1; nextIndex < roles.length; nextIndex += 1) {
      if (identities[roles[index]][field] === identities[roles[nextIndex]][field]) {
        duplicates.push(
          `${roles[index].toUpperCase()} and ${roles[nextIndex].toUpperCase()}`,
        );
      }
    }
  }
  return duplicates;
}

/**
 * Validate the physical boundary before the API starts accepting requests.
 *
 * PostgreSQL identities are queried after connecting instead of comparing URL
 * text, since aliases can refer to the same database and URLs can differ in
 * formatting. Database and connection-user identities must both be unique.
 */
export async function assertDatabaseConfiguration(): Promise<void> {
  const configuration = getDatabaseConfiguration();
  if (configuration.mode === "shared-poc") {
    return;
  }

  const roles = Object.keys(configuration.connectionStrings) as DatabaseRole[];
  const entries = await Promise.all(
    roles.map(async (role) => [
      role,
      await readDatabaseIdentity(role, configuration.connectionStrings[role]),
    ] as const),
  );
  const identities = Object.fromEntries(entries) as Record<
    DatabaseRole,
    DatabaseIdentity
  >;
  const sharedDatabases = findDuplicateRoles(identities, "databaseName");
  const sharedUsers = findDuplicateRoles(identities, "connectionUser");
  const violations: string[] = [];
  if (sharedDatabases.length > 0) {
    violations.push(
      `database identity is shared by ${sharedDatabases.join("; ")}`,
    );
  }
  if (sharedUsers.length > 0) {
    violations.push(
      `connection-user identity is shared by ${sharedUsers.join("; ")}`,
    );
  }
  if (violations.length > 0) {
    throw new Error(
      `Physical database separation validation failed: ${violations.join(" and ")}. ` +
        "Use distinct PostgreSQL databases and connection users for AG, AN, and Hub.",
    );
  }
}

export function createDatabase(connectionString: string) {
  return drizzle(new Pool({ connectionString }), { schema });
}

function getConnectionStrings(): Record<DatabaseRole, string> {
  return getDatabaseConfiguration().connectionStrings;
}

// Keep pool creation lazy enough for unit tests and tooling that only imports
// schema types. The API entry point validates the physical identities before
// serving traffic.
const pools = new Map<DatabaseRole, pg.Pool>();
const databases = new Map<DatabaseRole, ReturnType<typeof createDatabase>>();
function databaseFor(role: DatabaseRole) {
  let database = databases.get(role);
  if (!database) {
    const url = getConnectionStrings()[role];
    if (!url) {
      throw new Error(`${role.toUpperCase()}_DATABASE_URL is not configured`);
    }
    const rolePool = new Pool({ connectionString: url });
    pools.set(role, rolePool);
    database = drizzle(rolePool, { schema });
    databases.set(role, database);
  }
  return database;
}

export const agDb = new Proxy({} as ReturnType<typeof createDatabase>, {
  get(_target, property, receiver) {
    return Reflect.get(databaseFor("ag"), property, receiver);
  },
});
export const anDb = new Proxy({} as ReturnType<typeof createDatabase>, {
  get(_target, property, receiver) {
    return Reflect.get(databaseFor("an"), property, receiver);
  },
});
export const hubDb = new Proxy({} as ReturnType<typeof createDatabase>, {
  get(_target, property, receiver) {
    return Reflect.get(databaseFor("hub"), property, receiver);
  },
});

const roleStorage = new AsyncLocalStorage<DatabaseRole>();
export function runWithDatabaseRole<T>(role: DatabaseRole, callback: () => T): T {
  return roleStorage.run(role, callback);
}
export function currentDatabaseRole(): DatabaseRole {
  const role = roleStorage.getStore();
  if (!role) {
    throw new Error(
      "No database role is active. Wrap the request or job in runWithDatabaseRole().",
    );
  }
  return role;
}

export async function closeDatabasePools(): Promise<void> {
  await Promise.all([...pools.values()].map((databasePool) => databasePool.end()));
  pools.clear();
  databases.clear();
}

/**
 * Compatibility facade for existing repositories.  It is intentionally
 * request-scoped (rather than a shared connection): app.ts establishes the
 * role from the route boundary, and transport code uses hubDb explicitly.
 */
export const db = new Proxy({} as ReturnType<typeof createDatabase>, {
  get(_target, property, receiver) {
    return Reflect.get(
      databaseFor(currentDatabaseRole()),
      property,
      receiver,
    );
  },
});

export const agPool = new Proxy({} as pg.Pool, {
  get(_target, property, receiver) {
    databaseFor("ag");
    return Reflect.get(pools.get("ag")!, property, receiver);
  },
});
export const anPool = new Proxy({} as pg.Pool, {
  get(_target, property, receiver) {
    databaseFor("an");
    return Reflect.get(pools.get("an")!, property, receiver);
  },
});
export const hubPool = new Proxy({} as pg.Pool, {
  get(_target, property, receiver) {
    databaseFor("hub");
    return Reflect.get(pools.get("hub")!, property, receiver);
  },
});

// Legacy worker/test callers are pinned to the Hub pool rather than a
// cross-domain pool. New code should select agPool/anPool/hubPool explicitly.
export const pool = hubPool;

export * from "./schema";
