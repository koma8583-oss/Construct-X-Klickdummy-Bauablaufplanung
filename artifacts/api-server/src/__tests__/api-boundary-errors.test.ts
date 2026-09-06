import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  ApiBoundaryValidationError,
  apiErrorHandler,
} from "../middlewares/api-error-handler";

describe("API boundary error responses", () => {
  function boundaryApp(throwError: () => void) {
    const app = express();
    app.use(express.json());
    app.post("/boundary", (_req, _res) => throwError());
    app.use(apiErrorHandler);
    return app;
  }

  it("returns JSON 400 rather than a generic 500 for malformed JSON", async () => {
    const app = express();
    app.use(express.json());
    app.post("/boundary", (_req, res) => res.status(204).end());
    app.use(apiErrorHandler);

    const response = await request(app)
      .post("/boundary")
      .set("Content-Type", "application/json")
      .send("{");

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: "Invalid JSON payload" });
  });

  it("returns JSON 422 for contract validation failures", async () => {
    const response = await request(boundaryApp(() => z.object({ requestId: z.string().uuid() }).parse({ requestId: "bad" })))
      .post("/boundary")
      .send({});

    expect(response.status).toBe(422);
    expect(response.body.error).toBe("Invalid request payload");
    expect(response.body.issues).toEqual(expect.any(Array));
  });

  it("returns JSON 422 for expected mapper failures", async () => {
    const response = await request(boundaryApp(() => {
      throw new ApiBoundaryValidationError("Snapshot resource requirement is incomplete");
    }))
      .post("/boundary")
      .send({});

    expect(response.status).toBe(422);
    expect(response.body).toEqual({
      error: "Snapshot resource requirement is incomplete",
    });
  });
});