/*
 * Небольшой сервер игры: статика, WebSocket-ретрансляция комнат и рекорды.
 * Только встроенные модули Node.js — npm install не требуется.
 * Запуск: node server.js (http://localhost:8001)
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 8001);
const SCORE_FILE = path.join(ROOT, '.leaderboard.json');
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const rooms = new Map();
const clients = new Set();
let scores = [];
try { scores = JSON.parse(fs.readFileSync(SCORE_FILE, 'utf8')); if (!Array.isArray(scores)) scores = []; } catch (_) {}

function sendJson(res, code, data) {
  const body = JSON.stringify(data);
  res.writeHead(code, { 'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store',
    'Access-Control-Allow-Origin':'*', 'Access-Control-Allow-Methods':'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers':'Content-Type' });
  res.end(body);
}
function rankedScores(list) {
  return list.sort((a,b) => (b.wave-a.wave) || (b.kills-a.kills) || (a.seconds-b.seconds)).slice(0,100);
}
function saveScore(entry) {
  const clean = {
    name: String(entry.name || 'Игрок').replace(/[<>\u0000-\u001f]/g,'').slice(0,16) || 'Игрок',
    wave: Math.max(0, Math.min(999, Number(entry.wave) || 0)),
    kills: Math.max(0, Math.min(100000, Number(entry.kills) || 0)),
    seconds: Math.max(0, Math.min(86400, Number(entry.seconds) || 0)),
    mode: String(entry.mode || 'survival').slice(0,16),
    map: String(entry.map || 'nacht').slice(0,16),
    date: new Date().toISOString().slice(0,10)
  };
  scores = rankedScores([clean, ...scores]);
  try { fs.writeFileSync(SCORE_FILE, JSON.stringify(scores, null, 2)); } catch (e) { console.error('Не удалось сохранить таблицу:', e.message); }
  return clean;
}

const server = http.createServer((req,res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (req.method === 'OPTIONS') { res.writeHead(204, {'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET,POST,OPTIONS','Access-Control-Allow-Headers':'Content-Type'}); return res.end(); }
  if (url.pathname === '/api/leaderboard' && req.method === 'GET') return sendJson(res,200,{entries:scores});
  if (url.pathname === '/api/score' && req.method === 'POST') {
    let body=''; req.on('data',chunk=>{body+=chunk;if(body.length>10000)req.destroy();});
    req.on('end',()=>{try{const entry=saveScore(JSON.parse(body||'{}'));sendJson(res,201,{ok:true,entry,entries:scores});}
      catch(_){sendJson(res,400,{ok:false,error:'Некорректная запись'});}}); return;
  }
  if (url.pathname.startsWith('/api/')) return sendJson(res,404,{error:'not found'});
  let pathname;
  try { pathname = decodeURIComponent(url.pathname); } catch (_) { res.writeHead(400); return res.end('Bad path'); }
  if (pathname === '/') pathname = '/index.html';
  if (pathname.split('/').some(part => part.startsWith('.') && part.length > 1)) { res.writeHead(403); return res.end('Forbidden'); }
  const file = path.resolve(ROOT, '.' + pathname);
  if (!file.startsWith(ROOT + path.sep) && file !== path.join(ROOT,'index.html')) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(file,(err,data)=>{
    if(err){res.writeHead(404,{'Content-Type':'text/plain; charset=utf-8'});return res.end('Not found');}
    const ext=path.extname(file).toLowerCase();
    const type=ext==='.html'?'text/html; charset=utf-8':ext==='.js'?'text/javascript; charset=utf-8':ext==='.json'?'application/json; charset=utf-8':'application/octet-stream';
    res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'});res.end(data);
  });
});

function frame(payload, opcode=1) {
  const data = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
  let head;
  if (data.length < 126) { head = Buffer.from([0x80|opcode,data.length]); }
  else if (data.length < 65536) { head=Buffer.alloc(4);head[0]=0x80|opcode;head[1]=126;head.writeUInt16BE(data.length,2); }
  else { head=Buffer.alloc(10);head[0]=0x80|opcode;head[1]=127;head.writeBigUInt64BE(BigInt(data.length),2); }
  return Buffer.concat([head,data]);
}
function send(client, data) {
  if (!client || client.socket.destroyed) return;
  try { client.socket.write(frame(JSON.stringify(data))); } catch (_) {}
}
function roomBroadcast(room, data, except) {
  for (const c of room.clients) if (c !== except) send(c,data);
}
function closeClient(client) {
  if (!client || client.closed) return;
  client.closed=true;clients.delete(client);
  const room=rooms.get(client.room);
  if(room){
    room.clients.delete(client);
    if(room.host===client){room.host=room.clients.values().next().value||null;if(room.host)send(room.host,{type:'host',host:true});}
    roomBroadcast(room,{type:'peer-left',id:client.id,players:room.clients.size},null);
    if(!room.clients.size)rooms.delete(client.room);
  }
}
function handleMessage(client,text){
  let msg;try{msg=JSON.parse(text);}catch(_){return;}
  const room=rooms.get(client.room);if(!room)return;
  if(!msg||typeof msg.type!=='string')return;
  if(msg.type==='score'){
    const entry=saveScore(msg);
    roomBroadcast(room,{type:'score-saved',entry},null);
    send(client,{type:'leaderboard',entries:scores});return;
  }
  if(msg.type==='leaderboard'){send(client,{type:'leaderboard',entries:scores});return;}
  if(msg.type==='world' && room.host!==client)return;
  if(msg.type==='state'){
    client.lastState=msg;
    roomBroadcast(room,{...msg,id:client.id},client);return;
  }
  // События мира, урона, попаданий, дверей и действий пересылаются участникам комнаты.
  if(['world','damage','hit','door','action'].includes(msg.type))roomBroadcast(room,{...msg,from:client.id},client);
}
function consumeFrames(client,chunk){
  client.buffer=Buffer.concat([client.buffer,chunk]);
  while(client.buffer.length>=2){
    const b0=client.buffer[0],b1=client.buffer[1],opcode=b0&0x0f,masked=!!(b1&0x80);
    let len=b1&0x7f,offset=2;
    if(len===126){if(client.buffer.length<4)return;len=client.buffer.readUInt16BE(2);offset=4;}
    else if(len===127){if(client.buffer.length<10)return;const big=client.buffer.readBigUInt64BE(2);if(big>1_000_000n){closeClient(client);return;}len=Number(big);offset=10;}
    const maskBytes=masked?4:0;if(client.buffer.length<offset+maskBytes+len)return;
    let payload=client.buffer.subarray(offset+maskBytes,offset+maskBytes+len);
    if(masked){payload=Buffer.from(payload);const mask=client.buffer.subarray(offset,offset+4);for(let i=0;i<payload.length;i++)payload[i]^=mask[i%4];}
    client.buffer=client.buffer.subarray(offset+maskBytes+len);
    if(opcode===8){try{client.socket.write(frame(Buffer.alloc(0),8));}catch(_){}client.socket.end();closeClient(client);return;}
    if(opcode===9){try{client.socket.write(frame(payload,10));}catch(_){}continue;}
    if(opcode===1)handleMessage(client,payload.toString('utf8'));
  }
}
server.on('upgrade',(req,socket)=>{
  const url=new URL(req.url,`http://${req.headers.host||'localhost'}`);
  if(url.pathname!=='/ws'){socket.write('HTTP/1.1 404 Not Found\r\n\r\n');return socket.destroy();}
  const key=req.headers['sec-websocket-key'];if(!key){socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');return socket.destroy();}
  const accept=crypto.createHash('sha1').update(key+WS_GUID).digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: '+accept+'\r\n\r\n');
  const roomId=String(url.searchParams.get('room')||'NACHT').replace(/[^a-zA-Z0-9_-]/g,'').slice(0,18)||'NACHT';
  const client={socket,room:roomId,id:crypto.randomBytes(5).toString('hex'),buffer:Buffer.alloc(0),closed:false,lastState:null};
  let room=rooms.get(roomId);if(!room){room={clients:new Set(),host:null};rooms.set(roomId,room);}
  room.clients.add(client);clients.add(client);
  if(!room.host){room.host=client;client.isHost=true;} else client.isHost=false;
  send(client,{type:'welcome',id:client.id,host:client.isHost,players:room.clients.size,room:roomId});
  if(room.host!==client&&room.host.lastState)send(client,{...room.host.lastState,type:'state',id:room.host.id});
  roomBroadcast(room,{type:'peer-joined',id:client.id,players:room.clients.size},client);
  socket.on('data',data=>consumeFrames(client,data));
  socket.on('close',()=>closeClient(client));socket.on('end',()=>closeClient(client));socket.on('error',()=>closeClient(client));
});
server.listen(PORT,'0.0.0.0',()=>console.log(`Игра и кооп-сервер: http://0.0.0.0:${PORT} (порт ${PORT})`));
process.on('SIGINT',()=>{for(const c of clients){try{c.socket.end();}catch(_){}}server.close(()=>process.exit(0));});
