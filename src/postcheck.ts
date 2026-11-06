import { LIMITS } from "./config.js";
import type { Generated, ProductInput } from "./schema.js";
import { descriptionBounds } from "./validate.js";

/** Приводит число к единому виду: «1,60» и «1.6» дают одно и то же. */
function normalizeNumber(raw: string): string {
  const n = Number(raw.replace(",", "."));
  return Number.isFinite(n) ? String(n) : raw;
}

const NUMBER_RE = /\d+(?:[.,]\d+)?/g;

/** Числа из текста; «500 000» учитывается и как 500, 000, и как 500000. */
function extractNumbers(text: string): Set<string> {
  const joined = text.replace(/(\d)[ \u00a0\u202f](?=\d{3}(?!\d))/g, "$1");
  const found = [...(text.match(NUMBER_RE) ?? []), ...(joined.match(NUMBER_RE) ?? [])];
  return new Set(found.map(normalizeNumber));
}

function inputText(p: ProductInput): string {
  return [p.name, p.manufacturer, p.description, ...Object.entries(p.specs).flat()].join("\n");
}

function generatedText(g: Generated): string {
  return [
    g.seo_title,
    g.seo_description,
    ...g.search_queries,
    g.commercial_block.suitable_for,
    g.commercial_block.tasks,
  ].join("\n");
}

/**
 * Проблема результата. message — короткое описание для журнала, предупреждений и замечания модели.
 * Тексты-указания для модели по коду проблемы формируются в prompts.ts.
 */
export interface Issue {
  message: string;
  code?: "title_length" | "description_length" | "unknown_numbers";
  length?: number; // измеренная длина (для title_length и description_length)
}

/** Возвращает список проблем; пустой список — проблем нет. */
export function checkGenerated(g: Generated, p: ProductInput): Issue[] {
  const issues: Issue[] = [];

  const titleLen = g.seo_title.trim().length;
  if (titleLen === 0) issues.push({ message: "seo_title пустой" });
  else if (titleLen > LIMITS.titleMax) {
    issues.push({
      message: `seo_title длиной ${titleLen} символов, нужно не более ${LIMITS.titleMax}`,
      code: "title_length",
      length: titleLen,
    });
  }

  const descLen = g.seo_description.trim().length;
  const { min, max } = descriptionBounds(p);
  if ((min !== undefined && descLen < min) || (max !== undefined && descLen > max)) {
    const need = min === undefined ? `не более ${max}` : `${min}–${max}`;
    issues.push({
      message: `seo_description длиной ${descLen} символов, нужно ${need}`,
      code: "description_length",
      length: descLen,
    });
  }

  const queries = g.search_queries.filter((q) => q.trim() !== "");
  if (queries.length < LIMITS.queriesMin || queries.length > LIMITS.queriesMax) {
    issues.push({
      message: `search_queries содержит ${queries.length} запросов, нужно ${LIMITS.queriesMin}–${LIMITS.queriesMax}`,
    });
  }

  if (!g.commercial_block.suitable_for.trim() || !g.commercial_block.tasks.trim()) {
    issues.push({ message: "commercial_block заполнен не полностью" });
  }

  // Защита от галлюцинаций: любое число в тексте должно встречаться во входных данных.
  const allowed = extractNumbers(inputText(p));
  const unknown = [...extractNumbers(generatedText(g))].filter((n) => !allowed.has(n));
  if (unknown.length > 0) {
    issues.push({
      message: `в тексте есть числа, которых нет во входных данных: ${unknown.join(", ")}`,
      code: "unknown_numbers",
    });
  }

  return issues;
}
