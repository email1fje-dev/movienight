const socket=io();
let roomId=null,isHost=false,currentMovie=null,applyingRemote=false,syncTimer=null;
const $=s=>document.querySelector(s),video=$("#video");

function makeRoom(){return Math.random().toString(36).slice(2,8).toUpperCase()}
function roomFromUrl(){return new URLSearchParams(location.search).get("room")}
function showWatch(){$("#home").classList.add("hidden");$("#watch").classList.remove("hidden");$("#copyRoom").classList.remove("hidden")}
function escapeHtml(s){return String(s).replace(/[&<>\\"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'\\"':"&quot;","'":"&#39;"}[c]))}
function badge(ok,label){return '<span class="badge '+(ok?"yes":"no")+'">'+(ok?"✓":"×")+" "+label+"</span>"}

function renderResults(results){
  const el=$("#results");
  if(!results.length){el.innerHTML='<div class="empty">چیزی پیدا نشد 😭</div>';return}
  el.innerHTML=results.map((m,i)=>'<article class="result">'+
    '<div class="result-icon">'+(m.poster?'<img src="'+escapeHtml(m.poster)+'" alt="">':'🎬')+'</div>'+
    '<div class="result-info"><h2>'+escapeHtml(m.title)+' <small>'+escapeHtml(m.year)+'</small></h2>'+
    '<p>'+escapeHtml(m.overview)+'</p><div class="badges">'+
    badge(m.originalAudio,"زبان اصلی")+badge(m.persianSubtitle,"زیرنویس فارسی")+badge(m.persianDub,"دوبله فارسی")+badge(m.playable,"قابل پخش")+
    '</div><div class="result-actions"><button class="create '+(m.playable?"":"disabled")+'" data-index="'+i+'" '+(m.playable?"":"disabled")+'>'+ 
    (m.playable?"Create Room & Play 🎬":"منبع مستقیم قابل پخش پیدا نشد")+
    '</button>'+(m.sourceUrl?'<a target="_blank" rel="noreferrer" href="'+escapeHtml(m.sourceUrl)+'">منبع</a>':"")+
    '</div></div></article>').join("");
  el.querySelectorAll(".create:not(.disabled)").forEach(b=>b.onclick=()=>createRoom(results[Number(b.dataset.index)]));
}

async function search(){
  const q=$("#searchInput").value.trim();if(!q)return;
  $("#searchStatus").textContent="🔎 دارم از دیتابیس‌های فیلم و منابع عمومی سرچ می‌کنم...";
  $("#searchBtn").disabled=true;
  try{
    const r=await fetch("/api/search?q="+encodeURIComponent(q)),data=await r.json();
    if(!r.ok)throw new Error(data.error||"Search failed");
    renderResults(data.results||[]);
    const info=[];
    if(data.meta?.omdb)info.push("OMDb");
    if(data.meta?.archive)info.push("Internet Archive");
    if(data.meta?.ai)info.push("AI");
    $("#searchStatus").textContent=data.results?.length?("✅ نتیجه‌ها آماده‌ان • "+(info.join(" + ")||"بدون منبع")):"نتیجه قابل استفاده پیدا نشد.";
  }catch(e){$("#searchStatus").textContent="❌ "+e.message}
  finally{$("#searchBtn").disabled=false}
}

async function playByLink(){
  const input=$("#playLinkInput"), status=$("#playLinkStatus");
  const url=input.value.trim(); if(!url) return;
  status.textContent="⏳ در حال بررسی لینک...";
  $("#playLinkBtn").disabled=true;
  try{
    const r=await fetch("/api/play-link?url="+encodeURIComponent(url));
    const data=await r.json();
    if(!r.ok) throw new Error(data.error||"لینک معتبر نیست");
    const source=data.source;
    roomId=makeRoom(); isHost=true;
    history.replaceState(null,"",location.pathname+"?room="+roomId);
    showWatch();
    setMovie({title:"پخش با لینک",year:"",sourceName:source.mode==="embed"?"Embed":"Direct URL",playable:true,videoUrl:source.mode==="video"?source.url:"",embedUrl:source.mode==="embed"?source.embedUrl:"",subtitleFaUrl:""});
    $("#roomCode").textContent=roomId;
    socket.emit("room:join",{roomId,name:"Guest",movie:currentMovie});
    status.textContent="✅ لینک آماده شد";
  }catch(e){status.textContent="❌ "+e.message}
  finally{$("#playLinkBtn").disabled=false}
}

function applyRoomTime(time){
  const t=Math.max(0,Number(time)||0);
  applyingRemote=true;
  const apply=()=>{try{video.currentTime=t}catch{} finally{applyingRemote=false}};
  if(video.readyState>=1) apply();
  else video.addEventListener("loadedmetadata",apply,{once:true});
}
function setMovie(movie){
  currentMovie=movie;
  $("#title").textContent=movie.title;
  $("#meta").textContent=[movie.year,movie.sourceName].filter(Boolean).join(" • ");
  video.pause();video.innerHTML="";
  video.classList.add("hidden");
  const oldFrame=$("#embedFrame"); if(oldFrame) oldFrame.remove();
  $("#noVideo").classList.toggle("hidden",!!movie.videoUrl||!!movie.embedUrl);
  if(movie.videoUrl){
    video.classList.remove("hidden");
    const s=document.createElement("source");s.src=movie.videoUrl;
    const ext=(movie.videoUrl.match(/\.([a-z0-9]+)(?:\?|$)/i)||[])[1]?.toLowerCase();
    s.type=ext==="webm"?"video/webm":ext==="ogv"||ext==="ogg"?"video/ogg":"video/mp4";
    video.appendChild(s);
    if(movie.subtitleFaUrl){const t=document.createElement("track");t.src=movie.subtitleFaUrl;t.kind="subtitles";t.srclang="fa";t.label="فارسی";t.default=true;video.appendChild(t)}
    video.load();
  } else if(movie.embedUrl){
    video.pause();
    video.classList.add("hidden");
    const frame=document.createElement("iframe");
    frame.id="embedFrame"; frame.src=movie.embedUrl; frame.title=movie.title||"Video";
    frame.allow="autoplay; fullscreen; picture-in-picture"; frame.allowFullscreen=true;
    frame.referrerPolicy="strict-origin-when-cross-origin";
    frame.style.cssText="width:100%;height:100%;border:0;min-height:420px;background:#000";
    $(".player-wrap").prepend(frame);
  }
}
function createRoom(movie){
  if(!movie?.playable)return;
  roomId=makeRoom();isHost=true;
  history.replaceState(null,"",location.pathname+"?room="+roomId);
  showWatch();setMovie(movie);$("#roomCode").textContent=roomId;
  socket.emit("room:join",{roomId,name:"Guest",movie});
}
function joinRoom(){
  const r=roomFromUrl();if(!r)return;
  roomId=r;isHost=false;showWatch();socket.emit("room:join",{roomId,name:"Guest"});
}
function sync(){
  if(!isHost||!currentMovie||applyingRemote)return;
  socket.emit("player:change",{roomId,playing:!video.paused,currentTime:video.currentTime,movie:currentMovie,serverTime:Date.now()});
}
video.addEventListener("play",sync);video.addEventListener("pause",sync);video.addEventListener("seeked",sync);
function startSync(){
  clearInterval(syncTimer);
  syncTimer=setInterval(()=>{if(isHost&&!video.paused)sync()},1000);
}
function ensureMobilePlayback(){
  if(video.src||video.querySelector("source")){
    video.muted=true;
    video.play().then(()=>{
      const btn=$("#enableSound"); if(btn)btn.classList.remove("hidden");
    }).catch(()=>{});
  }
}
function enableSound(){video.muted=false;video.play().catch(()=>{});$("#enableSound").classList.add("hidden");sync()}

socket.on("room:state",s=>{
  isHost=s.isHost;$("#roomCode").textContent=roomId;renderUsers(s.users);
  if(s.movie)setMovie(s.movie);
  const roomTime=Number(s.currentTime)||0;
  if(s.movie?.videoUrl){
    const waitForMedia=()=>{
      applyRoomTime(roomTime);
      if(s.playing)ensureMobilePlayback();
      if(isHost)startSync();
    };
    if(video.readyState>=1) waitForMedia();
    else video.addEventListener("loadedmetadata",waitForMedia,{once:true});
  } else {
    if(isHost)startSync();
  }
});
socket.on("player:change",s=>{
  if(isHost)return;
  if(s.movie&&!currentMovie?.title)setMovie(s.movie);
  applyingRemote=true;
  try{
    if(Math.abs(video.currentTime-(s.currentTime||0))>0.75)video.currentTime=s.currentTime||0;
    if(s.playing){video.muted=true;video.play().catch(()=>{});}
    else video.pause();
  }finally{setTimeout(()=>applyingRemote=false,50)}
});
socket.on("room:movie",({movie})=>setMovie(movie));
socket.on("room:users",({users})=>renderUsers(users));
socket.on("chat:message",m=>{
  const d=document.createElement("div");d.className="msg";d.innerHTML="<b>"+escapeHtml(m.name)+"</b> <span>"+escapeHtml(m.message)+"</span>";
  $("#messages").appendChild(d);$("#messages").scrollTop=$("#messages").scrollHeight;
});
function renderUsers(users){$("#users").innerHTML=users.map(u=>'<div class="user">'+escapeHtml(u)+"</div>").join("");$("#count").textContent=users.length}
async function copy(){await navigator.clipboard?.writeText(location.href);$("#copyRoom").textContent="کپی شد ✓";setTimeout(()=>$("#copyRoom").textContent="🔗 کپی لینک اتاق",1200)}

$("#searchBtn").onclick=search;
$("#playLinkBtn").onclick=playByLink;
$("#playLinkInput").onkeydown=e=>{if(e.key==="Enter")playByLink()};
$("#searchInput").onkeydown=e=>{if(e.key==="Enter")search()};
$("#copyRoom").onclick=copy;$("#copyRoom2").onclick=copy;$("#enableSound").onclick=enableSound;
$("#leave").onclick=()=>location.href=location.pathname;
$("#chatForm").onsubmit=e=>{e.preventDefault();const input=$("#chatInput");socket.emit("chat:message",{roomId,message:input.value});input.value=""};
fetch("/api/config").then(r=>r.json()).then(x=>{
  if(!x.movieSearch)$("#searchStatus").textContent="ℹ️ OMDB_API_KEY اضافه نشده؛ فقط منابع عمومی قابل جست‌وجو هستند.";
});
joinRoom();
