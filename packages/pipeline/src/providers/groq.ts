import type { ChatMessage, LLMProvider, LLMResponse } from "./types.js";

export class GroqProvider implements LLMProvider {
  readonly name = "groq";

  private apiKey: string;
  private baseUrl: string;
  private model: string;

  constructor(opts: { apiKey: string; baseUrl: string; model: string }) {
    this.apiKey = opts.apiKey;
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.model = opts.model;
  }

  async chat(messages: ChatMessage[], opts?: { temperature?: number }): Promise<LLMResponse> {
    const url = `${this.baseUrl}/chat/completions`;

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
    };

    const body = {
      model: this.model,
      messages,
      temperature: opts?.temperature ?? 0,
    };

    const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`Groq error ${res.status}: ${txt}`);
    }

    const json: any = await res.json();
    const text = json?.choices?.[0]?.message?.content ?? "";
    return { text, raw: json };
  }
}
