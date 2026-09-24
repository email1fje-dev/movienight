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
  return value.trim().slice(0,2000);
}

app.get("/api/config",(req,res)=>res.json({aiSearch:!!process.env.OPENROUTER_API_KEY}));

app.get("/api/search",async(req,res)=>{
  const q=String(req.query.q||"").trim().slice(0,120);
  if(!q) return res.status(400).json({error:"Enter a movie name."});
  if(!process.env.OPENROUTER_API_KEY) return res.status(503).json({error:"OPENROUTER_API_KEY is not configured on Railway yet."});

  const prompt="You are the movie-search assistant for a watch-party website. Search the web for the movie requested by the user: \""+q+"\". Return ONLY valid JSON in this exact shape: {\"results\":[{\"title\":\"string\",\"year\":\"string\",\"overview\":\"short string\",\"originalAudio\":true,\"persianSubtitle\":true,\"persianDub\":false,\"playable\":true,\"videoUrl\":\"https://...\",\"subtitleFaUrl\":\"https://...\",\"sourceName\":\"string\",\"sourceUrl\":\"https://...\"}]}. Rules: Prefer sources that explicitly permit streaming/embedding and public-domain, Creative Commons, or otherwise authorized video. Never invent URLs. If you cannot verify a direct playable video URL, set playable=false and videoUrl=\"\". A Persian subtitle counts only when you found an actual ready-made Persian subtitle resource; do not generate one. Persian dub counts only when a source explicitly says a Persian dubbed track exists. For normal copyrighted movies, do not claim random piracy sites are authorized. Keep at most 6 results.";

  try{
    const response=await fetch("https://openrouter.ai/api/v1/chat/completions",{
      method:"POST",
      headers:{
        "Authorization":"Bearer "+process.env.OPENROUTER_API_KEY,
        "Content-Type":"application/json",
        "HTTP-Referer":process.env.APP_URL||"https://movienight.up.railway.app",
        "X-Title":"Movie Night"
      },
      body:JSON.stringify({
        model:process.env.OPENROUTER_MODEL||"openrouter/free",
        plugins:[{id:"web",max_results:8}],
        messages:[
          {role:"system",content:"You are a careful web research assistant. Never fabricate sources or URLs."},
          {role:"user",content:prompt}
        ],
        temperature:0.1
      })
    });
    const data=await response.json();
    if(!response.ok) throw new Error(data?.error?.message||("OpenRouter HTTP "+response.status));
    const text=data?.choices?.[0]?.message?.content||"";
    const match=text.match(/\{[\s\S]*\}/);
    if(!match) throw new Error("AI did not return JSON.");
    const parsed=JSON.parse(match[0]);
    const results=Array.isArray(parsed.results)?parsed.results.map(x=>({
      title:String(x.title||q).slice(0,160),
      year:String(x.year||"").slice(0,20),
      overview:String(x.overview||"").slice(0,400),
      originalAudio:!!x.originalAudio,
      persianSubtitle:!!x.persianSubtitle,
      persianDub:!!x.persianDub,
      playable:!!x.playable&&!!cleanUrl(x.videoUrl),
      videoUrl:cleanUrl(x.videoUrl),
      subtitleFaUrl:cleanUrl(x.subtitleFaUrl),
      sourceName:String(x.sourceName||"").slice(0,100),
      sourceUrl:cleanUrl(x.sourceUrl)
    })).filter(x=>x.title):[];
    res.json({results});
  }catch(error){
    console.error("AI search error:",error);
    res.status(502).json({error:"AI search failed. Check the OpenRouter key/model in Railway.",details:error.message});
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