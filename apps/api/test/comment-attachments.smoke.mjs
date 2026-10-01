// Images posted with a comment: stored on that comment, deleted with it, never listed card-level.
const B = process.env.API ?? 'http://localhost:3001';
const stamp = Date.now();
let pass = 0, fail = 0;
const ok = (c, m) => (c ? pass++ : (fail++, console.error('FAIL', m)));
const call = async (m, p, t, body) => {
  const r = await fetch(B + p, { method: m, headers: { 'content-type': 'application/json', ...(t ? { authorization: 'Bearer ' + t } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch {}
  return { s: r.status, j };
};
const post = async (p, t, body, name = 'photo.png') => {
  const form = new FormData();
  if (body !== undefined) form.append('body', body);
  form.append('file', new Blob([new Uint8Array([137, 80, 78, 71])]), name);
  const r = await fetch(B + p, { method: 'POST', headers: { authorization: 'Bearer ' + t }, body: form });
  return { s: r.status, j: await r.json().catch(() => null) };
};
const reg = async (n) => (await call('POST', '/auth/register', null, { email: `smoke-${n}-${stamp}@sprintio.test`, password: 'smoke-pass-1234', firstName: 'Smoke', lastName: n })).j.accessToken;

const a = await reg('caA'), x = await reg('caX');
const board = (await call('POST', '/boards', a, { title: 'ca' })).j;
const list = (await call('POST', `/boards/${board.id}/lists`, a, { title: 'l' })).j;
const card = (await call('POST', `/lists/${list.id}/cards`, a, { title: 'c' })).j;
const base = `/cards/${card.id}/comments`;

ok((await call('POST', base, a, { body: 'plain' })).s === 201, 'text-only comment still works');
ok((await call('POST', base, a, { body: '  ' })).s === 400, 'empty text-only comment rejected');

let r = await post(base, a, 'look at this');
ok(r.s === 201 && r.j.body === 'look at this' && r.j.attachments.length === 1, 'comment with image');
const withImg = r.j, url = `/uploads/${r.j.attachments[0].path}`;
ok((await fetch(B + url)).status === 200, 'image served');
ok((await post(base, a, undefined)).s === 201, 'image-only comment allowed');
ok((await post(base, a, 'x', 'page.html')).s === 400, 'disallowed type refused');
r = await post(base, a, 'the log', 'server.LOG');
const file = await fetch(`${B}/uploads/${r.j?.attachments[0].path}`);
ok(r.s === 201 && file.headers.get('content-disposition') === 'attachment', 'non-image accepted, served as a download');
ok((await post(base, x, 'intruder')).s === 404, 'non-member refused');

const comments = (await call('GET', base, a)).j;
ok(comments.find((c) => c.id === withImg.id)?.attachments.length === 1, 'list returns comment images');
ok((await call('GET', `/cards/${card.id}/attachments`, a)).j.length === 0, 'comment images not listed card-level');

await call('DELETE', `${base}/${withImg.id}`, a);
ok((await fetch(B + url)).status === 404, 'image file deleted with comment');

await call('DELETE', `/boards/${board.id}`, a);
console.log(`${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
