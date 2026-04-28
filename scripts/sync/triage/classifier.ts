// Triage classifier: external comment -> { category, confidence }.
//
// Per ARCH 6.5 + 6.5.2 the comment categories are scope | typo | question |
// pushback | off-topic. Below the threshold the comment routes to a
// human-only queue (see route-proposal).
//
// M1 implementation: deterministic keyword/structure heuristic. The seam
// for an LLM-based classifier is the `Classifier` interface; v1.x can
// register a different implementation via the registry without changing
// the drafter or route-proposal modules.

import type { ExternalComment } from '../lib/adapters.ts';

export type Category = 'scope' | 'typo' | 'question' | 'pushback' | 'off-topic';

export interface Classification {
  category: Category;
  confidence: number;
  signals: string[];
}

export interface Classifier {
  readonly name: string;
  classify(comment: ExternalComment): Promise<Classification>;
}

class HeuristicClassifier implements Classifier {
  readonly name = 'heuristic-v1';

  async classify(comment: ExternalComment): Promise<Classification> {
    const text = comment.text.toLowerCase();
    const signals: string[] = [];

    // typo: short, contains spelling-correction patterns
    if (/\b(typo|misspelled|misspelt|spelling)\b/.test(text) || /['"][^'"]+['"]\s*should be\s*['"][^'"]+['"]/.test(text)) {
      signals.push('typo-keyword-or-quoted-correction');
      return { category: 'typo', confidence: 0.85, signals };
    }

    // question: ends with ? or starts with question word, no claim shape
    const isQuestion = /\?\s*$/.test(comment.text.trim()) ||
      /^(what|why|how|when|where|who|which|is|are|does|do|can|should)\b/.test(text);
    if (isQuestion && !/\b(should\s+(not|n't)|wrong|disagree|incorrect)\b/.test(text)) {
      signals.push('question-shape');
      return { category: 'question', confidence: 0.7, signals };
    }

    // pushback: disagreement signals
    if (/\b(disagree|wrong|incorrect|should\s+(not|n't)|won't work|breaks|conflict)\b/.test(text)) {
      signals.push('pushback-keyword');
      return { category: 'pushback', confidence: 0.75, signals };
    }

    // scope: feature-request shape
    if (/\b(also|additionally|we should|need to|missing|add|extend|cover|include)\b/.test(text)) {
      signals.push('scope-keyword');
      return { category: 'scope', confidence: 0.6, signals };
    }

    // off-topic: short or no signal
    signals.push('no-clear-signal');
    return { category: 'off-topic', confidence: 0.4, signals };
  }
}

const registry = new Map<string, Classifier>();
registry.set('heuristic-v1', new HeuristicClassifier());

export function registerClassifier(c: Classifier): void {
  registry.set(c.name, c);
}

export function resolveClassifier(name: string): Classifier {
  const c = registry.get(name);
  if (!c) throw new Error(`no classifier registered for "${name}"`);
  return c;
}
