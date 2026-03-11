/**
 * Cloudflare Worker entrypoint.
 * Routes: /api/permits, /api/reports, /api/entities, /api/exports
 * Extra: POST /api/permits/seed (bootstrap)
 * Queue consumer: PIPELINE_QUEUE
 */

import { createDb } from "@permit-intel/db/src/client.js";
import { handlePermits } from "./routes/permits.js";
import { handleReports } from "./routes/reports.js";
import { handleEntities } from "./routes/entities.js";
import { handleExports } from "./routes/exports.js";
import { logger } from "@permit-intel/shared/src/utils/index.js";
import { handlePipelineQueue } from "./consumers/pipeline.js";
import { handleSeedPermits } from "./routes/seed.js";

export interface Env {
  DB: D1Database;
  PIPELINE_QUEUE: Queue;

  // R2 storage (required for durable exports/evidence)
  EXPORTS_BUCKET: R2Bucket;
  EVIDENCE_BUCKET: R2Bucket;

  // Single-operator auth
  API_KEY: string;

  // Provider keys (optional; do not require these at deploy time)
  OPENROUTER_API_KEY?: string;
  OPENROUTER_BASE_URL?: string;
  OPENROUTER_MODEL?: string;
  OPENROUTER_APP_NAME?: string;

  GROQ_API_KEY?: string;
  GROQ_BASE_URL?: string;
  GROQ_MODEL?: string;

  OPENAI_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;

  // Ops safety
  DISABLE_SEED?: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Allow CORS preflight unauthenticated
    if (request.method === "OPTIONS") {
      return corsResponse(new Response(null, { status: 204 }));
    }

    // Auth check (single operator)
    const apiKey = request.headers.get("x-api-key");
    if (apiKey !== env.API_KEY) {
      return corsResponse(
        new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { "content-type": "application/json" },
        }),
      );
    }

    const url = new URL(request.url);
    const path = url.pathname;

    try {
      // Seed route (bootstrap)
      if (path === "/api/permits/seed") {
        return corsResponse(await handleSeedPermits(request, env));
      }

      // For all other routes, create db wrapper once
      const db = createDb(env.DB);

      if (path.startsWith("/api/permits")) {
        return corsResponse(await handlePermits(request, db, env));
      }
      if (path.startsWith("/api/reports")) {
        return corsResponse(await handleReports(request, db, env));
      }
      if (path.startsWith("/api/entities")) {
        return corsResponse(await handleEntities(request, db, env));
      }
      if (path.startsWith("/api/exports")) {
        return corsResponse(await handleExports(request, db, env));
      }

      return corsResponse(
        new Response(JSON.stringify({ error: "Not found" }), {
          status: 404,
          headers: { "content-type": "application/json" },
        }),
      );
    } catch (err) {
      logger.error("Unhandled worker error", { path, err: String(err) });
      return corsResponse(
        new Response(JSON.stringify({ error: "Internal server error" }), {
          status: 500,
          headers: { "content-type": "application/json" },
        }),
      );
    }
  },

  // Cloudflare Queues consumer handler (required when [[queues.consumers]] is configured)
  async queue(batch: any, env: Env): Promise<void> {
    await handlePipelineQueue(batch, env);
  },
};

function corsResponse(r: Response): Response {
  const headers = new Headers(r.headers);
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type, x-api-key");
  return new Response(r.body, { status: r.status, statusText: r.statusText, headers });
}
