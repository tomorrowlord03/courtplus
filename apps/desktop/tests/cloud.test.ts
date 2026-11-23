import { describe, expect, it } from 'vitest';
import { mergeHandoff, reconnectDelay, streamEvents, type Handoff } from '../src/handlers/cloud';

// Fictional handoff; no real case data.
const base: Handoff = {
  id: '00000000-0000-4000-8000-000000000001', caseId: 'c-fictional', kind: 'bail_granted',
  orderOn: '2026-11-20', dueAt: 1000, escalatedAt: null, acknowledgedAt: null,
};

function sse(chunks: string[], keepOpen = false) {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      if (!keepOpen) controller.close();
    },
  });
  return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
}

describe('cloud handoff stream', () => {
  it('backs off exponentially with jitter and caps at 60 s', () => {
    expect(reconnectDelay(0, () => 0)).toBe(1000);
    expect(reconnectDelay(0, () => 1)).toBe(2000);
    expect(reconnectDelay(3, () => 0)).toBe(8000);
    expect(reconnectDelay(3, () => 1)).toBe(16000);
    expect(reconnectDelay(50, () => 1)).toBe(60000);
    expect(reconnectDelay(50, () => 0)).toBe(30000);
    const spread = new Set(Array.from({ length: 20 }, () => reconnectDelay(4)));
    expect(spread.size).toBeGreaterThan(1);
  });

  it('never lets a replayed or out-of-order event undo an acknowledgement', () => {
    const acknowledged = { ...base, escalatedAt: 900, acknowledgedAt: 950, version: 3 };
    const replayedPost = { ...base, version: 1 };
    expect(mergeHandoff(acknowledged, replayedPost)).toBe(acknowledged);
    expect(mergeHandoff(acknowledged, { ...base, escalatedAt: 900, version: 2 })).toBe(acknowledged);
    expect(mergeHandoff(replayedPost, acknowledged)).toBe(acknowledged);
    // Without versions (older appliance), the one-way timestamps still protect the state.
    const { version: _drop, ...legacyAck } = acknowledged;
    expect(mergeHandoff(legacyAck, base)).toBe(legacyAck);
    expect(mergeHandoff(legacyAck, { ...base, escalatedAt: 900 })).toBe(legacyAck);
    expect(mergeHandoff(base, legacyAck)).toBe(legacyAck);
    expect(mergeHandoff(undefined, base)).toBe(base);
  });

  it('reads event ids and skips heartbeat comments', async () => {
    const events = [];
    for await (const event of streamEvents(sse([
      'id: 7\nevent: snapshot\ndata: []\n\n', ': heartbeat\n\n', 'id: 8\nevent: posted\ndata: {"a":1}\n\n',
    ]))) events.push(event);
    expect(events).toEqual([
      { id: 7, type: 'snapshot', data: [] },
      { id: 8, type: 'posted', data: { a: 1 } },
    ]);
  });

  it('fails a stream that goes quiet so the caller reconnects', async () => {
    const seen: string[] = [];
    const reading = (async () => {
      for await (const event of streamEvents(sse(['id: 1\nevent: snapshot\ndata: []\n\n'], true), 50)) seen.push(event.type);
    })();
    await expect(reading).rejects.toThrow(/went quiet/);
    expect(seen).toEqual(['snapshot']);
  });
});
