export type LogLevel = "debug" | "info" | "warn" | "error";

const serializeError = (error: unknown): Record<string, unknown> => {
  if (!(error instanceof Error)) return { error: String(error) };
  return {
    errorName: error.name,
    errorMessage: error.message,
    ...(error.stack ? { stack: error.stack } : {}),
  };
};

export const log = (
  level: LogLevel,
  event: string,
  fields: Record<string, unknown> = {},
): void => {
  const entry = JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    event,
    ...fields,
  });
  if (level === "error") console.error(entry);
  else if (level === "warn") console.warn(entry);
  else console.log(entry);
};

export const logError = (
  event: string,
  error: unknown,
  fields: Record<string, unknown> = {},
): void => log("error", event, { ...fields, ...serializeError(error) });
