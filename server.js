const express=require("express");
const http=require("http");
const path=require("path");
const {Server}=require("socket.io");
const movies=require("./data/movies.json");

const app=express();
const server=http.createServer(app);
const io=new Server(server);
const PORT=process.env.PORT||3000;

app.use(express.json());
app.use(express.static(path.join(__dirname,"public")));

app.get("/api/movies",(req,res)=>res.json(movies));

const rooms=new Map();

function roomState(room){
  if(!rooms.has(room)) rooms.set(room,{movieId:null,playing:false,currentTime:0,updatedAt:Date.now(),users:new Map()});
  return rooms.get(room);
}

io.on("connection",(socket)=>{
  socket.on("room:join",({roomId,name,movieId})=>{
    if(!roomId) return;
    const room=roomState(roomId);
    socket.join(roomId);
    socket.data.roomId=roomId;
    socket.data.name=(name||"Guest").slice(0,24);
    room.users.set(socket.id,socket.data.name);
    if(movieId && !room.movieId) room.movieId=movieId;
    socket.emit("room:state",{movieId:room.movieId,playing:room.playing,currentTime:room.currentTime,users:[...room.users.values()]});
    io.to(roomId).emit("room:users",{users:[...room.users.values()]});
  });

  socket.on("player:change",({roomId,playing,currentTime,movieId})=>{
    const room=rooms.get(roomId); if(!room) return;
    room.playing=!!playing;
    room.currentTime=Number(currentTime)||0;
    room.updatedAt=Date.now();
    if(movieId) room.movieId=movieId;
    socket.to(roomId).emit("player:change",{playing:room.playing,currentTime:room.currentTime,movieId:room.movieId});
  });

  socket.on("chat:message",({roomId,message})=>{
    const text=String(message||"").trim().slice(0,500); if(!text) return;
    io.to(roomId).emit("chat:message",{name:socket.data.name||"Guest",message:text,time:Date.now()});
  });

  socket.on("room:movie",({roomId,movieId})=>{
    const room=rooms.get(roomId); if(!room) return;
    room.movieId=movieId; room.playing=false; room.currentTime=0; room.updatedAt=Date.now();
    io.to(roomId).emit("room:movie",{movieId});
  });

  socket.on("disconnect",()=>{
    const roomId=socket.data.roomId; if(!roomId) return;
    const room=rooms.get(roomId); if(!room) return;
    room.users.delete(socket.id);
    io.to(roomId).emit("room:users",{users:[...room.users.values()]});
    if(room.users.size===0) rooms.delete(roomId);
  });
});

app.get("*",(req,res)=>res.sendFile(path.join(__dirname,"public","index.html")));
server.listen(PORT,()=>console.log(`Movie Night running on port ${PORT}`));