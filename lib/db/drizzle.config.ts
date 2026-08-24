import { defineConfig } from "drizzle-kit";
import path from "path";

const role = process.env.DB_ROLE;
const roleEnv =
  role === "ag" ? "AG_DATABASE_URL" :
  role === "an" ? "AN_DATABASE_URL" :
  role === "hub" ? "HUB_DATABASE_URL" : undefined;
const url = roleEnv ? process.env[roleEnv] : undefined;

if (!roleEnv || !url) {
  throw new Error(
    "DB_ROLE must be ag, an, or hub and its corresponding *_DATABASE_URL must be set",
  );
}

export default defineConfig({
  schema: path.join(
    __dirname,
    role === "ag" ? "./src/schema/ag.ts" :
    role === "an" ? "./src/schema/an.ts" : "./src/schema/hub-database.ts",
  ),
  dialect: "postgresql",
  dbCredentials: {
    url,
  },
});
