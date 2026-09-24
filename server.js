const express=require("express");
const http=require("http");
const path=require("path");
const {Server}=require("socket.io");

const app=express();
const server=http.createServer(app);
const io=new Server(server);
const PORT=process.env.PORT||3000;

app.use(express.json());
app.use(express.static(path.join(__dirname,"public")));

const rooms=new Map();

function roomState(room){
  if(!rooms.has(room)) rooms.set(room,{movie:null,playing:false,currentTime:0,updatedAt:Date.now(),users:new Map(),hostId:null});
  return rooms.get(room);
}
function cleanUrl(value){
  if(typeof value!=="string") return "";
  try{
    const u=new URL(value.trim());
    if(u.protocol!=="http:"&&u.protocol!=="https:") return "";
    return u.toString().slice(0,2000);
  }catch{return ""}
}
function cleanText(value,max=400){
  return String(value||"").replace(/<[^>]*>/g,"").trim().slice(0,max);
}
function isPlayableFile(name){
  return /\.(mp4|webm|ogv|ogg)(\?|$)/i.test(name||"");
}
function isAuthorizedArchiveItem(meta){
  const text=[meta?.licenseurl,meta?.rights,meta?.description].filter(Boolean).join(" ").toLowerCase();
  return /public domain|publicdomain|creative commons|creativecommons|cc by|cc0|no known copyright/i.test(text);
}

function linkSource(value){
  const url=cleanUrl(value);
  if(!url) return null;
  const lower=url.toLowerCase();
  const direct=/\\.(mp4|webm|ogv|ogg)(\\?|$)/i.test(lower);
  let embedUrl=url;
  try{
    const u=new URL(url);
    if(/(^|\\.)aparat\\.com$/i.test(u.hostname)||/(^|\\.)aparat\.ir$/i.test(u.hostname)){
      // Keep official Aparat page/embed URLs as-is; the browser will only embed
      // them when Aparat permits embedding for that video.
      embedUrl=u.toString();
    }
  }catch{}
  return {url,mode:direct?"video":"embed",embedUrl};
}

app.get("/api/play-link",(req,res)=>{
  const source=linkSource(req.query.url);
  if(!source) return res.status(400).json({error:"لینک معتبر http/https وارد کن."});
  res.json({source});
});

async function omdbSearch(q){
  const key=process.env.OMDB_API_KEY;
  if(!key) return [];
  const url="https://www.omdbapi.com/?apikey="+encodeURIComponent(key)+"&s="+encodeURIComponent(q)+"&type=movie&page=1";
  const r=await fetch(url); const data=await r.json();
  if(!r.ok || data.Response==="False") return [];
  return (data.Search||[]).slice(0,8).map(m=>({title:cleanText(m.Title,160),year:String(m.Year||"").slice(0,4),overview:"",originalAudio:true,persianSubtitle:false,persianDub:false,playable:false,videoUrl:"",subtitleFaUrl:"",sourceName:"OMDb",sourceUrl:m.imdbID?"https://www.imdb.com/title/"+m.imdbID:"",poster:m.Poster&&m.Poster!=="N/A"?m.Poster:""}));
}

async function archiveSearch(q){
  const url="https://archive.org/advancedsearch.php?q="+encodeURIComponent('title:("'+q+'") AND mediatype:movies')+"&fl[]=identifier,title,description,year,licenseurl,rights&rows=8&page=1&output=json";
  const r=await fetch(url);
  const data=await r.json();
  if(!r.ok) throw new Error("Internet Archive search failed");
  const docs=data?.response?.docs||[];
  const out=[];
  for(const item of docs){
    const metaUrl="https://archive.org/metadata/"+encodeURIComponent(item.identifier);
    try{
      const mr=await fetch(metaUrl);
      const meta=await mr.json();
      if(!isAuthorizedArchiveItem({...item,...meta})) continue;
      const file=(meta.files||[]).find(f=>isPlayableFile(f.name)&&!f.private);
      if(!file) continue;
      const videoUrl=cleanUrl("https://archive.org/download/"+encodeURIComponent(item.identifier)+"/"+encodeURIComponent(file.name));
      if(!videoUrl) continue;
      out.push({
        title:cleanText(item.title||q,160),
        year:String(item.year||"").slice(0,4),
        overview:cleanText(item.description||"",400),
        originalAudio:true,
        persianSubtitle:false,
        persianDub:false,
        playable:true,
        videoUrl,
        subtitleFaUrl:"",
        sourceName:"Internet Archive",
        sourceUrl:"https://archive.org/details/"+encodeURIComponent(item.identifier),
        poster:""
      });
    }catch{}
  }
  return out;
}

