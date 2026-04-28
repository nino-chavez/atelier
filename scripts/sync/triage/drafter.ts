// Triage drafter: ExternalComment + Classification -> proposal body.
//
// Per ARCH 6.5: "Drafter generates proposed change as patch/diff."
// Per ARCH 6.5.2 (Figma): for design-source comments the proposal carries
// a structured payload, not a patch (no patch can be auto-generated from
// a design comment).
//
// M1 implementation: emits a structured markdown body that includes the
// verbatim comment, classification, and a suggested action stub. Patch
// generation is a v1.x feature -- M1 captures the comment faithfully so
// the reviewer can decide.

import type { ExternalComment } from '../lib/adapters.ts';
import type { Classification, Category } from './classifier.ts';

export interface DraftedProposal {
  category: Category;
  confidence: number;
  bodyMarkdown: string;
  suggestedAction: string;
  /** Discipline routes the contribution.kind on creation. M1 default: implementation. */
  discipline: 'implementation' | 'research' | 'design';
}

const SUGGESTED_ACTION: Record<Category, string> = {
  typo:       'Apply the correction inline. No design review needed.',
  scope:      'Decide whether to incorporate as-is, defer to a follow-up contribution, or close.',
  question:   'Answer in-line on the source comment, then close the proposal.',
  pushback:   'Engage the commenter; if substantive, escalate to a fresh contribution.',
  'off-topic':'Close with a brief reason; the source-comment thread continues separately.',
};

export function draftProposal(input: { comment: ExternalComment; classification: Classification }): DraftedProposal {
  const { comment, classification } = input;
  const lines: string[] = [];
  lines.push(`# Triage proposal: ${classification.category}`);
  lines.push('');
  lines.push(`Source: \`${comment.source}\` comment ${comment.externalCommentId}`);
  lines.push(`Author: ${comment.externalAuthor}`);
  lines.push(`Confidence: ${classification.confidence.toFixed(2)} (signals: ${classification.signals.join(', ') || 'none'})`);
  lines.push('');
  lines.push('## Verbatim');
  lines.push('');
  lines.push('> ' + comment.text.split('\n').join('\n> '));
  lines.push('');
  lines.push('## Suggested action');
  lines.push('');
  lines.push(SUGGESTED_ACTION[classification.category]);
  if (Object.keys(comment.context).length > 0) {
    lines.push('');
    lines.push('## Source context');
    lines.push('');
    lines.push('```json');
    lines.push(JSON.stringify(comment.context, null, 2));
    lines.push('```');
  }

  // Discipline routing: figma + design_component context -> design,
  // research_artifact context -> research, else implementation. v1.x can
  // refine via per-territory mapping.
  const ctxKind = String(comment.context['scope_kind'] ?? '');
  const discipline: DraftedProposal['discipline'] =
    ctxKind === 'design_component' ? 'design'
    : ctxKind === 'research_artifact' ? 'research'
    : 'implementation';

  return {
    category: classification.category,
    confidence: classification.confidence,
    bodyMarkdown: lines.join('\n') + '\n',
    suggestedAction: SUGGESTED_ACTION[classification.category],
    discipline,
  };
}
