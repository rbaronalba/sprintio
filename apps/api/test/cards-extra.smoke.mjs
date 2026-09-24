const B='http://localhost:3001';
const stamp=Date.now();
const call=async(m,p,t,body)=>{const r=await fetch(B+p,{method:m,headers:{'content-type':'application/json',...(t?{authorization:'Bearer '+t}:{})},body:body?JSON.stringify(body):undefined});let j=null;try{j=await r.json()}catch{}return{s:r.status,j}};
const reg=async(n)=>{const r=await call('POST','/auth/register',null,{email:`smoke-${n}-${stamp}@sprintio.test`,password:'smoke-pass-1234'});return{t:r.j.accessToken,id:r.j.user.sub}};
const ok=(name,cond,extra='')=>{console.log((cond?'PASS ':'FAIL ')+name+(cond?'':' '+JSON.stringify(extra)));if(!cond)process.exitCode=1};

const A=await reg('a'),Bo=await reg('b'),C=await reg('c');
const board=(await call('POST','/boards',A.t,{title:'Smoke2'})).j;
const inv=(await call('POST',`/boards/${board.id}/invite`,A.t)).j;
await call('POST',`/boards/join/${inv.token}`,Bo.t);
const list=(await call('POST',`/boards/${board.id}/lists`,A.t,{title:'L'})).j;
const card=(await call('POST',`/lists/${list.id}/cards`,A.t,{title:'C'})).j;
ok('card create returns labels[] and comment count',Array.isArray(card.labels)&&card._count.comments===0);

// labels
ok('stranger cannot list labels',(await call('GET',`/boards/${board.id}/labels`,C.t)).s===404);
ok('bad color rejected',(await call('POST',`/boards/${board.id}/labels`,A.t,{name:'x',color:'#ffffff'})).s===400);
const label=(await call('POST',`/boards/${board.id}/labels`,A.t,{name:'Urgent',color:'#c8102e'})).j;
ok('label created with fixed color',label.color==='#c8102e');
ok('member can create labels too',(await call('POST',`/boards/${board.id}/labels`,Bo.t,{name:'Later',color:'#2e7fd9'})).s===201);
ok('member can attach label to card',(await call('PUT',`/cards/${card.id}/labels/${label.id}`,Bo.t)).s===200);
ok('attach twice is fine',(await call('PUT',`/cards/${card.id}/labels/${label.id}`,Bo.t)).s===200);
const lists1=(await call('GET',`/boards/${board.id}/lists`,A.t)).j;
ok('list includes attached label',lists1[0].cards.find(c=>c.id===card.id).labels.some(l=>l.labelId===label.id));
ok('cannot attach label from another board',(await call('PUT',`/cards/${card.id}/labels/nope`,A.t)).s===400);
ok('stranger cannot attach label',(await call('PUT',`/cards/${card.id}/labels/${label.id}`,C.t)).s===404);
ok('detach label works',(await call('DELETE',`/cards/${card.id}/labels/${label.id}`,A.t)).s===200);
ok('owner can delete label',(await call('DELETE',`/boards/${board.id}/labels/${label.id}`,A.t)).s===200);

// due date
ok('due date accepted via card patch',(await call('PATCH',`/cards/${card.id}`,A.t,{dueDate:'2026-12-25'})).j.dueDate?.startsWith('2026-12-25'));
ok('bad due date rejected',(await call('PATCH',`/cards/${card.id}`,A.t,{dueDate:'not-a-date'})).s===400);
ok('due date can be cleared',(await call('PATCH',`/cards/${card.id}`,A.t,{dueDate:null})).j.dueDate===null);

// comments
ok('stranger cannot list comments',(await call('GET',`/cards/${card.id}/comments`,C.t)).s===404);
ok('empty comment rejected',(await call('POST',`/cards/${card.id}/comments`,A.t,{body:'  '})).s===400);
const c1=(await call('POST',`/cards/${card.id}/comments`,A.t,{body:'hello from owner'})).j;
ok('comment includes author email',c1.author.email.includes('smoke-a'));
const c2=(await call('POST',`/cards/${card.id}/comments`,Bo.t,{body:'hello from member'})).j;
const comments=(await call('GET',`/cards/${card.id}/comments`,A.t)).j;
ok('lists both comments in order',comments.length===2&&comments[0].id===c1.id&&comments[1].id===c2.id);
ok('cannot delete someone else\'s comment',(await call('DELETE',`/cards/${card.id}/comments/${c1.id}`,Bo.t)).s===400);
ok('author deletes own comment',(await call('DELETE',`/cards/${card.id}/comments/${c1.id}`,A.t)).s===200);
ok('comment gone',(await call('GET',`/cards/${card.id}/comments`,A.t)).j.length===1);
ok('stranger cannot comment',(await call('POST',`/cards/${card.id}/comments`,C.t,{body:'x'})).s===404);

await call('DELETE',`/boards/${board.id}`,A.t);
console.log('stamp',stamp);
