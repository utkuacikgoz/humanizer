import { extractProtectedContent } from "./protected-content";
import { clampScore, normalizeForComparison } from "./text";
import type { ProtectedContent, VerificationIssue, VerificationProvider, VerificationRequest, VerificationResult } from "./types";

const STOP_WORDS = new Set("a additionally an and are as at be been being but by can conclusion could did do does for from furthermore had has have he her hers him his i if important in into is it its may might more moreover most must my no nor not note of on or our ours she should so summary than that the their theirs them then there these they this those to too us was we were what when where which who will with would you your yours".split(" "));
const NEGATIONS = new Set(["no", "not", "never", "neither", "without", "cannot", "can't", "won't", "didn't", "isn't", "wasn't"]);

function terms(text: string): string[] {
  const canonical = text.toLowerCase()
    .replace(/\bmoreover\b/g, "more importantly")
    .replace(/\b(?:leverage|utilize)\b/g, "use")
    .replace(/\brobust solutions?\b/g, "reliable approach")
    .replace(/\bdrive value\b/g, "help")
    .replace(/\bat scale\b/g, "across the organization")
    .replace(/\bmultifaceted\b/g, "complex")
    .replace(/\bstrategic alignment\b/g, "shared priorities")
    .replace(/\bmoving forward\b/g, "from here")
    .replace(/\bthe fact of the matter is that\b/g, "");
  return (canonical.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) ?? []).filter((term) => !STOP_WORDS.has(term) && term.length > 2);
}

function countExact(text: string, value: string): number {
  if (!value) return 0;
  let count = 0;
  let cursor = 0;
  while ((cursor = text.indexOf(value, cursor)) >= 0) {
    count += 1;
    cursor += value.length;
  }
  return count;
}

function uniqueOccurrences(items: ProtectedContent[]): ProtectedContent[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.kind}:${item.value}:${item.start}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export class DeterministicVerificationProvider implements VerificationProvider {
  readonly name = "deterministic-semantic-v1";

  async verify(request: VerificationRequest): Promise<VerificationResult> {
    const issues: VerificationIssue[] = [];
    const protectedItems = uniqueOccurrences(request.protectedContent);
    let preserved = 0;
    const valuesSeen = new Map<string, number>();

    for (const item of protectedItems) {
      const occurrence = valuesSeen.get(item.value) ?? 0;
      valuesSeen.set(item.value, occurrence + 1);
      if (countExact(request.candidate, item.value) > occurrence) {
        preserved += 1;
      } else {
        const kind = item.kind === "citation" || item.kind === "reference"
          ? "citation-damage"
          : item.kind === "number" || item.kind === "percentage" || item.kind === "currency" || item.kind === "date"
            ? "altered-quantity"
            : "missing-protected-content";
        issues.push({ kind, message: `${item.kind} was removed or altered: ${item.value}`, originalRange: { start: item.start, end: item.end } });
      }
    }

    const originalTerms = terms(request.original);
    const candidateTerms = new Set(terms(request.candidate));
    const retainedTerms = originalTerms.filter((term) => candidateTerms.has(term)).length;
    const lexicalCoverage = originalTerms.length ? retainedTerms / originalTerms.length : 1;
    const originalWords = new Set(normalizeForComparison(request.original.toLowerCase()).match(/[\p{L}]+(?:['’][\p{L}]+)?/gu) ?? []);
    const candidateWords = new Set(normalizeForComparison(request.candidate.toLowerCase()).match(/[\p{L}]+(?:['’][\p{L}]+)?/gu) ?? []);
    const originalNegations = [...NEGATIONS].filter((term) => originalWords.has(term));
    const negationsPreserved = originalNegations.every((term) => candidateWords.has(term));

    if (lexicalCoverage < 0.72) {
      issues.push({ kind: "removed-claim", message: "Too many factual anchors disappeared from the candidate." });
    }
    if (!negationsPreserved) {
      issues.push({ kind: "changed-meaning", message: "A negation changed or disappeared." });
    }

    const candidateOnly = [...candidateTerms].filter((term) => !new Set(originalTerms).has(term));
    if (candidateTerms.size > 8 && candidateOnly.length / candidateTerms.size > 0.45) {
      issues.push({ kind: "new-claim", message: "The candidate introduces too much unsupported language." });
    }

    const protectedContentScore = protectedItems.length ? preserved / protectedItems.length : 1;
    const semanticScore = clampScore(lexicalCoverage * 0.72 + protectedContentScore * 0.23 + (negationsPreserved ? 0.05 : 0));
    const passed = protectedContentScore === 1 && semanticScore >= 0.72 && !issues.some((issue) => issue.kind === "changed-meaning" || issue.kind === "new-claim");
    return { passed, semanticScore, protectedContentScore: clampScore(protectedContentScore), issues };
  }
}

export function changedProtectedContent(original: string, candidate: string): ProtectedContent[] {
  const candidateItems = extractProtectedContent(candidate);
  const candidateValues = new Set(candidateItems.map((item) => `${item.kind}:${item.normalizedValue}`));
  return extractProtectedContent(original).filter((item) => !candidateValues.has(`${item.kind}:${item.normalizedValue}`));
}
