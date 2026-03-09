// packages/shared/src/logger.ts
// Structured logger with correlation IDs.
// Outputs JSON lines to console for Cloudflare Workers log tail / Logpush.

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogContext {
  permit_id?: string;
  report_id?: string;
  report_version_id?: string;
  stage_name?: string;
  attempt_id?: string;
  idempotency_key?: string;
  export_id?: string;
  entity_id?: string;
  [key: string]: unknown;
}

export interface LogEntry extends LogContext {
  level: LogLevel;
  message: string;
  timestamp: string;
  service?: string;
  error_class?: string;
  error_message?: string;
  error_stack?: string;
  duration_ms?: number;
  [key: string]: unknown;
}

export class Logger {
  private readonly base: LogContext;
  private readonly service: string;

  constructor(service: string, base: LogContext = {}) {
    this.service = service;
    this.base = base;
  }

  child(extra: LogContext): Logger {
    return new Logger(this.service, { ...this.base, ...extra });
  }

  debug(message: string, extra?: LogContext): void {
    this.emit("debug", message, extra);
  }

  info(message: string, extra?: LogContext): void {
    this.emit("info", message, extra);
  }

  warn(message: string, extra?: LogContext): void {
    this.emit("warn", message, extra);
  }

  error(message: string, err?: unknown, extra?: LogContext): void {
    const errFields = extractError(err);
    this.emit("error", message, { ...extra, ...errFields });
  }

  /** Log an operation with timing */
  async timed<T>(
    label: string,
    fn: () => Promise<T>,
    extra?: LogContext,
  ): Promise<T> {
    const start = Date.now();
    this.debug(`${label}:start`, extra);
    try {
      const result = await fn();
      this.info(`${label}:done`, {
        ...extra,
        duration_ms: Date.now() - start,
      });
      return result;
    } catch (err) {
      this.error(`${label}:error`, err, {
        ...extra,
        duration_ms: Date.now() - start,
      });
      throw err;
    }
  }

  private emit(level: LogLevel, message: string, extra?: LogContext): void {
    const entry: LogEntry = {
      level,
      message,
      timestamp: new Date().toISOString(),
      service: this.service,
      ...this.base,
      ...extra,
    };
    const line = JSON.stringify(entry);
    if (level === "error") {
      console.error(line);
    } else if (level === "warn") {
      console.warn(line);
    } else {
      console.log(line);
    }
  }
}

function extractError(err: unknown): Partial<LogEntry> {
  if (!err) return {};
  if (err instanceof Error) {
    return {
      error_class: err.name,
      error_message: err.message,
      error_stack: err.stack,
    };
  }
  return { error_message: String(err) };
}

/** Default app-level logger */
export const logger = new Logger("permit-intel");
