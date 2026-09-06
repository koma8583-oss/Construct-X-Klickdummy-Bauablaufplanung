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
 * AG, AN and Hub always share one PostgreSQL database. Isolation is provided
 * by PostgreSQL schemas and effective database roles, not by separate servers
 * or databases. Role-specific URLs are optional: when only DATABASE_URL is
 * configured, the connection user must be allowed to SET ROLE to the
 * role-specific NOLOGIN roles provisioned by the database bootstrap.
 */
const roleNameEnvironmentVariables: Record<DatabaseRole, string> = {
  ag: "AG_DATABASE_ROLE",
  an: "AN_DATABASE_ROLE",
  hub: "HUB_DATABASE_ROLE",
};

const defaultRoleNames: Record<DatabaseRole, string> = {
  ag: "taktkoord_ag",
  an: "taktkoord_an",
  hub: "taktkoord_hub",
};

export const databaseSchemaByRole: Record<DatabaseRole, string> = {
  ag: "ag",
  an: "an",
  hub: "hub",
};

type DatabaseConfiguration = {
  mode: "shared";
  connectionStrings: Record<DatabaseRole, string>;
  roleNames: Record<DatabaseRole, string>;
  useRoleSwitching: Record<DatabaseRole, boolean>;
};

type DatabaseIdentity = {
  databaseName: string;
  connectionUser: string;
};

function roleNames(): Record<DatabaseRole, string> {
  const roles = {} as Record<DatabaseRole, string>;
  for (const role of Object.keys(defaultRoleNames) as DatabaseRole[]) {
    const configured = process.env[roleNameEnvironmentVariables[role]];
    const name = configured || defaultRoleNames[role];
    if (!/^[a-z_][a-z0-9_]*$/.test(name)) {
      throw new Error(
        `${roleNameEnvironmentVariables[role]} must be a lowercase PostgreSQL role identifier`,
      );
    }
    roles[role] = name;
  }
  return roles;
}

function getDatabaseConfiguration(): DatabaseConfiguration {
  const sharedUrl = process.env.DATABASE_URL;
  const roleUrls = (Object.keys(roleEnvironmentVariables) as DatabaseRole[]).map(
    (role) => [role, process.env[roleEnvironmentVariables[role]]] as const,
  );
  if (!sharedUrl && roleUrls.some(([, url]) => !url)) {
    throw new Error(
      "A single DATABASE_URL or all three role-specific URLs " +
        "(AG_DATABASE_URL, AN_DATABASE_URL, HUB_DATABASE_URL) are required. " +
        "All targets must resolve to the same PostgreSQL database.",
    );
  }

  const roles = roleNames();
  return {
    mode: "shared",
    connectionStrings: Object.fromEntries(
      roleUrls.map(([role, url]) => [role, url ?? sharedUrl!]),
    ) as Record<DatabaseRole, string>,
    roleNames: roles,
    // Role-specific URLs may still use the shared bootstrap credential. The
    // effective application identity is always established with SET ROLE.
    useRoleSwitching: Object.fromEntries(
      roleUrls.map(([role]) => [role, true]),
    ) as Record<DatabaseRole, boolean>,
  };
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function quoteLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function connectionOptions(
  role: DatabaseRole,
  configuration: DatabaseConfiguration,
): string {
  const schema = databaseSchemaByRole[role];
  const roleOption = configuration.useRoleSwitching[role]
    ? ` -c role=${configuration.roleNames[role]}`
    : "";
  const searchPath = role === "hub"
    ? `${schema},pg_catalog`
    : `${schema},hub,pg_catalog`;
  return `-c search_path=${searchPath}${roleOption}`;
}

async function readDatabaseIdentity(
  role: DatabaseRole,
  connectionString: string,
  configuration: DatabaseConfiguration,
): Promise<DatabaseIdentity> {
  const rolePool = new Pool({
    connectionString,
    options: connectionOptions(role, configuration),
  });
  try {
    const result = await rolePool.query<{
      database_name: string;
      connection_user: string;
      session_user: string;
      current_schema: string;
      has_schema_usage: boolean;
    }>(
      `SELECT current_database() AS database_name,
              current_user AS connection_user,
              session_user,
              current_schema(),
              has_schema_privilege(current_user, ${quoteLiteral(databaseSchemaByRole[role])}, 'USAGE')
                AS has_schema_usage`,
    );
    const identity = result.rows[0];
    if (
      !identity?.database_name ||
      !identity.connection_user ||
      !identity.session_user ||
      identity.current_schema !== databaseSchemaByRole[role] ||
      !identity.has_schema_usage
    ) {
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
  const roles = Object.keys(configuration.connectionStrings) as DatabaseRole[];
  const entries = await Promise.all(
    roles.map(async (role) => [
      role,
      await readDatabaseIdentity(
        role,
        configuration.connectionStrings[role],
        configuration,
      ),
    ] as const),
  );
  const identities = Object.fromEntries(entries) as Record<
    DatabaseRole,
    DatabaseIdentity
  >;
  const violations: string[] = [];
  const databaseNames = new Set(
    roles.map((role) => identities[role].databaseName),
  );
  if (databaseNames.size !== 1) {
    violations.push(
      "AG, AN and Hub do not point to the same PostgreSQL database",
    );
  }
  const sharedUsers = findDuplicateRoles(identities, "connectionUser");
  const roleSwitchingUsers = roles.filter(
    (role) => configuration.useRoleSwitching[role],
  );
  if (
    roleSwitchingUsers.some(
      (role) => identities[role].connectionUser !== configuration.roleNames[role],
    )
  ) {
    violations.push(
      "role switching did not establish the configured AG, AN and Hub database roles",
    );
  }
  if (sharedUsers.length > 0 && roleSwitchingUsers.length !== roles.length) {
    violations.push(
      `effective connection-user identity is shared by ${sharedUsers.join("; ")}`,
    );
  }
  if (violations.length > 0) {
    throw new Error(
      `Shared database role isolation validation failed: ${violations.join(" and ")}. ` +
        "Use one PostgreSQL database with the ag, an and hub schemas and least-privilege roles.",
    );
  }
}

export function createDatabase(connectionString: string) {
  return drizzle(new Pool({ connectionString }), { schema });
}

function getConnectionStrings(): DatabaseConfiguration {
  return getDatabaseConfiguration();
}

// Keep pool creation lazy enough for unit tests and tooling that only imports
// schema types. The API entry point validates the physical identities before
// serving traffic.
const pools = new Map<DatabaseRole, pg.Pool>();
const databases = new Map<DatabaseRole, ReturnType<typeof createDatabase>>();
function databaseFor(role: DatabaseRole) {
  let database = databases.get(role);
  if (!database) {
    const configuration = getConnectionStrings();
    const url = configuration.connectionStrings[role];
    if (!url) {
      throw new Error(`${role.toUpperCase()}_DATABASE_URL is not configured`);
    }
    const rolePool = new Pool({
      connectionString: url,
      options: connectionOptions(role, configuration),
    });
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
