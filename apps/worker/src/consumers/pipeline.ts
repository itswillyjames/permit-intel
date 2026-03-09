/**
 * Queue consumer for pipeline jobs.
 * Receives messages from PIPELINE_QUEUE and runs the orchestrator.
 */
import { createDb } from '@permit-intel/db/src/client.js';
import { runPipeline } from '@permit-intel/pipeline/src/orchestrator/index.js';
import { LLMClient } from '@permit-intel/pipeline/src/providers/client.js';
import { OpenAIProvider } from '@permit-intel/pipeline/src/providers/openai.js';
import { AnthropicProvider } from '@permit-intel/pipeline/src/providers/anthropic.js';
import { logger } from '@permit-intel/shared/src/utils/index.js';
import type { Env } from '../index.js';

interface PipelineMessage {
  type: 'run_pipeline';
  report_id: string;
  report_version_id: string;
}

export async function handlePipelineQueue(
  batch: MessageBatch<PipelineMessage>,
  env: Env,
): Promise<void> {
  const db = createDb(env.DB);
  const llm = new LLMClient({
    providers: [
      new OpenAIProvider(env.OPENAI_API_KEY),
      new AnthropicProvider(env.ANTHROPIC_API_KEY),
    ],
  });

  for (const message of batch.messages) {
    const msg = message.body;
    if (msg.type !== 'run_pipeline') {
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
      logger.error('Pipeline queue job failed', {
        report_id: msg.report_id,
        report_version_id: msg.report_version_id,
        err: String(err),
      });
      message.retry();
    }
  }
}

// Required type stubs for Queue consumer
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
