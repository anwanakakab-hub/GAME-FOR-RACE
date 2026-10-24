'use strict';
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const PORT=Number(process.env.PORT)||3000, rooms=new Map(), alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const colors=['#ff6271','#47b7ff','#ffd454','#bd95ff','#50e3b1','#ff9358','#fc72d1','#ebf5ff'];
const send=(res,status,obj)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Access-Control-Allow-Origin':'*'});res.end(JSON.stringify(obj));};
const code=()=>Array.from(crypto.randomBytes(6),x=>alphabet[x%alphabet.length]).join('');
const safeName=s=>String(s||'Racer').trim().slice(0,16).replace(/[<>]/g,'')||'Racer';
const view=r=>({code:r.code,status:r.status,host:r.host,startedAt:r.startedAt,endedAt:r.endedAt,champion:r.champion,players:[...r.players.values()].map(p=>({id:p.id,name:p.name,color:p.color,ready:p.ready,progress:p.progress,lane:p.lane,speed:p.speed,finishedAt:p.finishedAt,connected:Date.now()-p.seen<10000})).sort((a,b)=>b.progress-a.progress),laps:3});
const getRoom=(body)=>rooms.get(String(body.code||'').toUpperCase());
function serve(req,res){let url;try{url=new URL(req.url,'http://localhost');}catch{return send(res,400,{error:'Invalid URL'});}
 if(req.method==='GET'&&url.pathname==='/api/state'){let r=rooms.get((url.searchParams.get('code')||'').toUpperCase());return r?send(res,200,view(r)):send(res,404,{error:'Room not found'});}
 if(req.method==='POST'&&url.pathname.startsWith('/api/')){
  let raw='';req.on('data',c=>{raw+=c;if(raw.length>8192)req.destroy();});req.on('end',()=>{let b;try{b=JSON.parse(raw)}catch{return send(res,400,{error:'Invalid request'});}const action=url.pathname.slice(5);
   if(action==='create'){let c;do{c=code()}while(rooms.has(c));let id=crypto.randomUUID(),r={code:c,host:id,status:'lobby',startedAt:null,endedAt:null,champion:null,players:new Map(),created:Date.now()};r.players.set(id,makePlayer(id,safeName(b.name),0));rooms.set(c,r);return send(res,200,{code:c,id,state:view(r)});}
   let r=getRoom(b);if(!r)return send(res,404,{error:'Room not found'});
   if(action==='join'){if(r.status!=='lobby')return send(res,409,{error:'Race already started'});if(r.players.size>=8)return send(res,409,{error:'Room is full'});let id=crypto.randomUUID();r.players.set(id,makePlayer(id,safeName(b.name),r.players.size));return send(res,200,{code:r.code,id,state:view(r)});}
   const p=r.players.get(b.id);if(!p)return send(res,403,{error:'Player not in room'});p.seen=Date.now();
   if(action==='input'){if(r.status==='racing'){p.throttle=!!b.throttle;p.brake=!!b.brake;p.steer=Math.max(-1,Math.min(1,Number(b.steer)||0));}return send(res,200,{ok:true});}
   if(action==='start'){if(r.host!==p.id)return send(res,403,{error:'Only the host can start'});if(r.status!=='lobby'&&r.status!=='finished')return send(res,409,{error:'Race in progress'});if(r.players.size<2)return send(res,409,{error:'At least 2 racers required'});r.status='countdown';r.startedAt=Date.now()+3000;r.endedAt=null;r.champion=null;for(const q of r.players.values()){q.progress=0;q.lane=0;q.speed=0;q.finishedAt=null;q.throttle=false;q.brake=false;q.steer=0;}return send(res,200,view(r));}
   if(action==='leave'){if(r.status==='lobby'){r.players.delete(p.id);if(p.id===r.host)r.host=r.players.keys().next().value||null;if(!r.players.size)rooms.delete(r.code);}return send(res,200,{ok:true});}
   return send(res,404,{error:'Unknown action'});
  });return;
 }
 if(req.method!=='GET')return send(res,405,{error:'Unsupported method'});
 let pathname=url.pathname==='/'?'/index.html':url.pathname;
 let filepath=path.resolve(__dirname,'public','.'+pathname);let root=path.resolve(__dirname,'public');if(!filepath.startsWith(root+path.sep))return send(res,403,{error:'Forbidden'});
 fs.readFile(filepath,(err,body)=>{if(err){res.writeHead(404);return res.end('Not found');}res.writeHead(200,{'Content-Type':filepath.endsWith('.js')?'text/javascript':filepath.endsWith('.css')?'text/css':'text/html','Cache-Control':'no-cache'});res.end(body);});
}
function makePlayer(id,name,i){return {id,name,color:colors[i],ready:true,progress:0,lane:0,speed:0,finishedAt:null,throttle:false,brake:false,steer:0,seen:Date.now()};}
function tick(){const now=Date.now();for(const [key,r] of rooms){if(now-r.created>4*3600*1000){rooms.delete(key);continue;}if(r.status==='countdown'&&now>=r.startedAt)r.status='racing';if(r.status!=='racing')continue;const dt=.033;
 for(const p of r.players.values()){
  if(p.finishedAt!==null)continue;
  if(now-p.seen>2000){p.throttle=false;p.brake=true;p.steer=0;}
  let accel=p.throttle?0.23:0;let friction=.075+p.speed*.085;let offroad=Math.abs(p.lane)>1?1:.0;
  p.speed=Math.max(0,Math.min(.31,p.speed+(accel-friction-(p.brake?.6:0)-offroad*.35)*dt));
  p.lane=Math.max(-1.4,Math.min(1.4,p.lane+p.steer*dt*(.45+p.speed*1.3)));
  p.progress+=p.speed*dt*(offroad?.38:1);
  if(p.progress>=3){p.progress=3;p.finishedAt=now;if(!r.champion)r.champion=p.id;}
 }
 if([...r.players.values()].every(p=>p.finishedAt!==null)||r.champion&&now-r.players.get(r.champion).finishedAt>15000){r.status='finished';r.endedAt=now;}
 }}
setInterval(tick,33);
const server=http.createServer(serve);server.listen(PORT,'0.0.0.0',()=>console.log(`Loop Racers listening at http://localhost:${PORT}`));
