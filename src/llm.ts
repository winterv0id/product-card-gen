import { config } from "./config.js";
import { logger } from "./logger.js";
import { generatedJsonSchema } from "./schema.js";

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };
export interface ChatOptions {
  temperature?: number;
  /** false — обычный текстовый ответ без JSON-схемы (для правки отдельного поля). По умолчанию true. */
  json?: boolean;
}
export type ChatFn = (messages: ChatMessage[], options?: ChatOptions) => Promise<string>;

export class LlmError extends Error {}

/** Убирает блок рассуждений Qwen3*/
export function stripThink(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
}

/** Клиент нативного API Ollama (/api/chat) с JSON-схемой ответа. */
export const ollamaChat: ChatFn = async (messages, options) => {
  const temperature = options?.temperature ?? 0.2;
  let res: Response;
  const startedAt = Date.now();
  logger.debug(`запрос к ${config.baseUrl}, модель ${config.model}, сообщений: ${messages.length}, temperature ${temperature}`);
  try {
    res = await fetch(`${config.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: config.model,
        messages,
        stream: false,
        think: false, // отключаем режим размышлений Qwen3
        ...(options?.json === false ? {} : { format: generatedJsonSchema }), // structured output
        options: { temperature, num_ctx: config.numCtx },
      }),
      signal: AbortSignal.timeout(config.timeoutMs),
    });
  } catch (e) {
    if (e instanceof Error && e.name === "TimeoutError") {
      throw new LlmError(
        `Таймаут ${config.timeoutMs} мс. Увеличьте LLM_TIMEOUT_MS или возьмите модель поменьше.`,
      );
    }
    throw new LlmError(
      `Не удалось подключиться к ${config.baseUrl}. Запущен ли Ollama (команда «ollama serve»)?`,
    );
  }

  if (res.status === 404) {
    throw new LlmError(`Модель «${config.model}» не найдена. Выполните: ollama pull ${config.model}`);
  }
  if (!res.ok) {
    throw new LlmError(`Ollama вернул HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }

  logger.debug(`ответ получен за ${((Date.now() - startedAt) / 1000).toFixed(1)} с`);
  const data = (await res.json()) as { message?: { content?: string } };
  const content = stripThink(data.message?.content ?? "");
  if (!content) throw new LlmError("Модель вернула пустой ответ");
  return content;
};
