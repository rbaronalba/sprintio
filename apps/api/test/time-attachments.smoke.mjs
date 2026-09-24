const B='http://localhost:3001';
const stamp=Date.now();
const call=async(m,p,t,body)=>{const r=await fetch(B+p,{method:m,headers:{'content-type':'application/json',...(t?{authorization:'Bearer '+t}:{})},body:body?JSON.stringify(body):undefined});let j=null;try{j=await r.json()}catch{}return{s:r.status,j}};
const reg=async(n)=>{const r=await call('POST','/auth/register',null,{email:`smoke-${n}-${stamp}@sprintio.test`,password:'smoke-pass-1234'});return{t:r.j.accessToken,id:r.j.user.sub}};
const ok=(name,cond,extra='')=>{console.log((cond?'PASS ':'FAIL ')+name+(cond?'':' '+JSON.stringify(extra)));if(!cond)process.exitCode=1};

const A=await reg('a'),Bo=await reg('b'),C=await reg('c');
const board=(await call('POST','/boards',A.t,{title:'Smoke3'})).j;
const inv=(await call('POST',`/boards/${board.id}/invite`,A.t)).j;
await call('POST',`/boards/join/${inv.token}`,Bo.t);
const list=(await call('POST',`/boards/${board.id}/lists`,A.t,{title:'L'})).j;
const card=(await call('POST',`/lists/${list.id}/cards`,A.t,{title:'C'})).j;
ok('card create returns empty timeEntries[]',Array.isArray(card.timeEntries)&&card.timeEntries.length===0);
ok('card create returns attachments count',card._count.attachments===0);

// time entries
ok('stranger cannot list time',(await call('GET',`/cards/${card.id}/time`,C.t)).s===404);
ok('hours out of range rejected',(await call('POST',`/cards/${card.id}/time`,A.t,{date:'2026-09-05',hours:25})).s===400);
ok('bad date rejected',(await call('POST',`/cards/${card.id}/time`,A.t,{date:'nope',hours:2})).s===400);
const e1=(await call('POST',`/cards/${card.id}/time`,A.t,{date:'2026-09-05',hours:2,note:'setup'})).j;
ok('entry created with user email',e1.user.email.includes('smoke-a')&&e1.hours===2);
const e2=(await call('POST',`/cards/${card.id}/time`,Bo.t,{date:'2026-09-06',hours:3.5})).j;
const entries=(await call('GET',`/cards/${card.id}/time`,A.t)).j;
ok('lists both entries',entries.length===2);
const lists1=(await call('GET',`/boards/${board.id}/lists`,A.t)).j;
const faceCard=lists1[0].cards.find(c=>c.id===card.id);
ok('card face carries hours for summing',faceCard.timeEntries.reduce((s,x)=>s+x.hours,0)===5.5);
ok('cannot delete someone else\'s entry',(await call('DELETE',`/cards/${card.id}/time/${e2.id}`,A.t)).s===400);
ok('author deletes own entry',(await call('DELETE',`/cards/${card.id}/time/${e1.id}`,A.t)).s===200);
ok('stranger cannot log time',(await call('POST',`/cards/${card.id}/time`,C.t,{date:'2026-09-05',hours:1})).s===404);

// attachments
const png=Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108020000009077' , 'hex');
const upload=async(t,filename,mime,buf)=>{
  const fd=new FormData();
  fd.append('file', new Blob([buf],{type:mime}), filename);
  const r=await fetch(`${B}/cards/${card.id}/attachments`,{method:'POST',headers:{authorization:'Bearer '+t},body:fd});
  let j=null;try{j=await r.json()}catch{}
  return {s:r.status,j};
};
ok('stranger cannot upload',(await upload(C.t,'a.png','image/png',png)).s===404);
ok('non-image rejected',(await upload(A.t,'a.txt','text/plain',Buffer.from('hi'))).s===400);
const att=await upload(A.t,'a.png','image/png',png);
ok('image accepted',att.s===201&&att.j.originalName==='a.png');
const served=await fetch(`${B}/uploads/${att.j.path}`);
ok('served back over http',served.status===200);
const list2=(await call('GET',`/cards/${card.id}/attachments`,Bo.t)).j;
ok('member can list attachments',list2.length===1);
ok('cannot delete someone else\'s attachment',(await call('DELETE',`/cards/${card.id}/attachments/${att.j.id}`,Bo.t)).s===400);
ok('uploader deletes own attachment',(await call('DELETE',`/cards/${card.id}/attachments/${att.j.id}`,A.t)).s===200);
const deleted=await fetch(`${B}/uploads/${att.j.path}`);
ok('file removed from disk after delete',deleted.status===404);

await call('DELETE',`/boards/${board.id}`,A.t);
console.log('stamp',stamp);
