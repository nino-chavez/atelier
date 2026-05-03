// Shared helper for CLI subcommands whose polished form is deferred to v1.x.
// Per Nino's 2026-05-02 brief: stubs must run, print "polished form lands in
// v1.x; for v1 do X via <raw equivalent>", and exit 0 (not no-op, not error).
// This keeps the CLI surface consistent and honest about deferral instead of
// exposing partial-implementation traps.

interface StubMessage {
  command: string;          // e.g. "atelier init"
  rationale: 'timeline' | 'scope';
  rawForm: string;          // shell-runnable command or short instruction
  rawFormBlock?: string;    // optional multi-line block (e.g., for multi-step raw forms)
  notes?: string[];         // optional clarifying lines
}

export function emitStub(msg: StubMessage): number {
  const rationaleLine =
    msg.rationale === 'timeline'
      ? "Timeline-deferred: the substrate capability already exists; only the CLI wrapper polish lands in v1.x."
      : "Scope-deferred: the underlying capability is not built at v1; tracked in BRD-OPEN-QUESTIONS for v1.x.";

  console.log('');
  console.log(`${msg.command}: polished form lands in v1.x.`);
  console.log('');
  console.log(rationaleLine);
  console.log('');
  console.log('For v1, use the raw equivalent:');
  console.log('');
  if (msg.rawFormBlock) {
    for (const line of msg.rawFormBlock.split('\n')) {
      console.log(`  ${line}`);
    }
  } else {
    console.log(`  ${msg.rawForm}`);
  }
  console.log('');
  if (msg.notes && msg.notes.length > 0) {
    for (const note of msg.notes) {
      console.log(note);
    }
    console.log('');
  }
  return 0;
}
