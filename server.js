const express=require("express");
const http=require("http");
const path=require("path");
const crypto=require("crypto");
const {Server}=require("socket.io");
const {createClient}=require("@supabase/supabase-js");

const app=express();
const server=http.createServer(app);
const io=new Server(server);
const PORT=process.env.PORT||3000;
const SUPABASE_URL=process.env.SUPABASE_URL||"";
const SUPABASE_SERVICE_ROLE_KEY=process.env.SUPABASE_SERVICE_ROLE_KEY||"";
const SUPABASE_BUCKET=process.env.SUPABASE_BUCKET||"movie-night";
const supabase=SUPABASE_URL&&SUPABASE_SERVICE_ROLE_KEY
  ? createClient(SUPABASE_URL,SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}})
  : null;

app.use(express.json({limit:"2mb"}));
app.use(express.static(path.join(__dirname,"public")));
const rooms=new Map();

function roomState(roomId){
  if(!rooms.has(roomId)) rooms.set(roomId,{movie:null,playing:false,currentTime:0,updatedAt:Date.now(),users:new Map(),hostId:null,storagePath:null});
  return rooms.get(roomId);
}
function cleanUrl(value){
  if(typeof value!=="string") return "";
  try{const u=new URL(value.trim()); if(!["http:","https:"].includes(u.protocol)) return ""; return u.toString().slice(0,4000)}catch{return ""}
}
function cleanText(value,max=400){return String(value||"").replace(/<[^>]*>/g,"").trim().slice(0,max)}
function isPlayableFile(name){return /\.(mp4|webm|ogv|ogg)(\?|$)/i.test(name||"")}
function safeFileName(name){
  return String(name||"movie.mp4").normalize("NFKC").replace(/[^a-zA-Z0-9._-]/g,"_").slice(0,100)||"movie.mp4";
}
function mediaConfigured(){return !!supabase}
function effectiveTime(room){
  if(!room.playing) return room.currentTime;
  return room.currentTime+Math.max(0,(Date.now()-room.updatedAt)/1000);
}
async function signedPlayback(pathname){
  if(!supabase||!pathname) return "";
  const {data,error}=await supabase.storage.from(SUPABASE_BUCKET).createSignedUrl(pathname,60*60*12);
  if(error) throw error;
  return data?.signedUrl||"";
}
async function loadDbRoom(roomId){
  if(!supabase) return null;
  const {data,error}=await supabase.from("movie_rooms").select("*").eq("room_id",roomId).maybeSingle();
  if(error) throw error;
  if(!data) return null;
  const room=roomState(roomId);
  room.storagePath=data.storage_path||null;
  const sourceUrl=cleanUrl(data.source_url||"");
  const sourceMode=data.source_mode==="embed"?"embed":"video";
  if(sourceUrl){
    room.movie={title:data.title||"Movie",year:"",sourceName:sourceMode==="embed"?"Embed":"Direct URL",playable:true,videoUrl:sourceMode==="video"?sourceUrl:"",embedUrl:sourceMode==="embed"?sourceUrl:"",subtitleFaUrl:""};
  }else{
    room.movie={title:data.title||"Movie",year:"",sourceName:"Supabase Storage",playable:true,videoUrl:await signedPlayback(data.storage_path),embedUrl:"",subtitleFaUrl:""};
  }
  room.currentTime=Number(data.position_seconds)||0;
  room.playing=!!data.playing;
  room.updatedAt=new Date(data.updated_at||data.created_at).getTime();
  return room;
}
async function persistRoom(roomId,room){
  if(!supabase) return;
  const {error}=await supabase.from("movie_rooms").update({
    position_seconds:Number(effectiveTime(room).toFixed(3)),
    playing:!!room.playing,
    updated_at:new Date().toISOString()
  }).eq("room_id",roomId);
  if(error) console.error("Supabase room update:",error.message);
}
async function deleteStoredRoom(roomId,storagePath){
  if(!supabase) return;
  try{
    if(storagePath) await supabase.storage.from(SUPABASE_BUCKET).remove([storagePath]);
    await supabase.from("movie_rooms").delete().eq("room_id",roomId);
  }catch(e){console.error("Supabase cleanup:",e.message)}
}

