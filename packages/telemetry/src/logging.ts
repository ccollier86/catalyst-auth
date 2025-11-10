export type CatalystLogLevel = "debug" | "info" | "warn" | "error";

export interface CatalystLoggerOptions {
  readonly name?: string;
  readonly level?: CatalystLogLevel;
  readonly fields?: Record<string, unknown>;
}

export interface CatalystLogger {
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
  child(context: Record<string, unknown>): CatalystLogger;
}

const LOG_LEVEL_PRIORITY: Record<CatalystLogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export const createCatalystLogger = (options: CatalystLoggerOptions = {}): CatalystLogger => {
  const name = options.name ?? "catalyst";
  const level = options.level ?? "info";
  const baseFields = {
    service: name,
    ...options.fields,
  } satisfies Record<string, unknown>;

  const threshold = LOG_LEVEL_PRIORITY[level];

  const createInstance = (contextFields: Record<string, unknown>): CatalystLogger => {
    const serialize = (levelName: CatalystLogLevel, message: string, context?: Record<string, unknown>) => {
      if (LOG_LEVEL_PRIORITY[levelName] < threshold) {
        return;
      }

      const payload = {
        timestamp: new Date().toISOString(),
        level: levelName,
        message,
        ...contextFields,
        ...context,
      } satisfies Record<string, unknown>;

      const line = JSON.stringify(payload);
      if (levelName === "error") {
        console.error(line);
      } else if (levelName === "warn") {
        console.warn(line);
      } else {
        console.log(line);
      }
    };

    return {
      debug(message, context) {
        serialize("debug", message, context);
      },
      info(message, context) {
        serialize("info", message, context);
      },
      warn(message, context) {
        serialize("warn", message, context);
      },
      error(message, context) {
        serialize("error", message, context);
      },
      child(additionalFields) {
        return createInstance({ ...contextFields, ...additionalFields });
      },
    } satisfies CatalystLogger;
  };

  return createInstance(baseFields);
};
