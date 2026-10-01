// Due dates, archive/restore, owner transfer, unassign notification, admin gate.
const B = process.env.API ?? 'http://localhost:3001';
const stamp = Date.now();
let pass = 0, fail = 0;
const ok = (c, m) => (c ? pass++ : (fail++, console.error('FAIL', m)));
const call = async (m, p, t, body) => {
  const r = await fetch(B + p, { method: m, headers: { 'content-type': 'application/json', ...(t ? { authorization: 'Bearer ' + t } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch {}
  return { s: r.status, j };
};
const reg = async (n) => (await call('POST', '/auth/register', null, { email: `smoke-${n}-${stamp}@sprintio.test`, password: 'smoke-pass-1234', firstName: 'Smoke', lastName: n })).j;

const A = await reg('laA'), Bm = await reg('laB'), X = await reg('laX');
const a = A.accessToken, b = Bm.accessToken, x = X.accessToken;
const board = (await call('POST', '/boards', a, { title: 'la' })).j;
const list = (await call('POST', `/boards/${board.id}/lists`, a, { title: 'l' })).j;
const card = (await call('POST', `/lists/${list.id}/cards`, a, { title: 'c' })).j;
const { token } = (await call('POST', `/boards/${board.id}/invite`, a)).j;
await call('POST', `/boards/join/${token}`, b);

let r = await call('PATCH', `/cards/${card.id}`, a, { dueDate: '2026-10-05T21:59:59.000Z' });
ok(r.s === 200 && r.j.dueDate === '2026-10-05T21:59:59.000Z', 'due date set');
r = await call('PATCH', `/cards/${card.id}`, a, { dueDate: null });
ok(r.s === 200 && r.j.dueDate === null, 'due date cleared');

await call('PUT', `/cards/${card.id}/members/${Bm.user.sub}`, a);
await call('DELETE', `/cards/${card.id}/members/${Bm.user.sub}`, a);
const types = (await call('GET', '/notifications', b)).j.items.map((n) => n.type);
ok(types.includes('CARD_ASSIGNED') && types.includes('CARD_UNASSIGNED'), 'assignee is notified of assignment and removal');

await call('PATCH', `/cards/${card.id}`, a, { archived: true });
const cardsOnBoard = async () => (await call('GET', `/boards/${board.id}/lists`, a)).j.flatMap((l) => l.cards).length;
ok((await cardsOnBoard()) === 0, 'archived card leaves the board');
r = await call('GET', `/boards/${board.id}/archived`, b);
ok(r.s === 200 && r.j.length === 1 && r.j[0].id === card.id && r.j[0].list.title === 'l', 'any member lists archived cards');
ok((await call('GET', `/boards/${board.id}/archived`, x)).s === 404, 'non-member cannot list archived cards');
await call('PATCH', `/cards/${card.id}`, b, { archived: false });
ok((await cardsOnBoard()) === 1 && (await call('GET', `/boards/${board.id}/archived`, a)).j.length === 0, 'restore puts it back');

ok((await call('PUT', `/boards/${board.id}/owner/${X.user.sub}`, a)).s === 400, 'cannot hand a board to a non-member');
ok((await call('PUT', `/boards/${board.id}/owner/${A.user.sub}`, b)).s === 404, 'only the owner transfers');
ok((await call('PUT', `/boards/${board.id}/owner/${Bm.user.sub}`, a)).s === 200, 'owner transfers to a member');
ok((await call('GET', `/boards/${board.id}`, a)).j.ownerId === Bm.user.sub, 'new owner recorded');
ok((await call('PATCH', `/boards/${board.id}`, a, { title: 'nope' })).s === 404, 'old owner lost owner rights');

ok((await call('GET', '/auth/admin/users', a)).s === 403, 'admin endpoints refuse non-admins');
ok((await call('GET', '/auth/admin/users', null)).s === 401, 'admin endpoints refuse anonymous');

await call('DELETE', `/boards/${board.id}`, b);
console.log(`${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
