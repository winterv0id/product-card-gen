import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { parseArgs } from "node:util";
import { config } from "./config.js";
import { loadProducts } from "./input.js";
import { logger } from "./logger.js";
import { LlmError, ollamaChat } from "./llm.js";
import { buildCard } from "./pipeline.js";
import { renderMarkdown } from "./render.js";
import { InputError } from "./validate.js";

const USAGE = `Использование: npm start -- <файл.json | файл.xml> [...] [--out out]`;

function describe(e: unknown): string {
  if (e instanceof InputError || e instanceof LlmError) return e.message;
  return `непредвиденная ошибка: ${(e as Error).message}`;
}

/** Обрабатывает файл целиком; возвращает число товаров, которые не удалось обработать. */
async function processFile(path: string, outDir: string): Promise<number> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    throw new InputError(`Не удалось прочитать файл: ${path}`);
  }
  const { items, notes } = loadProducts(path, raw);
  for (const note of notes) logger.warn(`${path}: ${note}`);

  const base = basename(path, extname(path));
  await mkdir(outDir, { recursive: true });
  let failed = 0;

  for (const item of items) {
    const label = item.id ? `${path} [${item.id}]` : path;
    if (!item.product) {
      failed++;
      logger.error(`${label}: ${item.error}`);
      continue;
    }
    try {
      logger.info(`→ ${label}: генерация (${config.model}, повторов до ${config.maxRetries})...`);
      const card = await buildCard(item.product, ollamaChat);
      const name = item.id ? `${base}_${item.id}` : base;
      await writeFile(join(outDir, `${name}.json`), JSON.stringify(card, null, 2), "utf8");
      const md = renderMarkdown(card);
      await writeFile(join(outDir, `${name}.md`), md, "utf8");
      console.log(md);
    } catch (e) {
      failed++;
      logger.error(`${label}: ${describe(e)}`);
    }
  }
  return failed;
}

async function main(): Promise<number> {
  const { values, positionals } = parseArgs({
    options: { out: { type: "string", default: "out" } },
    allowPositionals: true,
  });
  if (positionals.length === 0) {
    logger.error(USAGE);
    return 2;
  }

  let failed = 0;
  for (const file of positionals) {
    try {
      failed += await processFile(file, values.out as string);
    } catch (e) {
      failed++;
      logger.error(`${file}: ${describe(e)}`);
    }
  }
  return failed === 0 ? 0 : 1;
}

main().then((code) => process.exit(code));
