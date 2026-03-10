/**
 * Cloudflare Worker entrypoint.
 * Routes: /api/permits, /api/reports, /api/entities, /api/exports
 * Queue consumer: PIPELINE_QUEUE
 */

import { createDb } from "@permit-intel/db/src/client.js";
import { handlePermits } from "./routes/permits.js";
import { handleReports } from "./routes/reports.js";
import { handleEntities } from "./routes/entities.js";
import { handleExports } from "./routes/exports.js";
import { logger } from "@permit-intel/shared/src/utils/index";
import { handlePipelineQueue } from "./consumers/pipeline.js";
import { handleSeedPermits } from "./routes/seed.js";

export interface Env {
  DB: D1Database;
  OPENAI_API_KEY: string;
  ANTHROPIC_API_KEY: string;
  API_KEY: string;
  PIPELINE_QUEUE: Queue;
  // Optional: set as a Worker var/secret to disable seeding in prod
  DISABLE_SEED?: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Auth check (single operator)
    const apiKey = request.headers.get("x-api-key");
    if (apiKey !== env.API_KEY) {
      // Allow OPTIONS without auth (CORS preflight)
      if (request.method === "OPTIONS") return corsResponse(new Response(null, { status: 204 }));
      return corsResponse(new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }));
    }

    const url = new URL(request.url);
    const db = createDb(env.DB);

    try {
      let response: Response;
      const path = url.pathname;

      // Seed route (bootstrap)
      if (path === "/api/permits/seed") {
        response = await handleSeedPermits(request, env);
      } else if (path.startsWith("/api/permits")) {
        response = await handlePermits(request, db, env);
      } else if (path.startsWith("/api/reports")) {
        response = await handleReports(request, db, env);
      } else if (path.startsWith("/api/entities")) {
        response = await handleEntities(request, db, env);
      } else if (path.startsWith("/api/exports")) {
        response = await handleExports(request, db, env);
      } else {
        response = new Response(JSON.stringify({ error: "Not found" }), { status: 404 });
      }

      return corsResponse(response);
    } catch (err) {
      logger.error("Unhandled worker error", { path: url.pathname, err: String(err) });
      return corsResponse(
        new Response(JSON.stringify({ error: "Internal server error" }), { status: 500 }),
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
