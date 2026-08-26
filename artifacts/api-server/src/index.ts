import app from "./app";
import { logger } from "./lib/logger";
import { startDeadlineWorker, stopDeadlineWorker } from "./lib/local-deadline-worker";
import { loadDeadlineConfig } from "./services/deadline-config";
import { seedPolicyTemplates } from "./lib/seed-policy-templates";
import {
  assertDatabaseConfiguration,
  closeDatabasePools,
  runWithDatabaseRole,
} from "@workspace/db";

// Refuse to boot before any pool is opened if the three physical stores are
// missing or accidentally configured to the same PostgreSQL database. The
// identity probe also verifies that role credentials are not shared.
try {
  await assertDatabaseConfiguration();
} catch (error) {
  // assertDatabaseConfiguration deliberately sanitizes driver errors. Log
  // only its safe message, never a connection URL or credential.
  logger.error(
    { message: error instanceof Error ? error.message : "Unknown database configuration error" },
    "Database configuration is invalid; refusing to start",
  );
  process.exit(1);
}

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

const server = app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  // ── Seed canonical policy templates ─────────────────────────────────────
  runWithDatabaseRole("hub", () => seedPolicyTemplates()).catch((err) =>
    logger.error({ err }, "Failed to seed policy templates"),
  );

  // ── Start deadline worker ────────────────────────────────────────────────
  // Reads DEADLINE_WORKER_ENABLED and DEADLINE_WORKER_INTERVAL_MINUTES from env.
  // startDeadlineWorker() is a no-op when workerEnabled is false.
  const deadlineConfig = loadDeadlineConfig();
  startDeadlineWorker(deadlineConfig);

  if (deadlineConfig.workerEnabled) {
    logger.info(
      { intervalMinutes: deadlineConfig.workerIntervalMinutes },
      "Deadline worker started",
    );
  } else {
    logger.info(
      "Deadline worker disabled (set DEADLINE_WORKER_ENABLED=true to enable)",
    );
  }
});

// ── Graceful shutdown ──────────────────────────────────────────────────────────
//
// On SIGTERM or SIGINT:
//   1. Stop accepting new HTTP connections (server.close).
//   2. Stop the deadline worker interval so no new ticks start.
//   3. Await any in-progress deadline evaluation tick before exiting.
//
// This ensures a mid-flight evaluation is never interrupted, which could otherwise
// leave TaktRequest rows in inconsistent states.

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, "Shutdown signal received — stopping server gracefully");

  // Stop accepting new connections
  server.close(() => {
    logger.info("HTTP server closed");
  });

  // Stop deadline worker; awaits any currently-running tick
  await stopDeadlineWorker();
  await closeDatabasePools();

  logger.info("Graceful shutdown complete");
  process.exit(0);
}

process.on("SIGTERM", () => {
  shutdown("SIGTERM").catch((err) => {
    logger.error({ err }, "Error during SIGTERM shutdown");
    process.exit(1);
  });
});

process.on("SIGINT", () => {
  shutdown("SIGINT").catch((err) => {
    logger.error({ err }, "Error during SIGINT shutdown");
    process.exit(1);
  });
});
