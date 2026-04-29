// Byte-level diff reporter per scripts/README.md "Fail on any remaining
// difference; report as `<file>: <hex offset> expected <byte> got <byte>`".

import type { ByteDiff } from './types.ts';

const CONTEXT_BYTES = 24;

/** Returns up to N diffs (default 5) covering the first divergences. */
export function byteDiff(expected: string, actual: string, maxDiffs = 5): ByteDiff[] {
  if (expected === actual) return [];
  const expBuf = Buffer.from(expected, 'utf8');
  const actBuf = Buffer.from(actual, 'utf8');
  const minLen = Math.min(expBuf.length, actBuf.length);

  const diffs: ByteDiff[] = [];
  let i = 0;
  while (i < minLen && diffs.length < maxDiffs) {
    if (expBuf[i] !== actBuf[i]) {
      diffs.push(makeDiff(expBuf, actBuf, i));
      // Skip past this divergence run before looking for the next one
      while (i < minLen && expBuf[i] !== actBuf[i]) i += 1;
    } else {
      i += 1;
    }
  }

  if (diffs.length < maxDiffs && expBuf.length !== actBuf.length) {
    // Length mismatch beyond the common prefix.
    diffs.push(makeDiff(expBuf, actBuf, minLen));
  }

  return diffs;
}

function makeDiff(expBuf: Buffer, actBuf: Buffer, offset: number): ByteDiff {
  const expByte = expBuf[offset];
  const actByte = actBuf[offset];
  const start = Math.max(0, offset - CONTEXT_BYTES);
  const expCtx = expBuf.subarray(start, Math.min(expBuf.length, offset + CONTEXT_BYTES)).toString('utf8');
  const actCtx = actBuf.subarray(start, Math.min(actBuf.length, offset + CONTEXT_BYTES)).toString('utf8');
  return {
    offsetHex: `0x${offset.toString(16).padStart(6, '0')}`,
    expectedHex: expByte === undefined ? '<eof>' : `0x${expByte.toString(16).padStart(2, '0')}`,
    gotHex: actByte === undefined ? '<eof>' : `0x${actByte.toString(16).padStart(2, '0')}`,
    context: `expected="${escapeNonPrintable(expCtx)}" got="${escapeNonPrintable(actCtx)}"`,
  };
}

function escapeNonPrintable(s: string): string {
  return s.replace(/\r/g, '\\r').replace(/\n/g, '\\n').replace(/\t/g, '\\t');
}
