const B='http://localhost:3001';
const stamp=Date.now();
const call=async(m,p,t,body)=>{const r=await fetch(B+p,{method:m,headers:{'content-type':'application/json',...(t?{authorization:'Bearer '+t}:{})},body:body?JSON.stringify(body):undefined});let j=null;try{j=await r.json()}catch{}return{s:r.status,j}};
const reg=async(n)=>{const r=await call('POST','/auth/register',null,{email:`smoke-pos-${n}-${stamp}@sprintio.test`,password:'smoke-pass-1234',firstName:'Smoke',lastName:n});return{t:r.j.accessToken,id:r.j.user.sub}};
const ok=(name,cond,extra='')=>{console.log((cond?'PASS ':'FAIL ')+name+(cond?'':' '+JSON.stringify(extra)));if(!cond)process.exitCode=1};

const A=await reg('a');
const board=(await call('POST','/boards',A.t,{title:'Positions'})).j;
const L1=(await call('POST',`/boards/${board.id}/lists`,A.t,{title:'L1'})).j;
const L2=(await call('POST',`/boards/${board.id}/lists`,A.t,{title:'L2'})).j;
const mk=async(t)=>(await call('POST',`/lists/${L1.id}/cards`,A.t,{title:t})).j;
const c1=await mk('c1'),c2=await mk('c2'),c3=await mk('c3');
const order=async()=>(await call('GET',`/boards/${board.id}/lists`,A.t)).j.find(l=>l.id===L1.id).cards.map(c=>c.title).join(',');

// --- the server places by neighbour id, not by a client-computed number ---
const top=await call('PATCH',`/cards/${c3.id}`,A.t,{listId:L1.id,afterId:null});
ok('move to top returns its position',top.s===200&&typeof top.j.position==='number'&&top.j.renumbered===false,top);
ok('order follows afterId',(await order())==='c3,c1,c2');
ok('afterId from another list is rejected',(await call('PATCH',`/cards/${c1.id}`,A.t,{listId:L2.id,afterId:c2.id})).s===400);
ok('a client-sent position is ignored',(await call('PATCH',`/cards/${c1.id}`,A.t,{position:-5})).s===200&&(await order())==='c3,c1,c2');

// --- the gap between two cards runs out: renumber, order intact ---
// Alternate c1 and c2 into the slot right after c3: the gap halves on every drop.
let renumbered=false;
for(let i=0;i<80&&!renumbered;i++){
  const mover=i%2?c1:c2;
  const r=await call('PATCH',`/cards/${mover.id}`,A.t,{listId:L1.id,afterId:c3.id});
  renumbered=r.j.renumbered;
}
ok('repeated bisection eventually renumbers',renumbered);
const cards=(await call('GET',`/boards/${board.id}/lists`,A.t)).j.find(l=>l.id===L1.id).cards;
ok('positions are spread out again',cards.every((c,i)=>i===0||c.position-cards[i-1].position>=1000),cards.map(c=>c.position));
ok('order survived the renumber',cards[0].title==='c3'&&cards.length===3);

// --- lists move the same way ---
ok('list moves by afterId',(await call('PATCH',`/lists/${L2.id}`,A.t,{afterId:null})).s===200&&(await call('GET',`/boards/${board.id}/lists`,A.t)).j[0].id===L2.id);

// --- comments are paged, newest page first ---
for(let i=0;i<55;i++) await call('POST',`/cards/${c1.id}/comments`,A.t,{body:`n${i}`});
const p1=(await call('GET',`/cards/${c1.id}/comments`,A.t)).j;
ok('first page is the newest 50, oldest-first',p1.length===50&&p1[0].body==='n5'&&p1[49].body==='n54',p1.map(c=>c.body));
const p2=(await call('GET',`/cards/${c1.id}/comments?before=${p1[0].id}`,A.t)).j;
ok('before= gives the older rest',p2.length===5&&p2[0].body==='n0'&&p2[4].body==='n4',p2.map(c=>c.body));

await call('DELETE',`/boards/${board.id}`,A.t);
