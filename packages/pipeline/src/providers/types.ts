/**
 * Provider abstraction layer.
 * All LLM providers implement LLMProvider.
 * Stage runners use LLMClient which handles failover + telemetry.
 */

export interface LLMMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface LLMRequest {
  model?: string;
  messages: LLMMessage[];
  max_tokens?: number;
  temperature?: number;
  response_format?: { type: 'json_object' | 'text' };
}

export interface LLMResponse {
  content: string;
  provider: string;
  model: string;
  latency_ms: number;
  input_tokens: number;
  output_tokens: number;
}

export interface LLMProvider {
  readonly name: string;
  readonly defaultModel: string;
  call(req: LLMRequest): Promise<LLMResponse>;
}

/** Retry policy per stage */
export interface RetryPolicy {
  maxAttempts: number;
  backoffMs: number[];
  fallbackProviders: string[];
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 3,
  backoffMs: [1000, 3000, 9000],
  fallbackProviders: ['openai', 'anthropic'],
};
