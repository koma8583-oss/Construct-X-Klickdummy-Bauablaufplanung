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
  role === "hub" ? "hub" : undefined;
const baseUrl = roleEnv
  ? process.env.DATABASE_URL ?? process.env[roleEnv]
  : undefined;
const schemaFile =
  role === "ag" || role === "an" || role === "hub"
    ? "./src/schema/shared.ts"
    : undefined;

if (!schemaFile || !schema || !baseUrl) {
  throw new Error(
    "DB_ROLE must be ag, an or hub and DATABASE_URL (or the corresponding role URL) must be set",
  );
}

const databaseUrl = new URL(baseUrl);
const searchPath = schema === "hub" ? "hub,pg_catalog" : `${schema},hub,pg_catalog`;
databaseUrl.searchParams.set(
  "options",
  `-c search_path=${searchPath}`,
);

export default defineConfig({
  schema: path.join(
    __dirname,
    schemaFile,
  ),
  dialect: "postgresql",
  dbCredentials: {
    url: databaseUrl.toString(),
  },
});
