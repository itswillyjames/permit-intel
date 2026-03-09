/**
 * Base stage runner — handles idempotency, attempt logging, validation, retry.
 * All concrete stages extend this.
 */
import type { Db } from '@permit-intel/db/src/client.js';
import {
  getOrCreateStageAttempt,
  updateStageAttempt,
  saveStageOutput,
  appendStageEvent,
  getStageOutput,
} from '@permit-intel/db/src/queries/stages.js';
import type { StageAttemptRow } from '@permit-intel/db/src/queries/stages.js';
import { StageStateMachine } from '@permit-intel/shared/src/state-machine.js';
import { classifyError, ValidationError } from '@permit-intel/shared/src/errors.js';
import { sha256, hashObject, nowIso, logger } from '@permit-intel/shared/src/utils/index.js';
import type { LLMClient } from '../providers/client.js';

export interface StageContext {
  db: Db;
  llm: LLMClient;
  reportVersionId: string;
  idempotencyKey: string;
  stageName: string;
}

export interface StageRunOptions {
  maxRetries?: number;
}

export abstract class BaseStageRunner<TInput, TOutput> {
  abstract readonly stageName: string;
  abstract readonly promptVersion: string;

  /** Build the LLM messages from input */
  protected abstract buildPrompt(input: TInput): Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;

  /** Parse and validate the LLM text response into TOutput */
  protected abstract parseAndValidate(rawResponse: string, input: TInput): TOutput;

  /** Semantic validation — additional invariants beyond schema */
  protected semanticValidate(_output: TOutput, _input: TInput): void {
    // Default: no-op; subclasses override
  }

  async run(
    ctx: StageContext,
    input: TInput,
  ): Promise<{ output: TOutput; attempt: StageAttemptRow; fromCache: boolean }> {
    const inputHash = hashObject(input);

    const { attempt, created } = await getOrCreateStageAttempt(ctx.db, {
      reportVersionId: ctx.reportVersionId,
      stageName: this.stageName,
      idempotencyKey: ctx.idempotencyKey,
      inputHash,
    });

    // If already succeeded, return cached output
    if (attempt.status === 'succeeded') {
      const cached = await getStageOutput(ctx.db, attempt.id);
      if (cached) {
        logger.info('Stage cache hit', {
          stage_name: this.stageName,
          attempt_id: attempt.id,
          report_version_id: ctx.reportVersionId,
          idempotency_key: ctx.idempotencyKey,
        });
        return {
          output: JSON.parse(cached.output_json) as TOutput,
          attempt,
          fromCache: true,
        };
      }
    }

    // Transition to running
    StageStateMachine.assertValid(attempt.status as 'queued', 'running');
    const startedAt = nowIso();
    await updateStageAttempt(ctx.db, attempt.id, { status: 'running', started_at: startedAt });
    await appendStageEvent(ctx.db, attempt.id, 'stage.started', { input_hash: inputHash });

    const logCtx = {
      stage_name: this.stageName,
      attempt_id: attempt.id,
      report_version_id: ctx.reportVersionId,
    };

    try {
      const messages = this.buildPrompt(input);
      const llmResult = await ctx.llm.call(
        { messages, response_format: { type: 'json_object' } },
        logCtx,
      );

      // Record provider choice
      await appendStageEvent(ctx.db, attempt.id, 'provider.used', {
        provider: llmResult.provider,
        model: llmResult.model,
        latency_ms: llmResult.latency_ms,
        fallback: llmResult.providerFallbackUsed,
      });

      // Parse + schema validate
      let parsed: unknown;
      try {
        parsed = JSON.parse(llmResult.content);
      } catch (e) {
        throw new ValidationError(`JSON parse failed: ${e}`, 'schema', llmResult.content.slice(0, 200));
      }

      // Validate against schema
      const output = this.parseAndValidate(parsed, input);

      // Semantic validation
      this.semanticValidate(output, input);

      // Persist output
      const outputJson = JSON.stringify(output);
      const outputHash = sha256(outputJson);
      await saveStageOutput(ctx.db, attempt.id, outputJson, outputHash);

      const finishedAt = nowIso();
      await updateStageAttempt(ctx.db, attempt.id, {
        status: 'succeeded',
        finished_at: finishedAt,
        provider: llmResult.provider,
        model_id: llmResult.model,
        metrics_json: JSON.stringify({
          latency_ms: llmResult.latency_ms,
          input_tokens: llmResult.input_tokens,
          output_tokens: llmResult.output_tokens,
          attempt_count: llmResult.attemptCount,
        }),
      });
      await appendStageEvent(ctx.db, attempt.id, 'stage.succeeded', { output_hash: outputHash });

      logger.info('Stage succeeded', logCtx);
      return { output, attempt: { ...attempt, status: 'succeeded' }, fromCache: false };
    } catch (err) {
      const { retryable, errorClass, message } = classifyError(err);
      const terminalStatus = retryable ? 'failed_retryable' : 'failed_terminal';

      await updateStageAttempt(ctx.db, attempt.id, {
        status: terminalStatus,
        finished_at: nowIso(),
        error_class: errorClass,
        error_message: message,
      });
      await appendStageEvent(ctx.db, attempt.id, 'stage.failed', {
        error_class: errorClass,
        message,
        retryable,
      });

      logger.error('Stage failed', { ...logCtx, error_class: errorClass, message, retryable });
      throw err;
    }
  }
}
