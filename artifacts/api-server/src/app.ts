import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import cookieParser from "cookie-parser";
import agRouter from "./routes";
import anRouter from "./routes/an";
import hubRouter from "./routes/hub";
import authServiceRouter from "./routes/auth-service";
import internalRouter from "./routes/internal";
import agProjectsRouter from "./routes/ag/projects";
import reportsRouter from "./routes/reports";
import dataPublicationsRouter from "./routes/data-publications";
import { logger } from "./lib/logger";
import { runWithDatabaseRole, type DatabaseRole } from "@workspace/db";

const app: Express = express();

// Authenticated API responses must never be reused from a browser cache.
// Otherwise a direct data cleanup or another session's mutation can leave
// stale Leistungsanfragen visible after the API already returns no rows.
app.disable("etag");
app.use("/api", (_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

// Establish the physical data boundary before any route handler runs.  The
// URL path is the trust boundary in this single-process deployment: AG, AN,
// and Hub handlers cannot accidentally inherit one another's connection.
app.use((req, _res, next) => {
  const path = req.originalUrl.split("?")[0];
  const role: DatabaseRole =
    path.startsWith("/api/an") ? "an" :
    path.startsWith("/api/hub/") || path.startsWith("/auth-service") ||
      path.startsWith("/internal") || path.startsWith("/api/dataspace/") ? "hub" :
    "ag";
  runWithDatabaseRole(role, next);
});

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

app.use(
  cors({
    origin: true,
    credentials: true,
  }),
);
app.use(express.json({
  limit: "256kb",
  verify: (req, _res, buffer) => {
    (req as typeof req & { rawBody?: Buffer }).rawBody = Buffer.from(buffer);
  },
}));
app.use(express.urlencoded({ extended: true }));

// Parse cookies — required by the auth-service refresh-token flow
app.use(cookieParser());

// ── Centralized JWT auth service — shared by all three apps ─────────────────
app.use("/auth-service", authServiceRouter);

// ── Hub routes under /api/hub/ ───────────────────────────────────────────────
app.use("/api/hub", hubRouter);

// ── AN routes under /api/an/ ─────────────────────────────────────────────────
app.use("/api/an", anRouter);

// ── AG routes under /api/ ────────────────────────────────────────────────────
app.use("/api", agProjectsRouter);
app.use("/api", agRouter);

// ── Reports (AG + AN + Hub) under /api/reports/ ───────────────────────────────
app.use("/api", reportsRouter);
app.use("/api", dataPublicationsRouter);

// ── Internal-only routes (dev/admin, not public) ─────────────────────────────
app.use("/internal", internalRouter);

export default app;
