// Board/list backgrounds: palette colors, image uploads, rejection of anything else, access.
const B = process.env.API ?? 'http://localhost:3001';
const stamp = Date.now();
let pass = 0, fail = 0;
const ok = (c, m) => (c ? pass++ : (fail++, console.error('FAIL', m)));
const call = async (m, p, t, body) => {
  const r = await fetch(B + p, { method: m, headers: { 'content-type': 'application/json', ...(t ? { authorization: 'Bearer ' + t } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch {}
  return { s: r.status, j };
};
const upload = async (p, t, type, name) => {
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array([137, 80, 78, 71])], { type }), name);
  const r = await fetch(B + p, { method: 'POST', headers: { authorization: 'Bearer ' + t }, body: form });
  return { s: r.status, j: await r.json().catch(() => null) };
};
const reg = async (n) => {
  const r = await call('POST', '/auth/register', null, { email: `smoke-${n}-${stamp}@sprintio.test`, password: 'smoke-pass-1234', firstName: 'Smoke', lastName: n });
  return r.j.accessToken;
};

const a = await reg('bgA'), x = await reg('bgX');
const board = (await call('POST', '/boards', a, { title: 'bg' })).j;
const list = (await call('POST', `/boards/${board.id}/lists`, a, { title: 'l' })).j;

let r = await call('POST', `/boards/${board.id}/background`, a, { background: '#0c66e4' });
ok(r.s === 201 && r.j.background === '#0c66e4', 'board color');
ok((await call('GET', `/boards/${board.id}`, a)).j.background === '#0c66e4', 'board detail returns background');
ok((await call('POST', `/boards/${board.id}/background`, a, { background: 'red;x:url(//evil)' })).s === 400, 'arbitrary CSS rejected');
ok((await call('POST', `/boards/${board.id}/background`, a, { background: '/uploads/abc.png' })).s === 400, 'client-set image path rejected');
ok((await call('POST', `/boards/${board.id}/background`, x, { background: '#0c66e4' })).s === 404, 'non-member refused');

r = await upload(`/boards/${board.id}/background`, a, 'image/png', 'evil.html');
ok(r.s === 201 && /^\/uploads\/[0-9a-f]{32}\.png$/.test(r.j.background), 'image upload, extension from mimetype: ' + r.j?.background);
const img = r.j.background;
ok((await fetch(B + img)).status === 200, 'uploaded image served');
await call('POST', `/boards/${board.id}/background`, a, { background: '' });
ok((await fetch(B + img)).status === 404, 'replaced image deleted from disk');
ok((await upload(`/boards/${board.id}/background`, a, 'text/html', 'x.html')).s === 400, 'non-image upload rejected');

r = await call('POST', `/lists/${list.id}/background`, a, { background: '#f5cd47' });
ok(r.s === 201 && r.j.background === '#f5cd47', 'list color');
const lists = (await call('GET', `/boards/${board.id}/lists`, a)).j;
ok(lists[0].background === '#f5cd47', 'lists payload returns background');
ok((await upload(`/lists/${list.id}/background`, x, 'image/png', 'a.png')).s === 404, 'non-member list upload refused');

await call('DELETE', `/boards/${board.id}`, a);
console.log(`${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
