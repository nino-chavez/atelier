#!/usr/bin/env -S npx tsx
//
// Triage route-proposal: drafted proposal -> contribution row.
//
// Per ARCH 6.5 + ADR-033: creates a contribution with kind matching the
// change discipline, requires_owner_approval=true (so the territory's
// review_role gates merge per ARCH 7.5).
//
// Triage uses a project-level "triage system" composer + session. The
// composer must exist in the project before triage runs (per ARCH 6.5.2
// "drafted proposal carries author_session_id pointing at the triage-
// system session"). Bootstrap of this composer is part of `atelier init`.
//
// CLI:
//   route-proposal --comment-json <path>      Read an ExternalComment from a JSON file
//   route-proposal --classifier <name>        Default: heuristic-v1
//   route-proposal --triage-session <uuid>    Required: triage-system session id
//   route-proposal --territory <uuid>         Required: target territory id
//   route-proposal --content-ref <path>       Default: synthesized from comment id
//   route-proposal --dry-run                  Skip the claim() call

import { promises as fs } from 'node:fs';
import { resolveClassifier } from './classifier.ts';
import { draftProposal } from './drafter.ts';
import type { ExternalComment } from '../lib/adapters.ts';
import { AtelierClient } from '../lib/write.ts';

interface Args {
  commentJsonPath: string;
  classifier: string;
  triageSessionId: string;
  territoryId: string;
  contentRef: string | null;
  dryRun: boolean;
  /** Below this confidence the comment routes to the human-only queue
   *  rather than creating a contribution. Default 0.5. */
  threshold: number;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    commentJsonPath: '',
    classifier: 'heuristic-v1',
    triageSessionId: '',
    territoryId: '',
    contentRef: null,
    dryRun: false,
    threshold: 0.5,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--comment-json') args.commentJsonPath = argv[++i]!;
    else if (a === '--classifier') args.classifier = argv[++i]!;
    else if (a === '--triage-session') args.triageSessionId = argv[++i]!;
    else if (a === '--territory') args.territoryId = argv[++i]!;
    else if (a === '--content-ref') args.contentRef = argv[++i]!;
    else if (a === '--threshold') args.threshold = Number(argv[++i]);
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--help' || a === '-h') {
      console.log('Usage: route-proposal --comment-json PATH --triage-session UUID --territory UUID [--classifier NAME] [--threshold N] [--dry-run]');
      process.exit(0);
    }
  }
  return args;
}

export interface RoutingDecision {
  outcome: 'contribution_created' | 'routed_to_human_queue';
  contributionId: string | null;
  category: string;
  confidence: number;
  reason: string;
}

export async function routeProposal(opts: {
  client: AtelierClient;
  comment: ExternalComment;
  classifierName: string;
  triageSessionId: string;
  territoryId: string;
  contentRef: string;
  threshold: number;
  dryRun: boolean;
}): Promise<RoutingDecision> {
  const classifier = resolveClassifier(opts.classifierName);
  const classification = await classifier.classify(opts.comment);
  const proposal = draftProposal({ comment: opts.comment, classification });

  if (classification.confidence < opts.threshold) {
    return {
      outcome: 'routed_to_human_queue',
      contributionId: null,
      category: classification.category,
      confidence: classification.confidence,
      reason: `confidence ${classification.confidence.toFixed(2)} < threshold ${opts.threshold}`,
    };
  }

  if (opts.dryRun) {
    return {
      outcome: 'contribution_created',
      contributionId: null,
      category: classification.category,
      confidence: classification.confidence,
      reason: 'dry-run',
    };
  }

  // Per ADR-033: contribution.kind is implementation / research / design;
  // requires_owner_approval=true is set by the library when the discipline
  // mismatches the territory's owner_role. Since the triage-system composer
  // typically has discipline != territory.owner_role, the library will set
  // the flag automatically. We pass kind explicitly per the proposal's
  // discipline routing.
  const result = await opts.client.claim({
    contributionId: null,
    sessionId: opts.triageSessionId,
    kind: proposal.discipline,
    traceIds: extractTraceIds(opts.comment, ['ATELIER-TRIAGE']),
    territoryId: opts.territoryId,
    contentRef: opts.contentRef,
    artifactScope: [opts.contentRef],
  });

  return {
    outcome: 'contribution_created',
    contributionId: result.contributionId,
    category: classification.category,
    confidence: classification.confidence,
    reason: `requires_owner_approval=${result.requiresOwnerApproval}`,
  };
}

function extractTraceIds(comment: ExternalComment, fallback: string[]): string[] {
  const ctxIds = comment.context['trace_ids'];
  if (Array.isArray(ctxIds) && ctxIds.every((x) => typeof x === 'string')) {
    return ctxIds.length > 0 ? (ctxIds as string[]) : fallback;
  }
  return fallback;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.commentJsonPath || !args.triageSessionId || !args.territoryId) {
    console.error('error: --comment-json, --triage-session, and --territory are required');
    process.exit(1);
  }

  const raw = await fs.readFile(args.commentJsonPath, 'utf8');
  const comment = JSON.parse(raw) as ExternalComment;
  const contentRef = args.contentRef ?? `triage/${comment.source}-${comment.externalCommentId}.md`;

  const dbUrl = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
  const client = new AtelierClient({ databaseUrl: dbUrl });
  try {
    const decision = await routeProposal({
      client,
      comment,
      classifierName: args.classifier,
      triageSessionId: args.triageSessionId,
      territoryId: args.territoryId,
      contentRef,
      threshold: args.threshold,
      dryRun: args.dryRun,
    });
    console.log(JSON.stringify(decision, null, 2));
  } finally {
    await client.close();
  }
}

if (process.argv[1]?.endsWith('route-proposal.ts')) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

export { parseArgs };
