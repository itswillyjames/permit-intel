// packages/pipeline/src/providers/llm-client.ts
// Provider-agnostic LLM client with retry, fallback, telemetry.

import {
  RetryableValidationError,
  ValidationError,
  validateStageOutput,
  type Logger,
} from "@permit-intel/shared";

export interface LLMProvider {
  name: string;
  call(input: LLMCallInput): Promise<LLMRawResponse>;
}

export interface LLMCallInput {
  prompt: string;
  systemPrompt?: string;
  maxTokens?: number;
  temperature?: number;
}

export interface LLMRawResponse {
  content: string;
  model_id: string;
  provider: string;
  latency_ms: number;
  input_tokens: number;
  output_tokens: number;
}

export interface LLMResult {
  parsed: unknown;
  raw: LLMRawResponse;
}

export class ProviderError extends Error {
  constructor(
    public readonly provider: string,
    public readonly status?: number,
    message?: string,
  ) {
    super(message ?? `Provider ${provider} failed (status: ${status ?? "unknown"})`);
    this.name = "ProviderError";
  }
}

export class RetryableProviderError extends ProviderError {
  constructor(provider: string, status?: number, message?: string) {
    super(provider, status, message);
    this.name = "RetryableProviderError";
  }
}

export interface RetryPolicy {
  maxAttemptsPerProvider: number;
  baseDelayMs: number;
  maxDelayMs: number;
  backoffFactor: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttemptsPerProvider: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30_000,
  backoffFactor: 2,
};

export interface LLMClientOptions {
  providers: LLMProvider[];
  retryPolicy?: RetryPolicy;
  logger?: Logger;
}

export class LLMClient {
  private readonly providers: LLMProvider[];
  private readonly policy: RetryPolicy;
  private readonly logger?: Logger;

  constructor(opts: LLMClientOptions) {
    if (opts.providers.length === 0) {
      throw new Error("LLMClient requires at least one provider");
    }
    this.providers = opts.providers;
    this.policy = opts.retryPolicy ?? DEFAULT_RETRY_POLICY;
    this.logger = opts.logger;
  }

  /**
   * Run a stage call with validation, retry, and provider fallback.
   * Returns parsed+validated output or throws ValidationError (terminal).
   */
  async callStage(
    stageName: string,
    input: LLMCallInput,
    onAttempt?: (
      provider: string,
      attemptNo: number,
      result: "success" | "retryable" | "terminal",
      raw?: LLMRawResponse,
      err?: Error,
    ) => Promise<void>,
  ): Promise<LLMResult> {
    let lastError: Error | null = null;

    for (const provider of this.providers) {
      for (let attempt = 1; attempt <= this.policy.maxAttemptsPerProvider; attempt++) {
        const attemptStart = Date.now();
        try {
          this.logger?.debug(`${stageName}:provider_attempt`, {
            stage_name: stageName,
            provider: provider.name,
            attempt_no: attempt,
          });

          const raw = await provider.call(input);
          raw.latency_ms = Date.now() - attemptStart;

          // Parse JSON
          let parsed: unknown;
          try {
            parsed = JSON.parse(raw.content);
          } catch {
            throw new RetryableValidationError(stageName, [
              `JSON parse failed: ${raw.content.slice(0, 200)}`,
            ]);
          }

          // Validate
          const validated = validateStageOutput(stageName, parsed);
          await onAttempt?.(provider.name, attempt, "success", raw);
          return { parsed: validated, raw };
        } catch (err) {
          lastError = err as Error;

          if (err instanceof RetryableValidationError) {
            this.logger?.warn(`${stageName}:retryable_validation`, {
              stage_name: stageName,
              provider: provider.name,
              attempt_no: attempt,
              error_message: err.message,
            });
            await onAttempt?.(provider.name, attempt, "retryable", undefined, err);
            if (attempt < this.policy.maxAttemptsPerProvider) {
              await sleep(this.backoffDelay(attempt));
            }
            continue;
          }

          if (err instanceof ValidationError) {
            // Terminal — do not retry even with same provider
            await onAttempt?.(provider.name, attempt, "terminal", undefined, err);
            throw err;
          }

          if (err instanceof RetryableProviderError) {
            await onAttempt?.(provider.name, attempt, "retryable", undefined, err);
            if (attempt < this.policy.maxAttemptsPerProvider) {
              await sleep(this.backoffDelay(attempt));
            }
            continue;
          }

          // Unknown / terminal provider error
          await onAttempt?.(provider.name, attempt, "terminal", undefined, err as Error);
          break; // try next provider
        }
      }

      this.logger?.warn(`${stageName}:provider_exhausted`, {
        stage_name: stageName,
        provider: provider.name,
      });
    }

    throw lastError ?? new Error(`All providers exhausted for stage ${stageName}`);
  }

  private backoffDelay(attempt: number): number {
    const delay =
      this.policy.baseDelayMs * Math.pow(this.policy.backoffFactor, attempt - 1);
    return Math.min(delay, this.policy.maxDelayMs);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
