export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogContext {
  durationMs?: number;
  organizationId?: string;
  requestId?: string;
  route?: string;
  userId?: string;
  [key: string]: unknown;
}

const REDACTED_KEY_PATTERN = /(secret|token|password|key|authorization)/i;

const redact = (value: LogContext): LogContext => {
  if (!value || typeof value !== "object") {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
      key,
      REDACTED_KEY_PATTERN.test(key) ? "[redacted]" : entry,
    ])
  );
};

const getSink = (level: LogLevel) => {
  if (level === "error") {
    return console.error;
  }

  if (level === "warn") {
    return console.warn;
  }

  return console.log;
};

export const createLogger = (base: LogContext = {}) => {
  const write = (
    level: LogLevel,
    message: string,
    context: LogContext = {}
  ) => {
    const payload = {
      level,
      message,
      timestamp: new Date().toISOString(),
      ...redact(base),
      ...redact(context),
    };

    const line =
      process.env.NODE_ENV === "production"
        ? JSON.stringify(payload)
        : `[${level}] ${message}`;
    const sink = getSink(level);
    sink(line, process.env.NODE_ENV === "production" ? undefined : payload);
  };

  return {
    child: (context: LogContext) => createLogger({ ...base, ...context }),
    debug: (message: string, context?: LogContext) =>
      write("debug", message, context),
    error: (message: string, context?: LogContext) =>
      write("error", message, context),
    info: (message: string, context?: LogContext) =>
      write("info", message, context),
    warn: (message: string, context?: LogContext) =>
      write("warn", message, context),
  };
};

export const logger = createLogger();
