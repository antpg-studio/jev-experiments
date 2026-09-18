import type { Product } from "./catalog.ts";
import { MAX_LEVEL, type ParsedAnswers, type RelevanceAnswer, type SortPreference } from "./jev.ts";
import type { LexicalHit } from "./retriever.ts";

export interface Weights {
  lexical: number;
  relevance: number;
  category: number;
  price: number;
  gift: number;
  relevanceFloor: number;
  applySort: boolean;
}

export const DEFAULT_WEIGHTS: Weights = {
  lexical: 0.25,
  relevance: 1.0,
  category: 0.25,
  price: 0.4,
  gift: 0.15,
  relevanceFloor: 2,
  applySort: true,
};

export const GATE = { intent: 0.45, noul: 0.6, sort: 0.5 };

export interface RankedItem {
  product: Product;
  lexNorm: number;
  relevance: RelevanceAnswer | null;
  base: number;
  belowFloor: boolean;
  bonuses: { category: number; price: number; gift: number };
}

export interface Ranking {
  items: RankedItem[];
  appliedSort: SortPreference;
  filters: { cheap: boolean; premium: boolean; gift: boolean; intent: string | null };
}

const GIFTABLE = /\b(gift|ages? \d|kids?|children)\b/i;

export function combine(hits: LexicalHit[], answers: ParsedAnswers | null, w: Weights): Ranking {
  const q = answers?.query;
  const prices = hits.map((h) => h.product.price);
  const minP = Math.min(...prices, Infinity);
  const maxP = Math.max(...prices, -Infinity);
  const span = maxP > minP ? maxP - minP : 1;

  const intentActive = !!q && q.intent !== "any" && q.intentConfidence >= GATE.intent;
  const cheap = !!q && q.wantsCheap >= GATE.noul;
  const premium = !!q && q.wantsPremium >= GATE.noul && !cheap;
  const gift = !!q && q.isGift >= GATE.noul;

  const items: RankedItem[] = hits.map((h) => {
    const rel = answers?.relevance.get(h.product.id) ?? null;
    const relNorm = rel ? rel.score / MAX_LEVEL : 0;
    let base = answers ? w.lexical * h.norm + w.relevance * relNorm : h.norm;
    const priceNorm = (h.product.price - minP) / span;
    const bonuses = { category: 0, price: 0, gift: 0 };
    if (q && intentActive && h.product.category === q.intent) bonuses.category = w.category * (q.intentProbabilities[q.intent] ?? 1);
    if (q && cheap) bonuses.price = w.price * (1 - priceNorm) * q.wantsCheap;
    if (q && premium) bonuses.price = w.price * priceNorm * q.wantsPremium;
    if (q && gift && GIFTABLE.test(h.product.description)) bonuses.gift = w.gift * q.isGift;
    base += bonuses.category + bonuses.price + bonuses.gift;
    const belowFloor = !!rel && rel.score < w.relevanceFloor;
    return { product: h.product, lexNorm: h.norm, relevance: rel, base, belowFloor, bonuses };
  });

  let appliedSort: SortPreference = "relevance";
  if (q && w.applySort && q.sort !== "relevance" && q.sortConfidence >= GATE.sort) appliedSort = q.sort;

  const byBase = (a: RankedItem, b: RankedItem) => b.base - a.base || a.product.id.localeCompare(b.product.id);
  const band = (i: RankedItem) => (i.relevance ? Math.floor(i.relevance.score) : 0);
  const bySort = (a: RankedItem, b: RankedItem) => {
    if (appliedSort === "relevance") return byBase(a, b);
    const d = band(b) - band(a);
    if (d) return d;
    if (appliedSort === "price_low") return a.product.price - b.product.price || byBase(a, b);
    if (appliedSort === "price_high") return b.product.price - a.product.price || byBase(a, b);
    return b.product.rating - a.product.rating || byBase(a, b);
  };

  const kept = items.filter((i) => !i.belowFloor).sort(bySort);
  const dropped = items.filter((i) => i.belowFloor).sort(byBase);
  return { items: kept.concat(dropped), appliedSort, filters: { cheap, premium, gift, intent: intentActive && q ? q.intent : null } };
}

export function lexicalOnly(hits: LexicalHit[]): Ranking {
  return combine(hits, null, DEFAULT_WEIGHTS);
}
