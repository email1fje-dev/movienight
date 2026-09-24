const socket=io();
let movies=[],selectedMovie=null,roomId=null,isHost=false;
const $=s=>document.querySelector(s);
const video=$("#video");

function makeRoom(){return Math.random().toString(36).slice(2,8).toUpperCase()}
function roomFromUrl(){return new URLSearchParams(location.search).get("room")}
function showWatch(){ $("#home").classList.add("hidden"); $("#watch").classList.remove("hidden") }
function setMovie(movie){selectedMovie=movie;$("#title").textContent=movie.title;$("#meta").textContent=[movie.year,movie.genre].filter(Boolean).join(" • ");video.pause();video.innerHTML="";$("#noVideo").classList.toggle("hidden",!!movie.videoUrl);if(movie.videoUrl){const s=document.createElement("source");s.src=movie.videoUrl;s.type="video/mp4";video.appendChild(s);if(movie.subtitleFaUrl){const t=document.createElement("track");t.src=movie.subtitleFaUrl;t.kind="subtitles";t.srclang="fa";t.label="فارسی";t.default=true;video.appendChild(t)}video.load()}}
function renderMovies(){const el=$("#movies");el.innerHTML=movies.map(m=>`<article class="movie"><div class="poster">🎬</div><div class="movie-body"><h3>${m.title}</h3><p>${m.year||""} ${m.genre?"• "+m.genre:""}</p><button data-id="${m.id}">Watch together</button></div></article>`).join("");el.querySelectorAll("button").forEach(b=>b.onclick=()=>{selectedMovie=movies.find(x=>x.id===b.dataset.id);createOrJoin()})}
function createOrJoin(){roomId=roomId||makeRoom();isHost=!roomFromUrl();history.replaceState(null,"",location.pathname+"?room="+roomId);showWatch();setMovie(selectedMovie||movies[0]);socket.emit("room:join",{roomId,name:$("#nameInput").value||"Guest",movieId:selectedMovie?.id})}
async function copy(){await navigator.clipboard?.writeText(location.href);$("#copyRoom").textContent="Copied! ✓";setTimeout(()=>$("#copyRoom").textContent="🔗 Copy room link",1200)}
function sync(send=true){if(!selectedMovie)return; if(send) socket.emit("player:change",{roomId,playing:!video.paused,currentTime:video.currentTime,movieId:selectedMovie.id})}
video.addEventListener("play",()=>sync());video.addEventListener("pause",()=>sync());video.addEventListener("seeked",()=>sync());
socket.on("room:state",s=>{if(s.movieId){const m=movies.find(x=>x.id===s.movieId);if(m){setMovie(m);selectedMovie=m}}$("#roomCode").textContent=roomId;$("#count").textContent=s.users.length;renderUsers(s.users);setTimeout(()=>{video.currentTime=s.currentTime||0;if(s.playing)video.play().catch(()=>{})},200)});
socket.on("player:change",s=>{if(s.movieId&&s.movieId!==selectedMovie?.id){const m=movies.find(x=>x.id===s.movieId);if(m){setMovie(m);selectedMovie=m}}if(Math.abs(video.currentTime-s.currentTime)>1)video.currentTime=s.currentTime;if(s.playing&&!video.paused) return;if(s.playing)video.play().catch(()=>{});else video.pause()});
socket.on("room:movie",({movieId})=>{const m=movies.find(x=>x.id===movieId);if(m){setMovie(m);selectedMovie=m}});
socket.on("room:users",({users})=>{renderUsers(users);$("#count").textContent=users.length});
socket.on("chat:message",m=>{const d=document.createElement("div");d.className="msg";d.innerHTML=`<b>${escapeHtml(m.name)}</b> <span>${escapeHtml(m.message)}</span>`;$("#messages").appendChild(d);$("#messages").scrollTop=$("#messages").scrollHeight});
function renderUsers(users){$("#users").innerHTML=users.map(u=>`<div class="user">${escapeHtml(u)}</div>`).join("")}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
$("#createRoom").onclick=()=>{if(!selectedMovie)selectedMovie=movies[0];createOrJoin()};
$("#copyRoom").onclick=copy;$("#copyRoom2").onclick=copy;
$("#leave").onclick=()=>{location.href=location.pathname};
$("#chatForm").onsubmit=e=>{e.preventDefault();const input=$("#chatInput");socket.emit("chat:message",{roomId,message:input.value});input.value=""};
fetch("/api/movies").then(r=>r.json()).then(data=>{movies=data;renderMovies();const r=roomFromUrl();if(r){roomId=r;isHost=false;selectedMovie=movies[0];createOrJoin()}});
