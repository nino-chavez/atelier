// LLM-backed Classifier registered alongside the existing heuristic.
//
// Per Path A (confirmed in the M6 entry strategic call): the existing
// classifier.ts has a Classifier registry seam explicitly designed for
// v1.x to register an LLM classifier without changing the drafter or
// route-proposal modules. This file is that registration, NOT a
// replacement of the heuristic.
//
// Ontology preserved per ARCH §6.5 + §6.5.2: scope | typo | question
// | pushback | off-topic. The user-facing Path A decision was explicit
// that we do NOT introduce a new ontology (proposal/feedback/duplicate/
// noise from the original M6 prompt was rejected to avoid spec
// realignment).
//
// Strategy:
//   - System prompt encodes the 5-cat ontology + per-category criteria
//     extracted from ARCH §6.5/§6.5.2.
//   - User prompt is the verbatim comment + minimal context (source,
//     author).
//   - response_format=json_object so the provider returns parseable
//     JSON directly. Client-side validates the shape before returning.
//   - On classifier failure (LLM unreachable, malformed output,
//     unknown category): fall back to the heuristic. The fallback is
//     load-bearing -- triage MUST always produce a classification, even
//     if degraded.
//
// Registration: `registerClassifier(new LlmClassifier(chatService))`
// in the dispatcher's wiring (or smoke setup). Resolution by name:
// `resolveClassifier('llm-v1')`. The route-proposal handler accepts a
// classifier name via --classifier; the heuristic stays the default.

import type { ChatService } from '../../coordination/adapters/openai-compatible-chat.ts';
import type { ExternalComment } from '../lib/adapters.ts';
import type { Category, Classification, Classifier } from './classifier.ts';
import { resolveClassifier } from './classifier.ts';

const CATEGORY_VALUES: ReadonlyArray<Category> = ['scope', 'typo', 'question', 'pushback', 'off-topic'];

const SYSTEM_PROMPT = `You classify comments on artifacts (PRs, design docs, Figma frames) for a triage substrate. The goal is human-pre-approval routing per ARCH §6.5/§6.5.2.

Categories:
- scope: feature request, additional concerns, "we should also...", missing coverage
- typo: spelling/wording correction; quoted "X should be Y" pattern
- question: information request without a claim; ends with "?" or starts with what/why/how
- pushback: disagreement, "I don't think...", "this is wrong", "won't work"
- off-topic: unrelated to the artifact

Output ONLY a JSON object with this exact shape (no prose, no markdown fence):
{"category": "<one of: scope, typo, question, pushback, off-topic>", "confidence": <number 0..1>, "signals": ["<short reason>", ...]}

Confidence calibration:
- 0.9+ when the comment unambiguously matches one category
- 0.6-0.9 when the comment matches mostly one category with some ambiguity
- 0.3-0.6 when multiple categories are plausible
- below 0.3 when the comment is unclassifiable; pick "off-topic"

The drafter consumes your classification + the verbatim comment. Confidence below the threshold (default 0.5) routes to a human queue per ADR-018.`;

export class LlmClassifier implements Classifier {
  readonly name: string;
  /**
   * Fallback classifier name used when the LLM is unreachable or
   * returns an unparseable response. Default: 'heuristic-v1'.
   */
  private readonly fallbackName: string;

  constructor(
    private readonly chat: ChatService,
    options: { name?: string; fallback?: string } = {},
  ) {
    this.name = options.name ?? 'llm-v1';
    this.fallbackName = options.fallback ?? 'heuristic-v1';
  }

  async classify(comment: ExternalComment): Promise<Classification> {
    const userPrompt = renderUserPrompt(comment);
    let raw: string;
    try {
      const result = await this.chat.complete({
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
        responseFormat: 'json_object',
        temperature: 0,
      });
      raw = result.content;
    } catch (err) {
      // LLM unavailable -- degrade to heuristic. Logging stays out of
      // this module per ADR-029 (named-adapter purity); the caller
      // observes the fallback via classification.signals[0] including
      // the "llm-unavailable-fallback" marker.
      return this.fallback(comment, `llm-unavailable: ${(err as Error).message}`);
    }

    const parsed = parseClassification(raw);
    if (parsed === null) {
      return this.fallback(comment, 'llm-output-unparseable');
    }
    return parsed;
  }

  private async fallback(comment: ExternalComment, reason: string): Promise<Classification> {
    const fb = await resolveClassifier(this.fallbackName).classify(comment);
    return {
      category: fb.category,
      confidence: fb.confidence,
      signals: [`llm-fallback:${reason}`, ...fb.signals],
    };
  }
}

function renderUserPrompt(comment: ExternalComment): string {
  const ctxKeys = Object.keys(comment.context);
  const ctxLine = ctxKeys.length > 0
    ? `\nContext: ${JSON.stringify(comment.context)}`
    : '';
  return `Source: ${comment.source}
Author: ${comment.externalAuthor}${ctxLine}

Comment:
"""
${comment.text}
"""`;
}

function parseClassification(raw: string): Classification | null {
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof obj !== 'object' || obj === null) return null;
  const o = obj as Record<string, unknown>;
  const category = o.category;
  const confidence = o.confidence;
  const signals = o.signals;
  if (typeof category !== 'string' || !CATEGORY_VALUES.includes(category as Category)) {
    return null;
  }
  if (typeof confidence !== 'number' || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    return null;
  }
  if (!Array.isArray(signals) || !signals.every((s) => typeof s === 'string')) {
    return null;
  }
  return {
    category: category as Category,
    confidence,
    signals: signals as string[],
  };
}
