import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { AsyncLocalStorage } from "node:async_hooks";
import * as schema from "./schema";

const { Pool } = pg;

export type DatabaseRole = "ag" | "an" | "hub";

const connectionStrings: Record<DatabaseRole, string | undefined> = {
  ag: process.env.AG_DATABASE_URL ?? process.env.DATABASE_URL,
  an: process.env.AN_DATABASE_URL ?? process.env.DATABASE_URL,
  hub: process.env.HUB_DATABASE_URL ?? process.env.DATABASE_URL,
};

/**
 * AG, AN and Hub always have separate logical connection contexts. In the
 * current PoC their URLs may intentionally point at the same PostgreSQL
 * database and user; ownership checks and Dataspace processing remain the
 * cross-domain boundary.
 */
export function assertDatabaseConfiguration(): void {
  const missing = (Object.entries(connectionStrings) as [DatabaseRole, string | undefined][])
    .filter(([, url]) => !url)
    .map(([role]) => `${role.toUpperCase()}_DATABASE_URL`);
  if (missing.length > 0) {
    throw new Error(
      `Separate database configuration is required. Missing: ${missing.join(", ")}. ` +
        "Set all three role URLs or use DATABASE_URL explicitly for logical isolation.",
    );
  }

}

export function createDatabase(connectionString: string) {
  return drizzle(new Pool({ connectionString }), { schema });
}

// Keep pool creation lazy enough for unit tests and tooling that only imports
// schema types.  The API entry point calls assertDatabaseConfiguration() before
// serving traffic, so production still fails closed.
const pools = new Map<DatabaseRole, pg.Pool>();
const databases = new Map<DatabaseRole, ReturnType<typeof createDatabase>>();
function databaseFor(role: DatabaseRole) {
  let database = databases.get(role);
  if (!database) {
    const url = connectionStrings[role];
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
