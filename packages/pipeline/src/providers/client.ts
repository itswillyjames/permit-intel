/**
 * LLMClient — unified provider with failover, retry, telemetry.
 */
import type { LLMProvider, LLMRequest, LLMResponse, RetryPolicy } from './types.js';
import { DEFAULT_RETRY_POLICY } from './types.js';
import { ProviderError, classifyError } from '@permit-intel/shared/src/errors.js';
import { logger } from '@permit-intel/shared/src/utils/index.js';

export interface LLMClientOptions {
  providers: LLMProvider[];
  retryPolicy?: Partial<RetryPolicy>;
}

export interface LLMCallResult extends LLMResponse {
  attemptCount: number;
  providerFallbackUsed: boolean;
}

export class LLMClient {
  private readonly providers: LLMProvider[];
  private readonly policy: RetryPolicy;

  constructor(opts: LLMClientOptions) {
    if (opts.providers.length === 0) throw new Error('LLMClient: at least one provider required');
    this.providers = opts.providers;
    this.policy = { ...DEFAULT_RETRY_POLICY, ...opts.retryPolicy };
  }

  async call(
    req: LLMRequest,
    ctx: { stageAttemptId?: string; stageName?: string } = {},
  ): Promise<LLMCallResult> {
    let providerIndex = 0;
    let attemptCount = 0;
    const providerFallbackUsed = false;

    while (providerIndex < this.providers.length) {
      const provider = this.providers[providerIndex]!;
      let providerAttempt = 0;
      const maxPerProvider = this.policy.maxAttempts;

      while (providerAttempt < maxPerProvider) {
        attemptCount++;
        try {
          const result = await provider.call(req);
          logger.info('LLM call succeeded', {
            ...ctx,
            provider: provider.name,
            model: result.model,
            latency_ms: result.latency_ms,
            attempt_count: attemptCount,
          });
          return { ...result, attemptCount, providerFallbackUsed: providerIndex > 0 };
        } catch (err) {
          const { retryable, errorClass, message } = classifyError(err);
          logger.warn('LLM call failed', {
            ...ctx,
            provider: provider.name,
            error_class: errorClass,
            message,
            retryable,
            provider_attempt: providerAttempt,
          });

          if (!retryable) {
            // Non-retryable on this provider — try next provider
            break;
          }

          providerAttempt++;
          if (providerAttempt < maxPerProvider) {
            const delay = this.policy.backoffMs[providerAttempt - 1] ?? 3000;
            await sleep(delay);
          }
        }
      }

      providerIndex++;
    }

    throw new ProviderError(
      `All providers exhausted after ${attemptCount} attempts`,
      'all',
      0,
      false,
    );
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
