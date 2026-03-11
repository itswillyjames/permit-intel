import type { LLMProvider, LLMRequest, LLMResponse } from "./types.js";

/**
 * OpenRouter provider (OpenAI-compatible Chat Completions).
 * Base URL: https://openrouter.ai/api/v1
 *
 * Implements LLMProvider:
 * - name
 * - defaultModel
 * - call(req) -> LLMResponse
 */
export class OpenRouterProvider implements LLMProvider {
  readonly name = "openrouter";
  readonly defaultModel: string;

  private apiKey: string;
  private baseUrl: string;
  private appName?: string;

  constructor(
    apiKey: string,
    opts?: {
      baseUrl?: string;
      defaultModel?: string;
      appName?: string;
    },
  ) {
    this.apiKey = apiKey;
    this.baseUrl = (opts?.baseUrl || "https://openrouter.ai/api/v1").replace(/\/+$/, "");
    this.defaultModel = opts?.defaultModel || "nvidia/nemotron-3-super-120b-a12b-20230311:free";
    this.appName = opts?.appName;
  }

  async call(req: LLMRequest): Promise<LLMResponse> {
    const model = req.model || this.defaultModel;
    const url = `${this.baseUrl}/chat/completions`;

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
    };

    // OpenRouter recommends optional attribution headers
    if (this.appName) headers["X-Title"] = this.appName;

    const body: any = {
      model,
      messages: req.messages,
      temperature: req.temperature ?? 0,
    };

    if (req.max_tokens != null) body.max_tokens = req.max_tokens;
    if (req.response_format != null) body.response_format = req.response_format;

    const start = Date.now();
    const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
    const latency_ms = Date.now() - start;

    const rawText = await res.text();
    if (!res.ok) {
      throw new Error(`OpenRouter error ${res.status}: ${rawText}`);
    }

    const json: any = JSON.parse(rawText);

    const content: string = json?.choices?.[0]?.message?.content ?? "";
    const usage = json?.usage || {};

    const input_tokens = Number(usage.prompt_tokens ?? usage.input_tokens ?? 0);
    const output_tokens = Number(usage.completion_tokens ?? usage.output_tokens ?? 0);

    return {
      content,
      provider: this.name,
      model: json?.model ?? model,
      latency_ms,
      input_tokens,
      output_tokens,
    };
  }
}
