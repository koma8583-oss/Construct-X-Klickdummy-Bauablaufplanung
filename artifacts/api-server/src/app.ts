import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { pool } from "@workspace/db";
import agRouter from "./routes";
import anRouter from "./routes/an";
import { logger } from "./lib/logger";

declare module "express-session" {
  interface SessionData {
    userId: string;
    orgId: string;
  }
}

const app: Express = express();

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
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const PgSession = connectPgSimple(session);

const sessionStoreOptions = {
  pool,
  tableName: "session",
  createTableIfMissing: false,
};

/** AG session — cookie name: connect.sid (browser default, unchanged for existing AG users) */
const agSession = session({
  store: new PgSession(sessionStoreOptions),
  name: "connect.sid",
  secret: process.env.SESSION_SECRET ?? "taktkoord-dev-secret",
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
    maxAge: 7 * 24 * 60 * 60 * 1000,
  },
});

/** AN session — separate cookie so AG and AN can be open simultaneously in one browser */
const anSession = session({
  store: new PgSession(sessionStoreOptions),
  name: "tk_an_sid",
  secret: process.env.SESSION_SECRET ?? "taktkoord-dev-secret",
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
    maxAge: 7 * 24 * 60 * 60 * 1000,
  },
});

// AN routes under /api/an/ with their own isolated session cookie
app.use("/api/an", anSession, anRouter);

// AG routes under /api/ with the standard session cookie
app.use("/api", agSession, agRouter);

export default app;
