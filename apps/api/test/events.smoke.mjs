const B='http://localhost:3001';
const stamp=Date.now();
const call=async(m,p,t,body)=>{const r=await fetch(B+p,{method:m,headers:{'content-type':'application/json',...(t?{authorization:'Bearer '+t}:{})},body:body?JSON.stringify(body):undefined});let j=null;try{j=await r.json()}catch{}return{s:r.status,j}};
const reg=async(n)=>{const email=`smoke-${n}-${stamp}@sprintio.test`;const r=await call('POST','/auth/register',null,{email,password:'smoke-pass-1234'});return{t:r.j.accessToken,id:r.j.user.sub,email}};
const ok=(name,cond,extra='')=>{console.log((cond?'PASS ':'FAIL ')+name+(cond?'':' '+JSON.stringify(extra)));if(!cond)process.exitCode=1};
// Collects SSE payloads until stop() is called.
const listen=async(ticket)=>{const ac=new AbortController();const out=[];const p=(async()=>{try{const r=await fetch(`${B}/events/stream?ticket=${ticket}`,{signal:ac.signal});const rd=r.body.getReader();const dec=new TextDecoder();let buf='';for(;;){const{done,value}=await rd.read();if(done)break;buf+=dec.decode(value,{stream:true});const lines=buf.split('\n');buf=lines.pop();for(const line of lines){if(line.startsWith('data: ')){try{out.push(JSON.parse(line.slice(6)))}catch{}}}}}catch{}})();return{stop:async()=>{ac.abort();await p;return out}}};

// C joins the board part way through, so D stays the permanent outsider.
const A=await reg('ev-a'),Bo=await reg('ev-b'),C=await reg('ev-c'),D=await reg('ev-d');
const board=(await call('POST','/boards',A.t,{title:'Events board'})).j;
const inv=(await call('POST',`/boards/${board.id}/invite`,A.t)).j;
await call('POST',`/boards/join/${inv.token}`,Bo.t);
const list=(await call('POST',`/boards/${board.id}/lists`,A.t,{title:'Todo'})).j;
const card=(await call('POST',`/lists/${list.id}/cards`,A.t,{title:'Check tyres'})).j;

// --- stream tickets ---
ok('stream without a ticket is 401',(await fetch(`${B}/events/stream`)).status===401);
ok('stream with a junk ticket is 401',(await fetch(`${B}/events/stream?ticket=nope`)).status===401);
ok('ticket needs authentication',(await call('POST','/events/ticket',null)).s===401);
const tA=(await call('POST','/events/ticket',A.t)).j.ticket;
const tB=(await call('POST','/events/ticket',Bo.t)).j.ticket;
const tC=(await call('POST','/events/ticket',C.t)).j.ticket;
ok('a stream ticket is not an access token',(await call('GET','/boards',tA)).s===401);

// --- live delivery, and isolation from non-members ---
const memberFeed=await listen(tB), strangerFeed=await listen(tC);
await new Promise(r=>setTimeout(r,400));
await call('POST',`/lists/${list.id}/cards`,A.t,{title:'Broadcast me'});
await new Promise(r=>setTimeout(r,800));
const got=await memberFeed.stop(), none=await strangerFeed.stop();
ok('member receives the event live',got.some(e=>e.type==='CARD_CREATED'&&e.data?.title==='Broadcast me'),got);
ok('non-member receives nothing from that board',!none.some(e=>e.boardId===board.id),none);

// --- activity feed ---
await call('PATCH',`/cards/${card.id}`,A.t,{title:'Check tyres twice'});
const act=(await call('GET',`/cards/${card.id}/activity`,Bo.t)).j;
ok('card activity is readable by a member',Array.isArray(act)&&act.length>=2);
ok('activity is newest first',act[0].type==='CARD_UPDATED');
ok('activity carries the actor',act[0].actor?.email===A.email);
ok('stranger cannot read card activity',(await call('GET',`/cards/${card.id}/activity`,C.t)).s===404);
ok('stranger cannot read board activity',(await call('GET',`/boards/${board.id}/activity`,C.t)).s===404);
ok('board activity includes list creation',(await call('GET',`/boards/${board.id}/activity`,A.t)).j.some(e=>e.type==='LIST_CREATED'));

