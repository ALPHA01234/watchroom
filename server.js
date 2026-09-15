import http from 'node:http';
import fs from 'node:fs';
import { WebSocketServer } from 'ws';

const source=fs.readFileSync(new URL('./worker/index.js',import.meta.url),'utf8');
const start=source.indexOf('const page=`')+'const page=`'.length;
const end=source.indexOf('`;',start);
if(start<12||end<0) throw new Error('Could not read page template');
const page=source.slice(start,end);
const rooms=new Map();
const relay=(room,payload,except)=>{const peers=rooms.get(room);if(!peers)return;const data=JSON.stringify(payload);for(const [id,ws] of peers)if(id!==except&&ws.readyState===1&&(!payload.to||payload.to===id))ws.send(data)};
const server=http.createServer((req,res)=>{if(req.url?.split('?')[0]!=='/'){res.writeHead(404);return res.end('Not found')}res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(page)});
const wss=new WebSocketServer({server,path:'/ws'});
wss.on('connection',(ws,req)=>{const u=new URL(req.url,'http://localhost');const room=(u.searchParams.get('room')||'lobby').slice(0,24);const id=(u.searchParams.get('id')||crypto.randomUUID()).slice(0,80);const name=(u.searchParams.get('name')||'Guest').slice(0,24);if(!rooms.has(room))rooms.set(room,new Map);const peers=rooms.get(room);peers.set(id,ws);relay(room,{type:'count',count:peers.size});ws.on('message',raw=>{let x;try{x=JSON.parse(raw.toString())}catch{return}x.from=id;x.name=name;relay(room,x,id)});const close=()=>{peers.delete(id);relay(room,{type:'count',count:peers.size});if(!peers.size)rooms.delete(room)};ws.on('close',close);ws.on('error',close)});
const port=Number(process.env.PORT||10000);server.listen(port,()=>console.log(`WatchRoom listening on ${port}`));
