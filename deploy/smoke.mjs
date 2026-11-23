const [origin, caseId, dlsaUser, jailUser, orderOn] = process.argv.slice(2);
const signal = AbortSignal.timeout(15_000);
const make = async (path, { body, token } = {}) => {
  const headers = {};
  if (token) headers.authorization = 'Bearer ' + token;
  if (body) headers['content-type'] = 'application/json';
  const response = await fetch(origin + path, {
    signal, headers, method: body ? 'POST' : 'GET', body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) throw new Error(path + ' returned HTTP ' + response.status);
  return response;
};
async function login(username, password) {
  const { token } = await (await make('/api/auth/login', { body: { username, password, client: 'desktop' } })).json();
  return token;
}
const health = await (await make('/health')).json();
if (health.status !== 'ok') throw new Error('Cloud is unhealthy');
const dlsa = await login(dlsaUser, process.env.COURTPLUS_SMOKE_DLSA_PASSWORD);
const jail = await login(jailUser, process.env.COURTPLUS_SMOKE_JAIL_PASSWORD);
const stream = await make('/api/handoff/stream', { token: jail });
const reader = stream.body.getReader();
const decoder = new TextDecoder();
let frames = '';
async function readUntil(predicate) {
  while (!predicate(frames)) {
    const chunk = await reader.read();
    if (chunk.done) throw new Error('Handoff stream ended early');
    frames += decoder.decode(chunk.value, { stream: true });
  }
}
try {
  await readUntil(text => text.includes('event: snapshot'));
  const sent = await make('/api/handoff', { token: dlsa, body: { caseId, kind: 'release_order', orderOn } });
  const { id } = await sent.json();
  if (sent.status === 201) {
    await readUntil(text => text.split('\n\n').some(frame => frame.includes('event: posted') && frame.includes(id)));
  }
  const received = await (await make('/api/handoff', { token: jail })).json();
  if (!received.some(order => order.id === id && order.caseId === caseId)) throw new Error('Handoff was not received');
  const ack = await (await make('/api/handoff/' + id + '/ack', { token: jail, body: {} })).json();
  if (ack.acknowledgedAt === null) throw new Error('Handoff was not acknowledged');
  console.log('PASS /health, HTTPS login, handoff stream, read-back and jail acknowledgement');
} finally {
  await reader.cancel();
}
