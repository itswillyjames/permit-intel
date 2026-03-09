import type { LLMProvider, LLMRequest, LLMResponse } from './types.js';
import { ProviderError } from '@permit-intel/shared/src/errors.js';

export class OpenAIProvider implements LLMProvider {
  readonly name = 'openai';
  readonly defaultModel = 'gpt-4o-mini';

  constructor(private readonly apiKey: string) {}

  async call(req: LLMRequest): Promise<LLMResponse> {
    const start = Date.now();
    const body = {
      model: req.model ?? this.defaultModel,
      messages: req.messages,
      max_tokens: req.max_tokens ?? 2000,
      temperature: req.temperature ?? 0.2,
      ...(req.response_format ? { response_format: req.response_format } : {}),
    };

    let resp: Response;
    try {
      resp = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      throw new ProviderError(`OpenAI network error: ${err}`, 'openai', 0, true, err);
    }

    if (!resp.ok) {
      const retryable = resp.status === 429 || resp.status >= 500;
      const text = await resp.text().catch(() => '');
      throw new ProviderError(`OpenAI HTTP ${resp.status}: ${text.slice(0, 200)}`, 'openai', resp.status, retryable);
    }

    const data = await resp.json() as {
      choices: Array<{ message: { content: string } }>;
      usage: { prompt_tokens: number; completion_tokens: number };
      model: string;
    };

    return {
      content: data.choices[0]?.message?.content ?? '',
      provider: 'openai',
      model: data.model,
      latency_ms: Date.now() - start,
      input_tokens: data.usage?.prompt_tokens ?? 0,
      output_tokens: data.usage?.completion_tokens ?? 0,
    };
  }
}