function linkSource(value){
  const url=cleanUrl(value); if(!url) return null;
  const direct=/\.(mp4|webm|ogv|ogg)(\?|$)/i.test(url);
  return {url,mode:direct?"video":"embed",embedUrl:url};
}
app.post("/api/play-link/room",async(req,res)=>{
  if(!supabase) return res.status(503).json({error:"Supabase Storage هنوز به Railway وصل نشده است."});
  const source=linkSource(req.body?.url);
  if(!source) return res.status(400).json({error:"لینک معتبر http/https وارد کن."});
  const roomId=cleanText(req.body?.roomId,32).replace(/[^A-Z0-9_-]/gi,"");
  const title=cleanText(req.body?.title||"پخش با لینک",160);
  if(!roomId) return res.status(400).json({error:"Room ID نامعتبر است."});
  const row={room_id:roomId,storage_path:null,source_url:source.url,source_mode:source.mode,title,duration_seconds:0,position_seconds:0,playing:false,host_id:null,expires_at:new Date(Date.now()+6*60*60*1000).toISOString(),updated_at:new Date().toISOString()};
  const {error}=await supabase.from("movie_rooms").upsert(row,{onConflict:"room_id"});
  if(error) return res.status(500).json({error:"ذخیره اتاق لینک شکست خورد.",details:error.message});
  res.json({roomId,movie:{title,year:"",sourceName:source.mode==="embed"?"Embed":"Direct URL",playable:true,videoUrl:source.mode==="video"?source.url:"",embedUrl:source.mode==="embed"?source.url:"",subtitleFaUrl:""},expiresAt:row.expires_at});
});

app.get("/api/play-link",(req,res)=>{
  const source=linkSource(req.query.url);
  if(!source) return res.status(400).json({error:"لینک معتبر http/https وارد کن."});
  res.json({source});
});

app.get("/api/media/config",(req,res)=>res.json({configured:mediaConfigured(),bucket:SUPABASE_BUCKET,url:SUPABASE_URL,publishableKey:process.env.SUPABASE_PUBLISHABLE_KEY||""}));

