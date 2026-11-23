import { describe, expect, it } from 'vitest';
import { chainIncludesAnchor, GENESIS_HASH, makeAuditEntry, verifyAuditChain } from '../src/audit';

const input = {
  ts: '2024-01-01T00:00:00.000Z',
  actor: 'test',
  action: 'test.record',
  payload: { b: 2, a: 1 },
};

function chain() {
  const first = makeAuditEntry(undefined, input);
  const second = makeAuditEntry(first, { ...input, payload: { a: 2 } });
  const third = makeAuditEntry(second, { ...input, payload: { b: 3 } });
  return [first, second, third] as const;
}

describe('audit chain', () => {
  it('verifies a canonical, linked chain', () => {
    const entries = chain();
    expect(entries[0].prev_hash).toBe(GENESIS_HASH);
    expect(entries[1].prev_hash).toBe(entries[0].hash);
    expect(verifyAuditChain(entries, entries[2].hash)).toBe(true);
    expect(makeAuditEntry(undefined, { ...input, payload: { a: 1, b: 2 } })).toEqual(entries[0]);
  });

  it('detects edited data and links', () => {
    const [first, second, third] = chain();
    expect(verifyAuditChain([first, { ...second, action: 'edited' }, third])).toBe(false);
    expect(verifyAuditChain([first, { ...second, prev_hash: GENESIS_HASH }, third])).toBe(false);
    expect(verifyAuditChain([first, { ...second, payload_hash: first.payload_hash }, third])).toBe(false);
  });

  it('detects deletion, reordering, and truncation against a known head', () => {
    const [first, second, third] = chain();
    expect(verifyAuditChain([first, third])).toBe(false);
    expect(verifyAuditChain([second, first, third])).toBe(false);
    expect(verifyAuditChain([first, second], third.hash)).toBe(false);
  });

  it('accepts a printed anchor only while the verified chain still contains it', () => {
    const [first, second, third] = chain();
    expect(chainIncludesAnchor([first, second, third], second.hash)).toBe(true);
    expect(chainIncludesAnchor([], GENESIS_HASH)).toBe(true);
    // An insider who rewrites history and rehashes keeps a valid chain but loses the anchor.
    const rewritten = makeAuditEntry(first, { ...input, payload: { a: 'rewritten' } });
    const rehashed = makeAuditEntry(rewritten, { ...input, payload: { b: 3 } });
    expect(verifyAuditChain([first, rewritten, rehashed])).toBe(true);
    expect(chainIncludesAnchor([first, rewritten, rehashed], second.hash)).toBe(false);
    expect(chainIncludesAnchor([first, { ...second, action: 'edited' }, third], first.hash)).toBe(false);
    expect(chainIncludesAnchor([first, second, third], 'not-a-hash')).toBe(false);
  });
});
