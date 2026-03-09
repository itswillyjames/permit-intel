// packages/pipeline/src/providers/adapters.ts
// Concrete LLM provider adapters: Anthropic and OpenAI.

import {
  RetryableProviderError,
  ProviderError,
} from "./llm-client.js";
import type { LLMProvider, LLMCallInput, LLMRawResponse } from "./llm-client.js";

// ============================================================
// ANTHROPIC ADAPTER
// ============================================================

export interface AnthropicAdapterConfig {
  apiKey: string;
  model?: string;
  baseUrl?: string;
}

export class AnthropicProvider implements LLMProvider {
  readonly name = "anthropic";
  private readonly config: Required<AnthropicAdapterConfig>;

  constructor(config: AnthropicAdapterConfig) {
    this.config = {
      apiKey: config.apiKey,
      model: config.model ?? "claude-sonnet-4-20250514",
      baseUrl: config.baseUrl ?? "https://api.anthropic.com",
    };
  }

  async call(input: LLMCallInput): Promise<LLMRawResponse> {
    const start = Date.now();
    const body = {
      model: this.config.model,
      max_tokens: input.maxTokens ?? 4096,
      temperature: input.temperature ?? 0,
      system: input.systemPrompt ?? "You are a structured data extraction assistant. Always respond with valid JSON only.",
      messages: [{ role: "user", content: input.prompt }],
    };

    let res: Response;
    try {
      res = await fetch(`${this.config.baseUrl}/v1/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": this.config.apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      throw new RetryableProviderError("anthropic", undefined, String(err));
    }

    if (res.status === 429 || res.status >= 500) {
      throw new RetryableProviderError("anthropic", res.status);
    }
    if (!res.ok) {
      throw new ProviderError("anthropic", res.status, await res.text());
    }

    const data = await res.json() as {
      content: Array<{ type: string; text: string }>;
      model: string;
      usage: { input_tokens: number; output_tokens: number };
    };

    const text = data.content
      .filter((c) => c.type === "text")
      .map((c) => c.text)
      .join("");

    return {
      content: text,
      model_id: data.model,
      provider: "anthropic",
      latency_ms: Date.now() - start,
      input_tokens: data.usage?.input_tokens ?? 0,
      output_tokens: data.usage?.output_tokens ?? 0,
    };
  }
}

// ============================================================
// OPENAI ADAPTER
// ============================================================

export interface OpenAIAdapterConfig {
  apiKey: string;
  model?: string;
  baseUrl?: string;
}

export class OpenAIProvider implements LLMProvider {
  readonly name = "openai";
  private readonly config: Required<OpenAIAdapterConfig>;

  constructor(config: OpenAIAdapterConfig) {
    this.config = {
      apiKey: config.apiKey,
      model: config.model ?? "gpt-4o",
      baseUrl: config.baseUrl ?? "https://api.openai.com",
    };
  }

  async call(input: LLMCallInput): Promise<LLMRawResponse> {
    const start = Date.now();
    const body = {
      model: this.config.model,
      max_tokens: input.maxTokens ?? 4096,
      temperature: input.temperature ?? 0,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: input.systemPrompt ?? "You are a structured data extraction assistant. Always respond with valid JSON only.",
        },
        { role: "user", content: input.prompt },
      ],
    };

    let res: Response;
    try {
      res = await fetch(`${this.config.baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      throw new RetryableProviderError("openai", undefined, String(err));
    }

    if (res.status === 429 || res.status >= 500) {
      throw new RetryableProviderError("openai", res.status);
    }
    if (!res.ok) {
      throw new ProviderError("openai", res.status, await res.text());
    }

    const data = await res.json() as {
      choices: Array<{ message: { content: string } }>;
      model: string;
      usage: { prompt_tokens: number; completion_tokens: number };
    };

    const text = data.choices?.[0]?.message?.content ?? "";

    return {
      content: text,
      model_id: data.model,
      provider: "openai",
      latency_ms: Date.now() - start,
      input_tokens: data.usage?.prompt_tokens ?? 0,
      output_tokens: data.usage?.completion_tokens ?? 0,
    };
  }
}

// ============================================================
// MOCK PROVIDER (for tests)
// ============================================================

export class MockProvider implements LLMProvider {
  readonly name = "mock";
  private responses: Map<string, string> = new Map();
  private callCount = 0;
  private failFirst = 0;

  setResponse(stageName: string, json: string): void {
    this.responses.set(stageName, json);
  }

  setFailFirst(n: number): void {
    this.failFirst = n;
  }

  async call(input: LLMCallInput): Promise<LLMRawResponse> {
    this.callCount++;
    if (this.callCount <= this.failFirst) {
      throw new RetryableProviderError("mock", 500, "Simulated failure");
    }

    // Extract stage name from prompt for routing
    const stageMatch = input.prompt.match(/stage:\s*(\w+)/i);
    const stage = stageMatch?.[1] ?? "unknown";
    const content = this.responses.get(stage) ?? "{}";

    return {
      content,
      model_id: "mock-1.0",
      provider: "mock",
      latency_ms: 10,
      input_tokens: 100,
      output_tokens: 200,
    };
  }

  getCallCount(): number {
    return this.callCount;
  }
}
