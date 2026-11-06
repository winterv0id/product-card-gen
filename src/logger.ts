import { config } from "./config.js";

export type LogLevel = "debug" | "info" | "warn" | "error" | "silent";
export type LogSink = (line: string) => void;

const ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3, silent: 4 };

/** Логгер приложения. Пишет в stderr, чтобы журнал не попадал в вывод карточки. */
export class Logger {
  constructor(
    private sink: LogSink = (line) => console.error(line),
    private level: LogLevel = "info",
  ) {}

  /** Заменяет приёмник строк (по умолчанию — stderr). */
  setSink(sink: LogSink): void {
    this.sink = sink;
  }

  debug(message: string): void {
    this.write("debug", `· ${message}`);
  }

  info(message: string): void {
    this.write("info", message);
  }

  warn(message: string): void {
    this.write("warn", `! ${message}`);
  }

  error(message: string): void {
    this.write("error", `✗ ${message}`);
  }

  private write(level: LogLevel, line: string): void {
    if (ORDER[level] >= ORDER[this.level]) this.sink(line);
  }
}

function levelFromEnv(value: string | undefined): LogLevel {
  const v = (value ?? "").toLowerCase();
  return v in ORDER ? (v as LogLevel) : "info";
}

/** Общий экземпляр для всех модулей. */
export const logger = new Logger(undefined, levelFromEnv(config.logLevel));
