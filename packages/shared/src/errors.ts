/**
 * Typed error hierarchy for the pipeline.
 */

export class PipelineError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly retryable: boolean,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'PipelineError';
  }
}

export class ProviderError extends PipelineError {
  constructor(
    message: string,
    public readonly provider: string,
    public readonly statusCode: number,
    retryable: boolean,
    cause?: unknown,
  ) {
    super(message, 'PROVIDER_ERROR', retryable, cause);
    this.name = 'ProviderError';
  }
}

export class ValidationError extends PipelineError {
  constructor(
    message: string,
    public readonly validationType: 'schema' | 'semantic',
    public readonly details: unknown,
  ) {
    super(message, 'VALIDATION_ERROR', false, undefined);
    this.name = 'ValidationError';
  }
}

export class IdempotencyConflictError extends PipelineError {
  constructor(public readonly existingAttemptId: string) {
    super(`Idempotency key conflict: existing attempt ${existingAttemptId}`, 'IDEMPOTENCY_CONFLICT', false);
    this.name = 'IdempotencyConflictError';
  }
}

export class EntityLockError extends PipelineError {
  constructor(public readonly entityId: string) {
    super(`Entity ${entityId} is locked`, 'ENTITY_LOCKED', false);
    this.name = 'EntityLockError';
  }
}

/** Classify a thrown error as retryable or terminal */
export function classifyError(err: unknown): { retryable: boolean; errorClass: string; message: string } {
  if (err instanceof PipelineError) {
    return {
      retryable: err.retryable,
      errorClass: err.name,
      message: err.message,
    };
  }
  if (err instanceof Error) {
    // Network/transport errors are retryable
    const retryable = /timeout|ECONNRESET|ENOTFOUND|ETIMEDOUT|fetch/i.test(err.message);
    return { retryable, errorClass: err.name, message: err.message };
  }
  return { retryable: false, errorClass: 'UnknownError', message: String(err) };
}
