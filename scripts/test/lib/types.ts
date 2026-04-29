// Round-trip test types per scripts/README.md "Test shape".
//
// Each canonical doc class registers a handler implementing this interface.
// The harness enumerates files, runs each through the handler, and reports
// byte-level diffs.

export interface DocClassHandler {
  /** Display name; used in reports. Matches scripts/README.md table. */
  readonly name: string;
  /** Path pattern for human-readable reports (not a glob; enumerate() does the actual file listing). */
  readonly pathPattern: string;
  /** List of permitted normalizations from scripts/README.md table. Reported alongside diffs. */
  readonly permittedNormalizations: readonly string[];
  /** Enumerate matching files for this doc class. Returns absolute paths. */
  enumerate(repoRoot: string): Promise<string[]>;
  /** Run the round-trip test on a single file. */
  roundTrip(filePath: string): Promise<RoundTripResult>;
}

export interface RoundTripResult {
  filePath: string;
  ok: boolean;
  /** Set when the file is intentionally skipped (no fixtures, advisory, etc.). */
  skipped?: string;
  diffs?: ByteDiff[];
  /** Bytes-of-input for context in reports. */
  byteCount?: number;
}

export interface ByteDiff {
  /** Hex offset where divergence begins. */
  offsetHex: string;
  /** Hex bytes expected (from the projection). */
  expectedHex: string;
  /** Hex bytes actually read (from the on-disk normalized original). */
  gotHex: string;
  /** Short context window around the offset for human readability. */
  context: string;
}
