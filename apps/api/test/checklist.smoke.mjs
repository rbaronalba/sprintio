const B='http://localhost:3001';
const stamp=Date.now();
const call=async(m,p,t,body)=>{const r=await fetch(B+p,{method:m,headers:{'content-type':'application/json',...(t?{authorization:'Bearer '+t}:{})},body:body?JSON.stringify(body):undefined});let j=null;try{j=await r.json()}catch{}return{s:r.status,j}};
const reg=async(n)=>{const r=await call('POST','/auth/register',null,{email:`smoke-${n}-${stamp}@sprintio.test`,password:'smoke-pass-1234'});return{t:r.j.accessToken,id:r.j.user.sub}};
const ok=(name,cond,extra='')=>{console.log((cond?'PASS ':'FAIL ')+name+(cond?'':' '+JSON.stringify(extra)));if(!cond)process.exitCode=1};

const A=await reg('a'),Bo=await reg('b'),C=await reg('c');
const board=(await call('POST','/boards',A.t,{title:'Smoke4'})).j;
const inv=(await call('POST',`/boards/${board.id}/invite`,A.t)).j;
await call('POST',`/boards/join/${inv.token}`,Bo.t);
const list=(await call('POST',`/boards/${board.id}/lists`,A.t,{title:'L'})).j;
const card=(await call('POST',`/lists/${list.id}/cards`,A.t,{title:'C'})).j;
ok('card create returns empty checklist[]',Array.isArray(card.checklist)&&card.checklist.length===0);

ok('stranger cannot list checklist',(await call('GET',`/cards/${card.id}/checklist`,C.t)).s===404);
ok('empty text rejected',(await call('POST',`/cards/${card.id}/checklist`,A.t,{text:'  '})).s===400);
const i1=(await call('POST',`/cards/${card.id}/checklist`,A.t,{text:'Write tests'})).j;
ok('item created undone',i1.done===false&&i1.text==='Write tests');
ok('member can add items too',(await call('POST',`/cards/${card.id}/checklist`,Bo.t,{text:'Ship it'})).s===201);
const items=(await call('GET',`/cards/${card.id}/checklist`,A.t)).j;
ok('lists both items in order',items.length===2&&items[0].id===i1.id);
ok('stranger cannot add item',(await call('POST',`/cards/${card.id}/checklist`,C.t,{text:'x'})).s===404);

ok('member can toggle done',(await call('PATCH',`/cards/${card.id}/checklist/${i1.id}`,Bo.t,{done:true})).s===200);
const afterToggle=(await call('GET',`/cards/${card.id}/checklist`,A.t)).j;
ok('done persisted',afterToggle.find(i=>i.id===i1.id).done===true);
ok('bad done type rejected',(await call('PATCH',`/cards/${card.id}/checklist/${i1.id}`,A.t,{done:'yes'})).s===400);
ok('can rename item text',(await call('PATCH',`/cards/${card.id}/checklist/${i1.id}`,A.t,{text:'Write more tests'})).s===200);
ok('unknown item 400',(await call('PATCH',`/cards/${card.id}/checklist/nope`,A.t,{done:true})).s===400);

const lists1=(await call('GET',`/boards/${board.id}/lists`,A.t)).j;
const faceCard=lists1[0].cards.find(c=>c.id===card.id);
ok('card face carries checklist for counting',faceCard.checklist.filter(x=>x.done).length===1&&faceCard.checklist.length===2);

ok('any member can delete an item',(await call('DELETE',`/cards/${card.id}/checklist/${i1.id}`,Bo.t)).s===200);
ok('item gone',(await call('GET',`/cards/${card.id}/checklist`,A.t)).j.length===1);

await call('DELETE',`/boards/${board.id}`,A.t);
console.log('stamp',stamp);
