import { LIMITS, NO_DATA } from "./config.js";
import type { ProductCard } from "./schema.js";

/** Собирает карточку в Markdown для копирования. */
export function renderMarkdown(c: ProductCard): string {
  const lines: string[] = [];
  lines.push(`# ${c.product.name}`, "");
  lines.push(`## SEO-заголовок (${c.seo_title.length} симв.)`, "", c.seo_title, "");
  lines.push(`## SEO-описание (${c.seo_description.length} симв.)`, "", c.seo_description, "");
  lines.push("## Ключевые характеристики", "");
  if (c.key_specs.length === 0) {
    lines.push(NO_DATA);
  } else {
    const esc = (t: string) => t.replace(/\|/g, "\\|");
    lines.push("| Характеристика | Значение |", "|---|---|");
    for (const s of c.key_specs) lines.push(`| ${esc(s.name)} | ${esc(s.value)} |`);
  }
  lines.push("", "## Поисковые запросы", "");
  for (const q of c.search_queries) lines.push(`- ${q}`);
  lines.push("", "## Для менеджера", "");
  lines.push(`**Кому подходит:** ${c.commercial_block.suitable_for}`, "");
  lines.push(`**Какие задачи решает:** ${c.commercial_block.tasks}`, "");
  if (c.missing_data.length) {
    lines.push("## Требует уточнения", "");
    for (const m of c.missing_data) lines.push(`- ${m}`);
    lines.push("");
  }
  if (c.warnings.length) {
    lines.push("## Предупреждения", "");
    for (const w of c.warnings) lines.push(`- ${w}`);
    lines.push("");
  }
  return lines.join("\n");
}
