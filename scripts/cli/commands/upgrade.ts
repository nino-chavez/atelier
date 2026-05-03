// `atelier upgrade` — pull a new Atelier template version into an
// existing project (US-11.10; BUILD-SEQUENCE §9; ARCH 9.7).
//
// v1: SCOPE-DEFERRED stub (not timeline). The semver-aware template
// upgrade flow (additive-preferred migrations, idempotent, N/N-1
// schema co-existence per ARCH 9.7) is not built at v1. Tracked in
// BRD-OPEN-QUESTIONS §29.
//
// Distinguished from the 6 timeline-deferred stubs (init, datastore
// init, deploy, invite, territory add, doctor) which all have raw
// equivalents that work at v1: upgrade has NO raw form. Operator
// practice is "git pull origin main && review CHANGELOG."

// Note: this command does NOT use the shared `emitStub` helper because the
// scope-deferred shape needs a different framing than timeline-deferred (the
// raw form is "git pull" not a substrate command, and the message should
// make the v1.x scope boundary clear so adopters don't expect this command
// in a v1.x patch release).

export const upgradeUsage = `atelier upgrade — pull a new template version

Usage:
  atelier upgrade [--target <version>]

v1 status: SCOPE-DEFERRED stub. The semver-aware upgrade flow per
ARCH 9.7 (additive-preferred migrations, idempotent, N/N-1 schema
co-existence) is not built at v1. Tracked as v1.x work in
BRD-OPEN-QUESTIONS §29.

For v1, manual upgrade procedure:

  cd <your-atelier-project>
  git remote add upstream https://github.com/Signal-x-Studio-LLC/atelier.git
  git fetch upstream main
  git log HEAD..upstream/main -- .atelier/ docs/strategic/ docs/architecture/ \\
    | grep -E "^(commit|    [A-Z])" | less
  # Review what changed; manually merge what applies to your project
  git merge upstream/main   # or cherry-pick specific commits

The "additive-preferred" rule per ARCH 9.7 means most upstream changes
land cleanly; conflicts (rare) typically reflect intentional adopter
divergence (custom territories, custom config) which the manual review
catches.
`;

export async function runUpgrade(_args: readonly string[]): Promise<number> {
  console.log('');
  console.log('atelier upgrade: SCOPE-DEFERRED to v1.x (not just CLI polish).');
  console.log('');
  console.log('The semver-aware template upgrade flow per ARCH 9.7 (additive-preferred');
  console.log('migrations, idempotent, N/N-1 schema co-existence, conflict detection)');
  console.log('is not built at v1. Tracked in BRD-OPEN-QUESTIONS §29.');
  console.log('');
  console.log('For v1, current operator practice:');
  console.log('');
  console.log('  cd <your-atelier-project>');
  console.log('  git remote add upstream https://github.com/Signal-x-Studio-LLC/atelier.git');
  console.log('  git fetch upstream main');
  console.log('  git log HEAD..upstream/main -- .atelier/ docs/strategic/ docs/architecture/ | less');
  console.log('  # Review what changed');
  console.log('  git merge upstream/main   # or cherry-pick what applies');
  console.log('');
  console.log('The polished `atelier upgrade` lands when an adopter requests');
  console.log("semver-aware template upgrade (per BRD-OPEN-QUESTIONS §29's trigger).");
  console.log('');
  return 0;
  // Note: not using emitStub() here because the scope-deferred shape needs
  // a different framing than timeline-deferred (the raw form is "git pull"
  // not a substrate command, and the message should make the v1.x scope
  // boundary clear so adopters don't expect this command in a v1.x patch
  // release).
}
