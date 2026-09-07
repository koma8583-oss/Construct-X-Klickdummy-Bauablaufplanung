import { defineConfig } from "drizzle-kit";
import path from "path";

const role = process.env.DB_ROLE;
const roleEnv =
  role === "ag" ? "AG_DATABASE_URL" :
  role === "an" ? "AN_DATABASE_URL" :
  role === "hub" ? "HUB_DATABASE_URL" : undefined;
const schema =
  role === "ag" ? "ag" :
  role === "an" ? "an" :
  role === "hub" ? "hub" :
  role === "bootstrap" ? "public" : undefined;
const baseUrl = role === "bootstrap"
  ? process.env.DATABASE_URL
  : roleEnv
    ? process.env.DATABASE_URL ?? process.env[roleEnv]
    : undefined;
const schemaFile =
  role === "ag"
    ? "./src/schema/ag.ts"
    : role === "an"
      ? "./src/schema/an.ts"
      : role === "hub"
        ? "./src/schema/hub-database.ts"
        : role === "bootstrap"
          ? "./src/schema/shared.ts"
          : undefined;

if (!schemaFile || !schema || !baseUrl) {
  throw new Error(
    "DB_ROLE must be ag, an, hub or bootstrap and DATABASE_URL (or the corresponding role URL) must be set",
  );
}

const databaseUrl = new URL(baseUrl);
const searchPath = role === "bootstrap"
  ? "public,pg_catalog"
  : schema === "hub"
    ? "hub,pg_catalog"
    : `${schema},hub,pg_catalog`;
databaseUrl.searchParams.set(
  "options",
  `-c search_path=${searchPath}`,
);

export default defineConfig({
  schema: path.join(
    __dirname,
    schemaFile,
  ),
  // Fresh databases are bootstrapped once in public so unqualified pgEnum
  // definitions are created exactly once. Runtime/upgrade pushes remain scoped
  // to their canonical role schema.
  schemaFilter: [schema],
  dialect: "postgresql",
  dbCredentials: {
    url: databaseUrl.toString(),
  },
});
