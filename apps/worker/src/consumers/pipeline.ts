/**
 * Queue consumer for pipeline jobs.
 * Receives messages from PIPELINE_QUEUE and runs the orchestrator.
 *
 * Production-ready provider strategy:
 * 1) OpenRouter (primary)  — default: nvidia/nemotron-3-super-120b-a12b-20230311:free
 * 2) Groq (fallback)       — default: llama-3.3-70b-versatile
 * 3) OpenAI (optional)
 * 4) Anthropic (optional)
 *
 * No provider is required at deploy time.
 */

import { createDb } from "@permit-intel/db/src/client.js";
import { runPipeline } from "@permit-intel/pipeline/src/orchestrator/index.js";
import { LLMClient } from "@permit-intel/pipeline/src/providers/client.js";
import { OpenAIProvider } from "@permit-intel/pipeline/src/providers/openai.js";
import { AnthropicProvider } from "@permit-intel/pipeline/src/providers/anthropic.js";
import { OpenRouterProvider } from "@permit-intel/pipeline/src/providers/openrouter.js";
import { GroqProvider } from "@permit-intel/pipeline/src/providers/groq.js";
import { logger } from "@permit-intel/shared/src/utils/index";
import type { Env } from "../index.js";

interface PipelineMessage {
  type: "run_pipeline";
  report_id: string;
  report_version_id: string;
}

function buildProviders(env: Env) {
  const providers: any[] = [];

  // 1) OpenRouter primary
  if (env.OPENROUTER_API_KEY) {
    providers.push(
      new OpenRouterProvider(env.OPENROUTER_API_KEY, {
        baseUrl: env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1",
        defaultModel: env.OPENROUTER_MODEL || "nvidia/nemotron-3-super-120b-a12b-20230311:free",
        appName: env.OPENROUTER_APP_NAME || "permit-intel",
      }),
    );
  }

  // 2) Groq fallback
  if (env.GROQ_API_KEY) {
    providers.push(
      new GroqProvider(env.GROQ_API_KEY, {
        baseUrl: env.GROQ_BASE_URL || "https://api.groq.com/openai/v1",
        defaultModel: env.GROQ_MODEL || "llama-3.3-70b-versatile",
      }),
    );
  }

  if (env.OPENAI_API_KEY) providers.push(new OpenAIProvider(env.OPENAI_API_KEY));
  if (env.ANTHROPIC_API_KEY) providers.push(new AnthropicProvider(env.ANTHROPIC_API_KEY));

  return providers;
}

export async function handlePipelineQueue(
  batch: MessageBatch<PipelineMessage>,
  env: Env,
): Promise<void> {
  const db = createDb(env.DB);
  const providers = buildProviders(env);

  if (providers.length === 0) {
    logger.error(
      "No LLM providers configured; ACKing pipeline jobs. Configure OPENROUTER_API_KEY or GROQ_API_KEY.",
      { hint: "Set OPENROUTER_API_KEY for primary routing; set GROQ_API_KEY for fallback." },
    );
    for (const message of batch.messages) message.ack();
    return;
  }

  const llm = new LLMClient({ providers });

  for (const message of batch.messages) {
    const msg = message.body;

    if (msg.type !== "run_pipeline") {
      message.ack();
      continue;
    }

    try {
      await runPipeline({
        db,
        llm,
        reportId: msg.report_id,
        reportVersionId: msg.report_version_id,
      });
      message.ack();
    } catch (err) {
      logger.error("Pipeline queue job failed", {
        report_id: msg.report_id,
        report_version_id: msg.report_version_id,
        err: String(err),
      });
      message.retry();
    }
  }
}

declare global {
  interface MessageBatch<T> {
    messages: Array<Message<T>>;
  }
  interface Message<T> {
    body: T;
    ack(): void;
    retry(): void;
  }
}