// --- a reorder is not feed noise ---
const before=(await call('GET',`/cards/${card.id}/activity`,A.t)).j.length;
await call('PATCH',`/cards/${card.id}`,A.t,{position:1500});
ok('a pure reorder records nothing',(await call('GET',`/cards/${card.id}/activity`,A.t)).j.length===before);

// --- notifications: assignment ---
ok('assigning notifies the assignee',(await call('PUT',`/cards/${card.id}/members/${Bo.id}`,A.t)).s===200);
const nB=(await call('GET','/notifications',Bo.t)).j;
ok('assignee has one unread',nB.unread===1,nB);
ok('notification names the card',nB.items[0]?.data?.title==='Check tyres twice',nB.items[0]);
ok('actor is not notified of their own action',(await call('GET','/notifications',A.t)).j.unread===0);

// --- notifications: mentions ---
// Bo is assigned to this card, so Bo is notified of every comment on it regardless of
// mentions. The mention rule is therefore tested on Cy, who is a member but not assigned.
await call('POST',`/boards/join/${inv.token}`,C.t);
await call('POST',`/cards/${card.id}/comments`,A.t,{body:'nothing to see here'});
ok('an unmentioned, unassigned member is not notified',(await call('GET','/notifications',C.t)).j.unread===0);
ok('an assignee is notified of any comment',(await call('GET','/notifications',Bo.t)).j.unread===2);
await call('POST',`/cards/${card.id}/comments`,A.t,{body:`@${C.email} have a look`});
ok('a mention notifies the mentioned member',(await call('GET','/notifications',C.t)).j.unread===1);
await call('POST',`/cards/${card.id}/comments`,A.t,{body:'@nobody@elsewhere.test hello'});
ok('a mention of a non-member notifies nobody new',(await call('GET','/notifications',C.t)).j.unread===1);

// --- marking read is scoped to the owner ---
const someoneElsesId=(await call('GET','/notifications',C.t)).j.items[0].id;
await call('POST','/notifications/read',Bo.t,{ids:[someoneElsesId]});
ok('another user cannot mark my notification read',(await call('GET','/notifications',C.t)).j.unread===1);
await call('POST','/notifications/read',C.t);
ok('marking all read clears the count',(await call('GET','/notifications',C.t)).j.unread===0);

// --- global search ---
ok('search needs two characters',(await call('GET','/search?q=a',A.t)).j.length===0);
const hits=(await call('GET','/search?q=tyres',A.t)).j;
ok('search finds the card',hits.some(h=>h.cardId===card.id&&h.boardTitle==='Events board'),hits);
ok('search is case-insensitive',(await call('GET','/search?q=TYRES',A.t)).j.length===hits.length);
ok('search never crosses board membership',(await call('GET','/search?q=tyres',D.t)).j.length===0);
ok('search needs authentication',(await call('GET','/search?q=tyres',null)).s===401);

// --- profile ---
ok('display name updates',(await call('PATCH','/auth/profile',A.t,{displayName:'  Ruben  '})).j.displayName==='Ruben');
ok('/auth/me reflects it',(await call('GET','/auth/me',A.t)).j.displayName==='Ruben');
ok('blank display name becomes null',(await call('PATCH','/auth/profile',A.t,{displayName:'   '})).j.displayName===null);
ok('over-long display name rejected',(await call('PATCH','/auth/profile',A.t,{displayName:'x'.repeat(61)})).s===400);

// --- due date completion ---
ok('dueDone alone is accepted',(await call('PATCH',`/cards/${card.id}`,A.t,{dueDate:'2026-01-01',dueDone:true})).j.dueDone===true);
ok('clearing the date clears completion',(await call('PATCH',`/cards/${card.id}`,A.t,{dueDate:null,dueDone:true})).j.dueDone===false);
ok('bad dueDone rejected',(await call('PATCH',`/cards/${card.id}`,A.t,{dueDone:'yes'})).s===400);

await call('DELETE',`/boards/${board.id}`,A.t);
console.log('stamp',stamp);
