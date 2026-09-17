import MiniSearch from "minisearch";
import type { Product } from "./catalog.ts";

export interface LexicalHit {
  product: Product;
  score: number;
  norm: number;
}

export const TOP_K = 30;
export const MAX_PER_TYPE = 6;

const STOPWORDS = new Set(["a", "an", "the", "for", "to", "on", "in", "of", "that", "who", "and", "or", "with", "my", "me", "i", "some", "something", "dont", "don't", "not", "no", "is", "it", "at", "by"]);

export function stem(t: string): string {
  if (t.length > 5 && t.endsWith("ing")) t = t.slice(0, -3);
  else if (t.length > 4 && t.endsWith("ed")) t = t.slice(0, -2);
  else if (t.length > 4 && t.endsWith("es")) t = t.slice(0, -2);
  else if (t.length > 3 && t.endsWith("s") && !t.endsWith("ss")) t = t.slice(0, -1);
  if (t.length > 3 && t.endsWith("e")) t = t.slice(0, -1);
  return t;
}

export function processTerm(term: string): string | null {
  const t = term.toLowerCase().replace(/[^a-z0-9]/g, "");
  return t.length < 2 || STOPWORDS.has(t) ? null : stem(t);
}

export function createIndex(products: Product[]) {
  const index = new MiniSearch<Product>({
    fields: ["title", "description", "category", "attrText"],
    storeFields: ["id"],
    idField: "id",
    extractField: (doc, field) => (field === "attrText" ? Object.values(doc.attributes).join(" ") : (doc as unknown as Record<string, string>)[field]),
    processTerm,
    searchOptions: {
      boost: { title: 2, category: 1.5, description: 1, attrText: 0.5 },
      prefix: true,
      fuzzy: 0.15,
      combineWith: "OR",
    },
  });
  index.addAll(products);
  return index;
}

export function search(index: MiniSearch<Product>, byId: Map<string, Product>, query: string, k = TOP_K): LexicalHit[] {
  const q = query.trim();
  if (!q) return [];
  const raw = index.search(q);
  const max = raw.length ? raw[0].score : 1;
  const hits: LexicalHit[] = [];
  const overflow: LexicalHit[] = [];
  const perType = new Map<string, number>();
  for (const r of raw) {
    if (hits.length >= k) break;
    const product = byId.get(r.id as string);
    if (!product) continue;
    const hit = { product, score: r.score, norm: r.score / max };
    const n = perType.get(product.type) ?? 0;
    if (n >= MAX_PER_TYPE) {
      overflow.push(hit);
      continue;
    }
    perType.set(product.type, n + 1);
    hits.push(hit);
  }
  for (const h of overflow) {
    if (hits.length >= k) break;
    hits.push(h);
  }
  return hits.sort((a, b) => b.score - a.score || a.product.id.localeCompare(b.product.id));
}
