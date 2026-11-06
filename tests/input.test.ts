import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { loadProducts } from "../src/input.js";

const read = (f: string) => readFileSync(new URL(`../examples/${f}`, import.meta.url), "utf8");

test("template.xml даёт два товара без характеристик", () => {
  const { items } = loadProducts("template.xml", read("template.xml"));
  assert.deepEqual(items.map((i) => i.id), ["455683", "168182"]);
  const first = items[0].product!;
  assert.equal(first.name, "ПД100И-ДИ2,5-141-0,25");
  assert.equal(first.manufacturer, "ОВЕН");
  assert.equal(first.description, "датчик давления с торцевой открытой мембраной для вязких загрязнённых сред");
  assert.deepEqual(first.specs, {}); // «Артикул» и «Код товара» — не характеристики
});

test("прочие param из XML считаются характеристиками", () => {
  const xml = '<offer id="1"><name>A</name><param name="Масса">2 кг</param><param name="Артикул">7</param></offer>';
  const { items } = loadProducts("x.xml", xml);
  assert.deepEqual(items[0].product?.specs, { "Масса": "2 кг" });
});

test("XML без offer и битый XML дают понятные ошибки", () => {
  assert.throws(() => loadProducts("x.xml", "<a>1</a>"), /offer/);
  assert.throws(() => loadProducts("x.xml", "<offer><name>A</offer>"), /XML/);
});

test("offer без названия — ошибка только этого товара", () => {
  const xml = '<offer id="1"><vendor>V</vendor></offer><offer id="2"><name>B</name></offer>';
  const { items } = loadProducts("x.xml", xml);
  assert.ok(items[0].error);
  assert.equal(items[1].product?.name, "B");
});