async function freeAiEnrich(query,candidates){
  if(!process.env.OPENROUTER_API_KEY||!candidates.length) return candidates;
  const compact=candidates.map((x,i)=>({i,title:x.title,year:x.year,overview:x.overview,sourceName:x.sourceName,playable:x.playable})); 
  const prompt="You are a movie metadata assistant. The server already searched trusted APIs; do NOT browse the web and do NOT invent sources. Given the user's movie query and candidate records below, return ONLY JSON: {results:[{i,originalAudio,persianSubtitle,persianDub}]}. Only mark a field true when it is reasonably supported by the supplied record; otherwise false. Persian subtitle/dub are false unless the supplied record explicitly supports them.\nQuery: "+query+"\nCandidates: "+JSON.stringify(compact);
  const response=await fetch("https://openrouter.ai/api/v1/chat/completions",{
    method:"POST",
    headers:{
      Authorization:"Bearer "+process.env.OPENROUTER_API_KEY,
      "Content-Type":"application/json",
      "HTTP-Referer":process.env.APP_URL||"https://movienight-production-cb51.up.railway.app",
      "X-Title":"Movie Night"
    },
    body:JSON.stringify({
      model:process.env.OPENROUTER_MODEL||"openrouter/free",
      messages:[
        {role:"system",content:"Return only valid JSON. No web search. Never fabricate facts."},
        {role:"user",content:prompt}
      ],
      temperature:0
    })
  });
  if(!response.ok) return candidates;
  const data=await response.json();
  const text=data?.choices?.[0]?.message?.content||"";
  const match=text.match(/\{[\s\S]*\}/);
  if(!match) return candidates;
  try{
    const parsed=JSON.parse(match[0]);
    const updates=new Map((parsed.results||[]).map(x=>[Number(x.i),x]));
    return candidates.map((x,i)=>{
      const u=updates.get(i);
      return u?{...x,originalAudio:!!u.originalAudio,persianSubtitle:!!u.persianSubtitle,persianDub:!!u.persianDub}:x;
    });
  }catch{return candidates}
}

app.get("/api/config",(req,res)=>res.json({
  movieSearch:!!process.env.OMDB_API_KEY,
  archiveSearch:true,
  aiEnrichment:!!process.env.OPENROUTER_API_KEY
}));

app.get("/api/search",async(req,res)=>{
  const q=String(req.query.q||"").trim().slice(0,120);
  if(!q) return res.status(400).json({error:"Enter a movie name."});

  try{
    const [omdb,archive]=await Promise.all([
      omdbSearch(q).catch(e=>{console.error("OMDb search:",e.message);return []}),
      archiveSearch(q).catch(e=>{console.error("Archive search:",e.message);return []})
    ]);
    let results=[...archive,...omdb];
    const seen=new Set();
    results=results.filter(x=>{
      const k=(x.title+"|"+x.year).toLowerCase();
      if(seen.has(k)) return false;
      seen.add(k);
      return true;
    }).slice(0,12);
    results=await freeAiEnrich(q,results);
    res.json({results,meta:{omdb:omdb.length>0,archive:archive.length>0,ai:!!process.env.OPENROUTER_API_KEY}});
  }catch(error){
    console.error("Movie search error:",error);
    res.status(502).json({error:"Movie search failed.",details:error.message});
  }
});

io.on("connection",(socket)=>{
  socket.on("room:join",({roomId,name,movie})=>{
    if(!roomId) return;
    const room=roomState(roomId);
    socket.join(roomId);
    socket.data.roomId=roomId;
    socket.data.name=String(name||"Guest").slice(0,24);
    if(!room.hostId) room.hostId=socket.id;
    room.users.set(socket.id,socket.data.name);
    if(movie&&!room.movie) room.movie=movie;
    socket.emit("room:state",{movie:room.movie,playing:room.playing,currentTime:room.currentTime,users:[...room.users.values()],isHost:room.hostId===socket.id});
    io.to(roomId).emit("room:users",{users:[...room.users.values()]});
  });

  socket.on("player:change",({roomId,playing,currentTime,movie})=>{
    const room=rooms.get(roomId); if(!room||room.hostId!==socket.id) return;
    room.playing=!!playing;
    room.currentTime=Number(currentTime)||0;
    room.updatedAt=Date.now();
    if(movie) room.movie=movie;
    socket.to(roomId).emit("player:change",{playing:room.playing,currentTime:room.currentTime,movie:room.movie});
  });

  socket.on("chat:message",({roomId,message})=>{
    const text=String(message||"").trim().slice(0,500); if(!text) return;
    io.to(roomId).emit("chat:message",{name:socket.data.name||"Guest",message:text,time:Date.now()});
  });

  socket.on("room:movie",({roomId,movie})=>{
    const room=rooms.get(roomId); if(!room||room.hostId!==socket.id) return;
    room.movie=movie; room.playing=false; room.currentTime=0; room.updatedAt=Date.now();
    io.to(roomId).emit("room:movie",{movie});
  });

  socket.on("disconnect",()=>{
    const roomId=socket.data.roomId; if(!roomId) return;
    const room=rooms.get(roomId); if(!room) return;
    room.users.delete(socket.id);
    if(room.hostId===socket.id) room.hostId=room.users.keys().next().value||null;
    io.to(roomId).emit("room:users",{users:[...room.users.values()]});
    if(room.users.size===0) rooms.delete(roomId);
  });
});

app.use((req,res)=>res.sendFile(path.join(__dirname,"public","index.html")));
server.listen(PORT,()=>console.log("Movie Night running on port "+PORT));
