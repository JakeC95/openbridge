import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

export type LogLevel = "debug" | "info" | "warn" | "error";

function serialiseMeta(meta: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(meta)) {
    if (value instanceof Error) {
      out[key] = { name: value.name, message: value.message, stack: value.stack };
    } else {
      out[key] = value;
    }
  }
  return out;
}

export class Logger {
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {
    void mkdir(dirname(filePath), { recursive: true });
  }

  get path(): string {
    return this.filePath;
  }

  debug(message: string, meta: Record<string, unknown> = {}): void {
    this.write("debug", message, meta);
  }

  info(message: string, meta: Record<string, unknown> = {}): void {
    this.write("info", message, meta);
  }

  warn(message: string, meta: Record<string, unknown> = {}): void {
    this.write("warn", message, meta);
  }

  error(message: string, meta: Record<string, unknown> = {}): void {
    this.write("error", message, meta);
  }

  private write(level: LogLevel, message: string, meta: Record<string, unknown>): void {
    const entry = {
      ...serialiseMeta(meta),
      level,
      message,
      timestamp: new Date().toISOString()
    };
    const line = `${JSON.stringify(entry)}\n`;
    if (level === "error") console.error(message, meta);
    else if (level === "warn") console.warn(message, meta);
    else console.log(message, meta);

    this.queue = this.queue
      .then(() => appendFile(this.filePath, line, "utf8"))
      .catch(() => undefined);
  }
}
