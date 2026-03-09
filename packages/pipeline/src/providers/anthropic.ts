import type { LLMProvider, LLMRequest, LLMResponse } from './types.js';
import { ProviderError } from '@permit-intel/shared/src/errors.js';

export class AnthropicProvider implements LLMProvider {
  readonly name = 'anthropic';
  readonly defaultModel = 'claude-haiku-4-5-20251001';

  constructor(private readonly apiKey: string) {}

  async call(req: LLMRequest): Promise<LLMResponse> {
    const start = Date.now();
    // Separate system messages from user/assistant turns
    const systemMsg = req.messages.find((m) => m.role === 'system')?.content ?? '';
    const messages = req.messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({ role: m.role, content: m.content }));

    const body: Record<string, unknown> = {
      model: req.model ?? this.defaultModel,
      max_tokens: req.max_tokens ?? 2000,
      temperature: req.temperature ?? 0.2,
      messages,
    };
    if (systemMsg) body['system'] = systemMsg;

    let resp: Response;
    try {
      resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      throw new ProviderError(`Anthropic network error: ${err}`, 'anthropic', 0, true, err);
    }

    if (!resp.ok) {
      const retryable = resp.status === 429 || resp.status >= 500;
      const text = await resp.text().catch(() => '');
      throw new ProviderError(`Anthropic HTTP ${resp.status}: ${text.slice(0, 200)}`, 'anthropic', resp.status, retryable);
    }

    const data = await resp.json() as {
      content: Array<{ type: string; text: string }>;
      usage: { input_tokens: number; output_tokens: number };
      model: string;
    };
    const content = data.content?.filter((c) => c.type === 'text').map((c) => c.text).join('') ?? '';

    return {
      content,
      provider: 'anthropic',
      model: data.model,
      latency_ms: Date.now() - start,
      input_tokens: data.usage?.input_tokens ?? 0,
      output_tokens: data.usage?.output_tokens ?? 0,
    };
  }
}
