import app from "./app";
import { logger } from "./lib/logger";

// Fail fast if the JWT secret is missing or is the known insecure dev fallback in production.
// In development the fallback is allowed so that `pnpm dev` works without pre-configuring secrets.
const JWT_SECRET = process.env.JWT_SECRET;
const DEV_FALLBACK = "taktkoord-jwt-dev-secret-change-in-prod";
if (process.env.NODE_ENV === "production") {
  if (!JWT_SECRET || JWT_SECRET === DEV_FALLBACK) {
    logger.error(
      "JWT_SECRET environment variable must be set to a strong random secret in production. " +
        "Set it via Replit Secrets. Refusing to start.",
    );
    process.exit(1);
  }
}

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});
