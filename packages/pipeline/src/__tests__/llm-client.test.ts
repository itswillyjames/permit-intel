// packages/pipeline/src/__tests__/llm-client.test.ts
import { describe, it, expect, vi } from "vitest";
import { LLMClient, RetryableProviderError } from "../providers/llm-client.js";
import { MockProvider } from "../providers/adapters.js";

const VALID_PERMIT_PARSE = JSON.stringify({
  permit: {
    project_type: "commercial",
    scope_summary: "12,000 sqft office renovation",
    estimated_size_sqft: 12000,
    buyer_fit: { score: 0.85, reasons: ["high valuation"] },
  },
});

describe("LLMClient retry and fallback", () => {
  it("returns valid output on first try", async () => {
    const mock = new MockProvider();
    mock.setResponse("permit_parse", VALID_PERMIT_PARSE);
    const client = new LLMClient({
      providers: [mock],
      retryPolicy: { maxAttemptsPerProvider: 3, baseDelayMs: 0, maxDelayMs: 0, backoffFactor: 2 },
    });
    const result = await client.callStage("permit_parse", {
      prompt: "stage: permit_parse\ntest",
    });
    expect(result.parsed).toBeTruthy();
    expect((result.parsed as any).permit.project_type).toBe("commercial");
    expect(mock.getCallCount()).toBe(1);
  });

  it("retries on transient failure and succeeds", async () => {
    const mock = new MockProvider();
    mock.setResponse("permit_parse", VALID_PERMIT_PARSE);
    mock.setFailFirst(2); // fail first 2 attempts
    const client = new LLMClient({
      providers: [mock],
      retryPolicy: { maxAttemptsPerProvider: 3, baseDelayMs: 0, maxDelayMs: 0, backoffFactor: 2 },
    });
    const result = await client.callStage("permit_parse", {
      prompt: "stage: permit_parse\ntest",
    });
    expect(result.parsed).toBeTruthy();
    expect(mock.getCallCount()).toBe(3);
  });

  it("falls back to secondary provider when primary exhausted", async () => {
    const primary = new MockProvider();
    primary.setFailFirst(99); // always fail
    const fallback = new MockProvider();
    fallback.setResponse("permit_parse", VALID_PERMIT_PARSE);

    const client = new LLMClient({
      providers: [primary, fallback],
      retryPolicy: { maxAttemptsPerProvider: 2, baseDelayMs: 0, maxDelayMs: 0, backoffFactor: 2 },
    });
    const result = await client.callStage("permit_parse", {
      prompt: "stage: permit_parse\ntest",
    });
    expect(result.parsed).toBeTruthy();
    expect(fallback.getCallCount()).toBe(1);
  });

  it("records attempt events via callback", async () => {
    const mock = new MockProvider();
    mock.setResponse("permit_parse", VALID_PERMIT_PARSE);
    mock.setFailFirst(1);
    const client = new LLMClient({
      providers: [mock],
      retryPolicy: { maxAttemptsPerProvider: 3, baseDelayMs: 0, maxDelayMs: 0, backoffFactor: 2 },
    });

    const events: string[] = [];
    await client.callStage(
      "permit_parse",
      { prompt: "stage: permit_parse\ntest" },
      async (provider, attemptNo, outcome) => {
        events.push(`${provider}:${attemptNo}:${outcome}`);
      },
    );

    expect(events).toContain("mock:1:retryable");
    expect(events).toContain("mock:2:success");
  });

  it("throws when all providers exhausted", async () => {
    const mock = new MockProvider();
    mock.setFailFirst(99);
    const client = new LLMClient({
      providers: [mock],
      retryPolicy: { maxAttemptsPerProvider: 2, baseDelayMs: 0, maxDelayMs: 0, backoffFactor: 2 },
    });
    await expect(
      client.callStage("permit_parse", { prompt: "stage: permit_parse\ntest" }),
    ).rejects.toThrow();
  });

  it("throws ValidationError when output is invalid JSON", async () => {
    const mock = new MockProvider();
    mock.setResponse("permit_parse", "not json {{{{");
    const client = new LLMClient({
      providers: [mock],
      retryPolicy: { maxAttemptsPerProvider: 1, baseDelayMs: 0, maxDelayMs: 0, backoffFactor: 2 },
    });
    await expect(
      client.callStage("permit_parse", { prompt: "stage: permit_parse\ntest" }),
    ).rejects.toThrow();
  });
});
