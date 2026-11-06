import assert from "node:assert/strict";
import { test } from "node:test";
import { parseInput } from "./helpers.js";
import type { ChatFn } from "../src/llm.js";
import { logger } from "../src/logger.js";
import { buildCard, generateTexts, truncateAtSentence } from "../src/pipeline.js";
import { checkGenerated } from "../src/postcheck.js";
import { buildFeedbackPrompt } from "../src/prompts.js";
import type { Generated } from "../src/schema.js";

logger.setSink(() => {}); // в тестах журнал не засоряет вывод

const product = parseInput(
  JSON.stringify({
    name: "Манометр DM 02",
    manufacturer: "Манотомь",
    specs: { "диапазон измерений": "0–1,6 МПа", "класс точности": "1,5" },
    description: "Измерение избыточного давления.",
  }),
);

const sentence = "Манометр измеряет избыточное давление в диапазоне 0–1,6 МПа, класс точности 1,5. ";
const good: Generated = {
  seo_title: "Манометр DM 02 Манотомь, 0–1,6 МПа",
  seo_description: sentence.repeat(11).trim(),
  search_queries: ["манометр dm 02", "манометр 1,6 МПа", "купить манометр показывающий"],
  commercial_block: { suitable_for: "Для измерения давления.", tasks: "Контроль давления." },
};
const longText = sentence.repeat(17).trim(); // > 1200 символов
const msgs = (g: Generated) => checkGenerated(g, product).map((i) => i.message);

test("корректный результат проходит проверки", () => {
  assert.deepEqual(checkGenerated(good, product), []);
});

test("выдуманное число обнаруживается", () => {
  assert.match(msgs({ ...good, seo_title: "Манометр DM 02, 250 °C" }).join(), /250/);
});

test("слишком короткое описание и длинный заголовок обнаруживаются", () => {
  const issues = msgs({ ...good, seo_title: "А".repeat(71), seo_description: "коротко" }).join("\n");
  assert.match(issues, /seo_title/);
  assert.match(issues, /seo_description/);
});

test("подсказка для слишком длинного описания: сколько убрать и что убрать", () => {
  const prompt = buildFeedbackPrompt(checkGenerated({ ...good, seo_description: "а".repeat(1374) }, product));
  assert.match(prompt, /не менее 174 симв\./);
  assert.match(prompt, /наименее важную характеристику или наименее важное описание/);
});

test("подсказка для слишком короткого описания: дополнить фактами из входа", () => {
  const prompt = buildFeedbackPrompt(checkGenerated({ ...good, seo_description: "а".repeat(600) }, product));
  assert.match(prompt, /не менее 200 симв\./);
  assert.match(prompt, /ничего не выдумывай/);
});

test("при проблеме не про длину — перегенерация с обратной связью и ростом температуры", async () => {
  const withBadNumber = JSON.stringify({ ...good, seo_title: "Манометр DM 02, 250 °C" });
  const replies = [withBadNumber, JSON.stringify(good)];
  const temps: (number | undefined)[] = [];
  const sizes: number[] = [];
  let calls = 0;
  const chat: ChatFn = async (messages, options) => {
    temps.push(options?.temperature);
    sizes.push(messages.length);
    if (calls === 1) assert.match(messages.at(-1)!.content, /250/);
    return replies[calls++];
  };
  const result = await generateTexts(product, chat, 2);
  assert.equal(result.attempts, 2);
  assert.deepEqual(result.warnings, []);
  assert.deepEqual(temps, [0.3, 0.55]);
  assert.deepEqual(sizes, [2, 4]);
});

test("слишком длинное описание правится отдельным запросом, а не перегенерацией JSON", async () => {
  const calls: { json?: boolean; prompt: string }[] = [];
  const chat: ChatFn = async (messages, options) => {
    calls.push({ json: options?.json, prompt: messages.at(-1)!.content });
    return options?.json === false ? good.seo_description : JSON.stringify({ ...good, seo_description: longText });
  };
  const result = await generateTexts(product, chat, 3);
  assert.equal(calls.length, 2); // одна генерация + одна правка
  assert.equal(calls[1].json, false);
  assert.match(calls[1].prompt, /убери наименее важную характеристику или наименее важное описание/i);
  assert.match(calls[1].prompt, new RegExp(`Сейчас в нём ${longText.length} символов`));
  assert.equal(result.generated.seo_description, good.seo_description);
  assert.deepEqual(result.warnings, []);
});

test("если модель не сокращает текст — обрезка по границе предложения с предупреждением", async () => {
  const chat: ChatFn = async (_m, options) =>
    options?.json === false ? longText : JSON.stringify({ ...good, seo_description: longText });
  const result = await generateTexts(product, chat, 2);
  const d = result.generated.seo_description;
  assert.ok(d.length <= 1200 && d.length >= 800, `длина ${d.length}`);
  assert.ok(d.endsWith("."));
  assert.match(result.warnings.join(), /обрезано/);
});

test("слишком короткое описание дополняется отдельным запросом с данными товара", async () => {
  let repairPrompt = "";
  const chat: ChatFn = async (messages, options) => {
    if (options?.json === false) {
      repairPrompt = messages.at(-1)!.content;
      return good.seo_description;
    }
    return JSON.stringify({ ...good, seo_description: sentence.repeat(3).trim() });
  };
  const result = await generateTexts(product, chat, 2);
  assert.match(repairPrompt, /Расширь текст/);
  assert.match(repairPrompt, /<product_data>/);
  assert.deepEqual(result.warnings, []);
});

test("truncateAtSentence режет по предложению и не превышает лимит", () => {
  const out = truncateAtSentence("Раз. Два три. Четыре пять шесть.", 15);
  assert.equal(out, "Раз. Два три.");
  assert.equal(truncateAtSentence("слово ".repeat(10), 12), "слово слово");
});

test("товар без характеристик: карточка собирается, пропуск отмечен", async () => {
  const bare = parseInput(JSON.stringify({ name: "Прибор", manufacturer: "ОВЕН", description: "датчик" }));
  const text = "Прибор предназначен для измерений, технические характеристики требуют уточнения. ";
  const reply = JSON.stringify({
    seo_title: "Прибор ОВЕН",
    seo_description: text.repeat(11).trim(),
    search_queries: ["прибор овен", "датчик купить", "прибор измерительный"],
    commercial_block: { suitable_for: "Для измерений.", tasks: "Измерение." },
  });
  const card = await buildCard(bare, async () => reply);
  assert.deepEqual(card.key_specs, []);
  assert.match(card.missing_data.join(), /характеристики отсутствуют полностью/);
});
