import { defineConfig } from "drizzle-kit";
import path from "path";

const role = process.env.DB_ROLE;
const roleEnv =
  role === "ag" ? "AG_DATABASE_URL" :
  role === "an" ? "AN_DATABASE_URL" :
  role === "hub" ? "HUB_DATABASE_URL" :
  role === "shared" ? undefined : undefined;
const url = roleEnv ? (process.env[roleEnv] ?? process.env.DATABASE_URL) : undefined;
const sharedUrl = role === "shared" ? process.env.DATABASE_URL ?? process.env.AG_DATABASE_URL : undefined;
const schemaFile =
  role === "ag" ? "./src/schema/ag.ts" :
  role === "an" ? "./src/schema/an.ts" :
  role === "hub" ? "./src/schema/hub-database.ts" :
  "./src/schema/shared.ts";

if (!["ag", "an", "hub", "shared"].includes(role ?? "") || (!url && !sharedUrl)) {
  throw new Error(
    "DB_ROLE must be ag, an, hub, or shared and DATABASE_URL or its corresponding *_DATABASE_URL must be set",
  );
}

export default defineConfig({
  schema: path.join(
    __dirname,
    schemaFile,
  ),
  dialect: "postgresql",
  dbCredentials: {
    url: url ?? sharedUrl!,
  },
});
