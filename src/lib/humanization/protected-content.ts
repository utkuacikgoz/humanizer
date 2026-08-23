import type { ProtectedContent, ProtectedContentKind } from "./types";
import { normalizeForComparison } from "./text";

interface ExtractionRule {
  kind: ProtectedContentKind;
  expression: RegExp;
}

const RULES: ExtractionRule[] = [
  { kind: "code", expression: /```[\s\S]*?```|`[^`\n]+`/g },
  { kind: "url", expression: /\bhttps?:\/\/[^\s<>"')\]]+[^\s<>"').,;!?\]}]/gi },
  { kind: "reference", expression: /\b(?:doi:\s*)?10\.\d{4,9}\/[\w.()/:;-]+/gi },
  { kind: "citation", expression: /\((?:[A-Z][\p{L}'’-]+(?:\s+(?:et al\.|&\s+[A-Z][\p{L}'’-]+))?,?\s+)?(?:19|20)\d{2}[a-z]?(?:,\s*p{1,2}\.\s*\d+(?:[-–]\d+)?)?\)|\[(?:\d+(?:[-–,]\s*)?)+\]/gu },
  { kind: "quotation", expression: /“[^”\n]+”|"[^"\n]+"|‘[^’\n]+’|'[^'\n]+'/g },
  { kind: "currency", expression: /(?:[$€£¥]\s?\d\d*(?:,\d{3})*(?:\.\d+)?(?:\s?(?:million|billion|trillion))?|\b\d\d*(?:,\d{3})*(?:\.\d+)?\s?(?:USD|EUR|GBP|JPY)\b)/gi },
  { kind: "percentage", expression: /\b\d+(?:\.\d+)?\s?%/g },
  { kind: "date", expression: /\b(?:19|20)\d{2}-\d{2}-\d{2}\b|\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(?:st|nd|rd|th)?,?\s+(?:19|20)\d{2}\b|\b(?:Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\.?\s+\d{1,2},?\s+(?:19|20)\d{2}\b/gi },
  { kind: "company", expression: /\b(?:(?:[A-Z][\w&.-]*\s+){0,3}(?:Inc\.?|Corp\.?|Corporation|LLC|Ltd\.?|Limited|PLC)|OpenAI|Microsoft|Google|Apple|Amazon|Meta)\b/g },
  { kind: "person", expression: /\b(?:Dr\.|Prof\.|Professor|Mr\.|Ms\.|Mrs\.)\s+[A-Z][\p{L}'’-]+(?:\s+[A-Z][\p{L}'’-]+){0,2}\b|\b[A-Z][\p{L}'’-]+\s+[A-Z][\p{L}'’-]+(?=\s+(?:said|wrote|reported|argued|found|announced|led|joined))\b/gu },
  { kind: "product", expression: /\b[A-Z][A-Za-z0-9+.-]*(?:\s+[A-Z][A-Za-z0-9+.-]*){0,2}\s+v?\d+(?:\.\d+){1,3}\b/g },
  { kind: "technical-term", expression: /\b(?:API|SDK|LLM|JSON|TypeScript|JavaScript|Python|React|SQL|PostgreSQL|OAuth|HTTP|HTTPS|TLS|CPU|GPU|RAM|Kubernetes|Docker|machine learning|large language model|semantic verification)\b/gi },
  { kind: "number", expression: /\b\d+(?:[,.]\d+)*(?:e[+-]?\d+)?\b/gi },
];

export function extractProtectedContent(text: string, protectedTerms: string[] = []): ProtectedContent[] {
  const items: ProtectedContent[] = [];
  const seen = new Set<string>();

  const add = (kind: ProtectedContentKind, value: string, start: number) => {
    const key = `${kind}:${start}:${value.length}`;
    if (seen.has(key)) return;
    seen.add(key);
    items.push({
      id: "",
      kind,
      value,
      start,
      end: start + value.length,
      normalizedValue: normalizeForComparison(value),
    });
  };

  for (const term of protectedTerms.filter(Boolean)) {
    let cursor = 0;
    while (cursor < text.length) {
      const start = text.indexOf(term, cursor);
      if (start < 0) break;
      add("technical-term", term, start);
      cursor = start + Math.max(1, term.length);
    }
  }

  for (const rule of RULES) {
    rule.expression.lastIndex = 0;
    for (const match of text.matchAll(rule.expression)) {
      let value = match[0];
      let start = match.index ?? 0;
      if (rule.kind === "reference") value = value.replace(/[.,;!?]+$/, "");
      if (rule.kind === "product") {
        const leadingVerb = value.match(/^(?:Meet|Deploy)\s+/);
        if (leadingVerb) {
          value = value.slice(leadingVerb[0].length);
          start += leadingVerb[0].length;
        }
      }
      add(rule.kind, value, start);
    }
  }

  return items
    .sort((a, b) => a.start - b.start || b.end - a.end || a.kind.localeCompare(b.kind))
    .map((item, index) => ({ ...item, id: `protected-${index + 1}` }));
}

export function maskProtectedContent(text: string, protectedContent: ProtectedContent[]): {
  text: string;
  restore: (value: string) => string;
} {
  const selected: ProtectedContent[] = [];
  for (const item of [...protectedContent].sort((a, b) => a.start - b.start || b.end - a.end)) {
    if (selected.some((existing) => item.start < existing.end && item.end > existing.start)) continue;
    selected.push(item);
  }

  const replacements = new Map<string, string>();
  let masked = text;
  for (const [index, item] of selected.sort((a, b) => b.start - a.start).entries()) {
    const token = `⟦PROTECTED_${index}_${item.id}⟧`;
    replacements.set(token, item.value);
    masked = `${masked.slice(0, item.start)}${token}${masked.slice(item.end)}`;
  }
  return {
    text: masked,
    restore: (value) => {
      let restored = value;
      for (const [token, original] of replacements) restored = restored.split(token).join(original);
      return restored;
    },
  };
}
