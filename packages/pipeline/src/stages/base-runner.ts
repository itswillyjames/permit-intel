// packages/pipeline/src/stages/base-runner.ts
// Base stage runner: handles idempotency, attempt persistence, validation, retry telemetry.

import {
  stageIdempotencyKey,
  hashObject,
  now,
  type Logger,
  RetryableValidationError,
  ValidationError,
} from "@permit-intel/shared";
import type { ReportQueries, StageAttemptRow } from "@permit-intel/db";
import type { LLMClient, LLMCallInput } from "../providers/llm-client.js";

export interface StageRunnerContext {
  reportVersionId: string;
  db: ReportQueries;
  llmClient: LLMClient;
  logger: Logger;
  promptVersion: string;
}

export interface StageRunResult<T> {
  output: T;
  attempt: StageAttemptRow;
  fromCache: boolean;
}

export abstract class BaseStageRunner<TInput, TOutput> {
  abstract readonly stageName: string;

  /** Build the LLM prompt from typed input */
  protected abstract buildPrompt(input: TInput): LLMCallInput;

  /** Cast raw validated output to typed TOutput */
  protected abstract castOutput(validated: unknown): TOutput;

  async run(
    ctx: StageRunnerContext,
    input: TInput,
  ): Promise<StageRunResult<TOutput>> {
    const log = ctx.logger.child({
      stage_name: this.stageName,
      report_version_id: ctx.reportVersionId,
    });

    const inputHash = await hashObject(input);
    const idempotencyKey = await stageIdempotencyKey(
      ctx.reportVersionId,
      this.stageName,
      inputHash,
      ctx.promptVersion,
    );

    // Idempotency guard: return existing if already succeeded
    const { attempt, created } = await ctx.db.createStageAttempt({
      reportVersionId: ctx.reportVersionId,
      stageName: this.stageName,
      idempotencyKey,
      inputHash,
      attemptNo: 1,
    });

    if (!created && attempt.status === "succeeded") {
      log.info("stage:cache_hit", { attempt_id: attempt.id });
      const outputRow = await ctx.db.getStageOutput(attempt.id);
      if (outputRow) {
        return {
          output: this.castOutput(JSON.parse(outputRow.output_json)),
          attempt,
          fromCache: true,
        };
      }
    }

    // Mark as running
    await ctx.db.updateStageAttempt(attempt.id, {
      status: "running",
      started_at: now(),
    });
    await ctx.db.appendStageEvent(attempt.id, "stage:started", {
      stage_name: this.stageName,
    });

    const prompt = this.buildPrompt(input);
    let finalAttempt = attempt;

    try {
      const result = await ctx.llmClient.callStage(
        this.stageName,
        prompt,
        async (provider, attemptNo, outcome, raw, err) => {
          await ctx.db.appendStageEvent(attempt.id, `provider:${outcome}`, {
            provider,
            attempt_no: attemptNo,
            error: err?.message,
            latency_ms: raw?.latency_ms,
            tokens: raw
              ? { in: raw.input_tokens, out: raw.output_tokens }
              : undefined,
          });
          if (outcome === "retryable") {
            await ctx.db.updateStageAttempt(attempt.id, { status: "retrying" });
          }
        },
      );

      // Persist output
      const outputJson = JSON.stringify(result.parsed);
      const { hashObject: _h } = await import("@permit-intel/shared");
      const outputHash = await hashObject(result.parsed);
      await ctx.db.saveStageOutput(attempt.id, outputJson, outputHash);

      // Mark succeeded
      await ctx.db.updateStageAttempt(attempt.id, {
        status: "succeeded",
        provider: result.raw.provider,
        model_id: result.raw.model_id,
        finished_at: now(),
        metrics_json: JSON.stringify({
          latency_ms: result.raw.latency_ms,
          input_tokens: result.raw.input_tokens,
          output_tokens: result.raw.output_tokens,
        }),
      });
      await ctx.db.appendStageEvent(attempt.id, "stage:succeeded", {
        provider: result.raw.provider,
        latency_ms: result.raw.latency_ms,
      });

      finalAttempt = (await ctx.db.findVersionById
        ? attempt
        : attempt) as StageAttemptRow;

      return {
        output: this.castOutput(result.parsed),
        attempt,
        fromCache: false,
      };
    } catch (err) {
      const isTerminal =
        err instanceof ValidationError &&
        !(err instanceof RetryableValidationError);
      const status = isTerminal ? "failed_terminal" : "failed_retryable";
      const errObj = err as Error;

      await ctx.db.updateStageAttempt(attempt.id, {
        status,
        finished_at: now(),
        error_class: errObj.name,
        error_message: errObj.message?.slice(0, 500),
      });
      await ctx.db.appendStageEvent(attempt.id, `stage:${status}`, {
        error_class: errObj.name,
        error_message: errObj.message?.slice(0, 500),
      });

      log.error("stage:failed", err, { status });
      throw err;
    }
  }
}
