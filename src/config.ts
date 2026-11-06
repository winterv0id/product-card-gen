import "dotenv/config";

function num(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return value !== undefined && Number.isFinite(n) && n >= 0 ? n : fallback;
}

export const config = {
  baseUrl: (process.env.OLLAMA_BASE_URL ?? "http://localhost:11434").replace(/\/$/, ""),
  model: process.env.OLLAMA_MODEL ?? "qwen3:4b",
  timeoutMs: num(process.env.LLM_TIMEOUT_MS, 300_000),
  maxRetries: num(process.env.LLM_MAX_RETRIES, 2),
  numCtx: num(process.env.OLLAMA_NUM_CTX, 8192),
  logLevel: process.env.LOG_LEVEL, // debug | info | warn | error | silent
};

export const NO_DATA = "данных нет";

// Лимиты из условия задания
export const LIMITS = {
  titleMax: 70,
  descriptionMin: 800,
  descriptionMax: 1200,
  queriesMin: 3,
  queriesMax: 5,
};