app.post("/api/media/upload-url",async(req,res)=>{
  if(!supabase) return res.status(503).json({error:"Supabase Storage هنوز به Railway وصل نشده است."});
  const roomId=cleanText(req.body?.roomId,32).replace(/[^A-Z0-9_-]/gi,"");
  const filename=safeFileName(req.body?.filename);
  const contentType=String(req.body?.contentType||"video/mp4").slice(0,100);
  if(!roomId) return res.status(400).json({error:"Room ID نامعتبر است."});
  if(!isPlayableFile(filename)) return res.status(400).json({error:"فقط MP4/WebM/OGV/OGG مجاز است."});
  if(!/^video\//i.test(contentType)) return res.status(400).json({error:"فایل باید ویدیویی باشد."});
  const storagePath="rooms/"+roomId+"/"+crypto.randomUUID()+"-"+filename;
  const {data,error}=await supabase.storage.from(SUPABASE_BUCKET).createSignedUploadUrl(storagePath);
  if(error) return res.status(500).json({error:"ساخت لینک آپلود شکست خورد.",details:error.message});
  res.json({path:storagePath,token:data.token});
});

app.post("/api/media/complete",async(req,res)=>{
  if(!supabase) return res.status(503).json({error:"Supabase Storage هنوز به Railway وصل نشده است."});
  const roomId=cleanText(req.body?.roomId,32).replace(/[^A-Z0-9_-]/gi,"");
  const storagePath=String(req.body?.path||"");
  const title=cleanText(req.body?.title||"Movie",160);
  const duration=Math.max(0,Number(req.body?.duration)||0);
  if(!roomId||!storagePath.startsWith("rooms/"+roomId+"/")) return res.status(400).json({error:"مسیر فایل نامعتبر است."});
  const videoUrl=await signedPlayback(storagePath);
  const row={room_id:roomId,storage_path:storagePath,title,duration_seconds:duration,position_seconds:0,playing:false,host_id:null,expires_at:new Date(Date.now()+6*60*60*1000).toISOString(),updated_at:new Date().toISOString()};
  const {error}=await supabase.from("movie_rooms").upsert(row,{onConflict:"room_id"});
  if(error) return res.status(500).json({error:"ذخیره اطلاعات اتاق شکست خورد.",details:error.message});
  res.json({movie:{title,year:"",sourceName:"Supabase Storage",playable:true,videoUrl,embedUrl:"",subtitleFaUrl:""},expiresAt:row.expires_at});
});

async function omdbSearch(q){
  const key=process.env.OMDB_API_KEY; if(!key)return [];
  const r=await fetch("https://www.omdbapi.com/?apikey="+encodeURIComponent(key)+"&s="+encodeURIComponent(q)+"&type=movie&page=1");
  const data=await r.json(); if(!r.ok||data.Response==="False")return [];
  return (data.Search||[]).slice(0,8).map(m=>({title:cleanText(m.Title,160),year:String(m.Year||"").slice(0,4),overview:"",originalAudio:true,persianSubtitle:false,persianDub:false,playable:false,videoUrl:"",subtitleFaUrl:"",sourceName:"OMDb",sourceUrl:m.imdbID?"https://www.imdb.com/title/"+m.imdbID:"",poster:m.Poster&&m.Poster!=="N/A"?m.Poster:""}));
}
async function archiveSearch(q){
  const r=await fetch("https://archive.org/advancedsearch.php?q="+encodeURIComponent('title:("'+q+'") AND mediatype:movies')+"&fl[]=identifier,title,description,year,licenseurl,rights&rows=8&page=1&output=json");
  const data=await r.json(); if(!r.ok)throw new Error("Internet Archive search failed");
  const out=[];
  for(const item of data?.response?.docs||[]){
    try{
      const mr=await fetch("https://archive.org/metadata/"+encodeURIComponent(item.identifier)),meta=await mr.json();
      const text=[item.licenseurl,item.rights,item.description,meta.licenseurl,meta.rights,meta.description].filter(Boolean).join(" ").toLowerCase();
      if(!/public domain|publicdomain|creative commons|creativecommons|cc by|cc0|no known copyright/i.test(text))continue;
      const file=(meta.files||[]).find(f=>isPlayableFile(f.name)&&!f.private); if(!file)continue;
      const videoUrl=cleanUrl("https://archive.org/download/"+encodeURIComponent(item.identifier)+"/"+encodeURIComponent(file.name)); if(!videoUrl)continue;
      out.push({title:cleanText(item.title||q,160),year:String(item.year||"").slice(0,4),overview:cleanText(item.description||"",400),originalAudio:true,persianSubtitle:false,persianDub:false,playable:true,videoUrl,subtitleFaUrl:"",sourceName:"Internet Archive",sourceUrl:"https://archive.org/details/"+encodeURIComponent(item.identifier),poster:""});
    }catch{}
  }
  return out;
}
async function freeAiEnrich(query,candidates){
  if(!process.env.OPENROUTER_API_KEY||!candidates.length)return candidates;
  const compact=candidates.map((x,i)=>({i,title:x.title,year:x.year,overview:x.overview,sourceName:x.sourceName,playable:x.playable}));
  const response=await fetch("https://openrouter.ai/api/v1/chat/completions",{method:"POST",headers:{Authorization:"Bearer "+process.env.OPENROUTER_API_KEY,"Content-Type":"application/json","HTTP-Referer":process.env.APP_URL||"https://movienight-production-cb51.up.railway.app","X-Title":"Movie Night"},body:JSON.stringify({model:process.env.OPENROUTER_MODEL||"openrouter/free",messages:[{role:"system",content:"Return only valid JSON. No web search. Never fabricate facts."},{role:"user",content:"Given the supplied movie records, return ONLY JSON {results:[{i,originalAudio,persianSubtitle,persianDub}]}. Only use supplied evidence. Query: "+query+" Candidates: "+JSON.stringify(compact)}],temperature:0})});
  if(!response.ok)return candidates;
  const data=await response.json(),text=String(data?.choices?.[0]?.message?.content||""),match=text.match(/\{[\s\S]*\}/); if(!match)return candidates;
  try{const parsed=JSON.parse(match[0]),updates=new Map((parsed.results||[]).map(x=>[Number(x.i),x]));return candidates.map((x,i)=>{const u=updates.get(i);return u?{...x,originalAudio:!!u.originalAudio,persianSubtitle:!!u.persianSubtitle,persianDub:!!u.persianDub}:x})}catch{return candidates}
}
app.get("/api/config",(req,res)=>res.json({movieSearch:!!process.env.OMDB_API_KEY,archiveSearch:true,aiEnrichment:!!process.env.OPENROUTER_API_KEY,mediaStorage:mediaConfigured()}));
app.get("/api/search",async(req,res)=>{
  const q=String(req.query.q||"").trim().slice(0,120); if(!q)return res.status(400).json({error:"Enter a movie name."});
  try{
    const [omdb,archive]=await Promise.all([omdbSearch(q).catch(()=>[]),archiveSearch(q).catch(()=>[])]);
    let results=[...archive,...omdb],seen=new Set();
    results=results.filter(x=>{const k=(x.title+"|"+x.year).toLowerCase();if(seen.has(k))return false;seen.add(k);return true}).slice(0,12);
    results=await freeAiEnrich(q,results);
    res.json({results,meta:{omdb:omdb.length>0,archive:archive.length>0,ai:!!process.env.OPENROUTER_API_KEY}});
  }catch(e){res.status(502).json({error:"Movie search failed.",details:e.message})}
});

io.on("connection",socket=>{
  socket.on("room:join",async({roomId,name,movie})=>{
    if(!roomId)return;
    let room=rooms.get(roomId);
    try{
      if(!room&&supabase)room=await loadDbRoom(roomId);
    }catch(e){console.error("Load room:",e.message)}
    room=room||roomState(roomId);
    socket.join(roomId);socket.data.roomId=roomId;socket.data.name=String(name||"Guest").slice(0,24);
    if(!room.hostId)room.hostId=socket.id;
    room.users.set(socket.id,socket.data.name);
    if(movie&&!room.movie)room.movie=movie;
    socket.emit("room:state",{movie:room.movie,playing:room.playing,currentTime:effectiveTime(room),users:[...room.users.values()],isHost:room.hostId===socket.id});
    io.to(roomId).emit("room:users",{users:[...room.users.values()]});
  });

  socket.on("player:change",async({roomId,playing,currentTime,movie})=>{
    const room=rooms.get(roomId);if(!room||room.hostId!==socket.id)return;
    room.playing=!!playing;room.currentTime=Math.max(0,Number(currentTime)||0);room.updatedAt=Date.now();if(movie)room.movie=movie;
    socket.to(roomId).emit("player:change",{playing:room.playing,currentTime:room.currentTime,movie:room.movie});
    persistRoom(roomId,room);
  });

  socket.on("room:movie",({roomId,movie})=>{
    const room=rooms.get(roomId);if(!room||room.hostId!==socket.id)return;
    room.movie=movie;room.playing=false;room.currentTime=0;room.updatedAt=Date.now();io.to(roomId).emit("room:movie",{movie});
  });

  socket.on("chat:message",({roomId,message})=>{const text=String(message||"").trim().slice(0,500);if(!text)return;io.to(roomId).emit("chat:message",{name:socket.data.name||"Guest",message:text,time:Date.now()})});

  socket.on("player:ended",async({roomId})=>{
    const room=rooms.get(roomId);if(!room||room.hostId!==socket.id)return;
    room.playing=false;room.currentTime=0;room.updatedAt=Date.now();io.to(roomId).emit("player:ended");
    if(room.users.size===0){
      if(room.storagePath) await deleteStoredRoom(roomId,room.storagePath);
      else if(supabase) await supabase.from("movie_rooms").delete().eq("room_id",roomId);
    }
  });

  socket.on("disconnect",async()=>{
    const roomId=socket.data.roomId;if(!roomId)return;
    const room=rooms.get(roomId);if(!room)return;
    room.users.delete(socket.id);if(room.hostId===socket.id)room.hostId=room.users.keys().next().value||null;
    if(room.users.size===0){
      if(room.storagePath) await deleteStoredRoom(roomId,room.storagePath);
      else if(supabase) await supabase.from("movie_rooms").delete().eq("room_id",roomId);
      rooms.delete(roomId);
    }
    else io.to(roomId).emit("room:users",{users:[...room.users.values()]});
  });
});

async function cleanupExpiredRooms(){
  if(!supabase)return;
  try{
    const {data,error}=await supabase.from("movie_rooms").select("room_id,storage_path").lt("expires_at",new Date().toISOString());
    if(error)throw error;
    for(const row of data||[]){if(!rooms.has(row.room_id))await deleteStoredRoom(row.room_id,row.storage_path)}
  }catch(e){console.error("Expiry cleanup:",e.message)}
}
setInterval(cleanupExpiredRooms,5*60*1000);
cleanupExpiredRooms();

app.use((req,res)=>res.sendFile(path.join(__dirname,"public","index.html")));
server.listen(PORT,()=>console.log("Movie Night running on port "+PORT));
