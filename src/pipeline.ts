import { config } from "./config.js";
import type { ChatFn, ChatMessage } from "./llm.js";
import { logger } from "./logger.js";
import { checkGenerated, type Issue } from "./postcheck.js";
import { buildFeedbackPrompt, buildRepairMessages, buildSystemPrompt, buildUserPrompt } from "./prompts.js";
import { GeneratedSchema, type Generated, type ProductCard, type ProductInput } from "./schema.js";
import { buildKeySpecs, descriptionBounds, findMissing, type DescriptionBounds } from "./validate.js";

/** Достаёт JSON из ответа, даже если модель обернула его в ```json или добавила текст вокруг. */
export function extractJson(raw: string): unknown {
  const cleaned = raw.replace(/```(?:json)?/gi, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("в ответе нет JSON-объекта");
  return JSON.parse(cleaned.slice(start, end + 1));
}

/** Температура растёт с каждой попыткой: при низкой модель повторяет прошлый ответ слово в слово. */
const retryTemperature = (attempt: number) => Math.min(0.3 + attempt * 0.25, 1.55);

/** Обрезает текст по границе предложения до max символов. */
export function truncateAtSentence(text: string, max: number): string {
  let out = "";
  for (const sentence of text.trim().split(/(?<=[.!?…])\s+/)) {
    const next = out ? `${out} ${sentence}` : sentence;
    if (next.length > max) break;
    out = next;
  }
  if (out) return out;
  const cut = text.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return (space > 0 ? cut.slice(0, space) : cut).trimEnd();
}

/** Убирает кавычки и префикс «Текст:» вокруг ответа модели. */
function cleanText(raw: string): string {
  return raw
    .trim()
    .replace(/^(?:текст|результат)\s*:\s*/i, "")
    .replace(/^["«»“”]+|["«»“”]+$/g, "")
    .trim();
}

/** Насколько длина выходит за границы (0 — в норме); не заданная граница не учитывается. */
const rangeGap = (len: number, { min, max }: DescriptionBounds) =>
  min !== undefined && len < min ? min - len : max !== undefined && len > max ? len - max : 0;

/** Правит длину seo_description отдельными запросами; если не вышло — обрезает по предложению. */
async function repairDescription(
  product: ProductInput,
  chat: ChatFn,
  description: string,
  maxRetries: number,
): Promise<{ text: string; note?: string }> {
  const bounds = descriptionBounds(product);
  let best = description;
  for (let i = 0; i < maxRetries && rangeGap(best.length, bounds) > 0; i++) {
    const raw = await chat(buildRepairMessages(product, best), {
      temperature: retryTemperature(i + 1),
      json: false,
    });
    const candidate = cleanText(raw);
    logger.info(`правка описания ${i + 1}/${maxRetries}: ${best.length} → ${candidate.length} симв.`);
    if (candidate && rangeGap(candidate.length, bounds) < rangeGap(best.length, bounds)) best = candidate;
    else logger.info("    → вариант не приблизился к норме, оставлен предыдущий");
  }

  if (bounds.max !== undefined && best.length > bounds.max) {
    best = truncateAtSentence(best, bounds.max);
    logger.warn(`описание обрезано по границе предложения до ${best.length} симв.`);
    return { text: best, note: "описание автоматически обрезано по границе предложения до лимита" };
  }
  return { text: best };
}

/** Генерация текстов с проверкой и повторными попытками. */
export async function generateTexts(
  product: ProductInput,
  chat: ChatFn,
  maxRetries = config.maxRetries,
): Promise<{ generated: Generated; warnings: string[]; attempts: number }> {
  const messages: ChatMessage[] = [
    { role: "system", content: buildSystemPrompt(product) },
    { role: "user", content: buildUserPrompt(product) },
  ];
  let last: { generated: Generated; issues: Issue[] } | undefined;
  let attempts = 0;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    attempts = attempt + 1;
    const tag = `попытка ${attempts}/${maxRetries}`;
    const raw = await chat(messages, { temperature: retryTemperature(attempt) });
    let issues: Issue[];
    try {
      const generated = GeneratedSchema.parse(extractJson(raw));
      issues = checkGenerated(generated, product);
      last = { generated, issues };
      const sizes = `заголовок ${generated.seo_title.trim().length}, описание ${generated.seo_description.trim().length} симв.`;
      if (issues.length === 0) {
        logger.info(`${tag}: проверки пройдены (${sizes})`);
        return { generated, warnings: [], attempts };
      }
      logger.warn(`${tag}: проверки не пройдены (${sizes})`);
      for (const issue of issues) logger.info(`    - ${issue.message}`);
      // Если проблема только в длине описания, JSON не перегенерируем, длину правит отдельный запрос ниже.
      if (issues.every((i) => i.code === "description_length")) {
        logger.info("    → правка описания отдельным запросом");
        break;
      }
    } catch (e) {
      issues = [{ message: `ответ не является корректным JSON по схеме (${(e as Error).message.slice(0, 200)})` }];
      logger.warn(`${tag}: ответ модели не разобран`);
      for (const issue of issues) logger.info(`    - ${issue.message}`);
    }
    logger.info(attempt < maxRetries ? "    → повторная генерация с указанием проблем" : "    → попытки исчерпаны");
    messages.push({ role: "assistant", content: raw }, { role: "user", content: buildFeedbackPrompt(issues) });
  }

  if (!last) throw new Error(`Модель не вернула валидный JSON за ${maxRetries} попыток`);

  let { generated, issues } = last;
  const notes: string[] = [];
  if (issues.some((i) => i.code === "description_length")) {
    const repaired = await repairDescription(product, chat, generated.seo_description.trim(), maxRetries);
    generated = { ...generated, seo_description: repaired.text };
    if (repaired.note) notes.push(repaired.note);
    issues = checkGenerated(generated, product);
    if (issues.length === 0) logger.info(`описание в норме: ${repaired.text.length} симв.`);
  }

  return {
    generated,
    warnings: [
      ...notes.map((n) => `Описание: ${n}`),
      ...issues.map((i) => `Не удалось устранить автоматически: ${i.message}`),
    ],
    attempts,
  };
}

export async function buildCard(product: ProductInput, chat: ChatFn): Promise<ProductCard> {
  const { generated, warnings } = await generateTexts(product, chat);
  return {
    product: { name: product.name, manufacturer: product.manufacturer },
    seo_title: generated.seo_title.trim(),
    seo_description: generated.seo_description.trim(),
    key_specs: buildKeySpecs(product),
    search_queries: generated.search_queries.map((q) => q.trim()).filter(Boolean),
    commercial_block: generated.commercial_block,
    missing_data: findMissing(product),
    warnings,
  };
}
