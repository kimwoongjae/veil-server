const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// 환경변수 공백 제거
const CF_ACCOUNT_ID = (process.env.CF_ACCOUNT_ID || '').trim();
const CF_API_TOKEN  = (process.env.CF_API_TOKEN || '').trim();
const CF_MODEL      = '@cf/google/gemma-2-9b-it';

async function callAI(messages, userLang, partnerNick, myNick) {
  if (!CF_ACCOUNT_ID || !CF_API_TOKEN) return "Error: API Key Missing in Render";

  try {
    const url = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/ai/run/${CF_MODEL}`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: { 
        'Authorization': `Bearer ${CF_API_TOKEN}`,
        'Content-Type': 'application/json' 
      },
      body: JSON.stringify({ 
        messages: [
          { role: 'system', content: `You are ${partnerNick}, a friendly human. Talk to ${myNick} in very short ${userLang}.` },
          ...messages
        ] 
      })
    });

    const data = await response.json();

    if (!data.success) {
      // 🚀 에러가 나면 채팅창에 에러 내용을 직접 뿌립니다.
      console.error("Cloudflare Error:", data.errors);
      return "Error: " + data.errors[0].message + " (Code: " + data.errors[0].code + ")";
    }

    return data.result.response.trim();
  } catch (e) {
    return "System Error: " + e.message;
  }
}

let waitingQueue = [];
let rooms = {};

io.on('connection', (socket) => {
  console.log('✅ 접속:', socket.id);

  socket.on('join_queue', ({ nickname, profile }) => {
    socket.nickname = nickname;
    socket.lang = profile.lang || 'ko';
    if (waitingQueue.length > 0) {
      const partner = waitingQueue.shift();
      if (partner.id === socket.id) { waitingQueue.push(socket); return; }
      const roomId = socket.id + '_' + partner.id;
      rooms[roomId] = { users: [socket, partner], history: { [socket.id]: [] }, turns: { [socket.id]: 0 } };
      socket.join(roomId); partner.join(roomId);
      io.to(roomId).emit('matched', { roomId });
    } else {
      waitingQueue.push(socket);
      socket.emit('waiting');
    }
  });

  socket.on('ready_to_chat', async ({ roomId }) => {
    const room = rooms[roomId];
    if (!room) return;
    const partner = room.users.find(u => u.id !== socket.id);
    socket.emit('screening_typing', true);
    const aiFirstMsg = await callAI([{ role: 'user', content: 'Say hello!' }], socket.lang, partner.nickname, socket.nickname);
    socket.emit('screening_typing', false);
    socket.emit('screening_msg', { from: 'ai', text: aiFirstMsg });
    room.history[socket.id].push({ role: 'assistant', content: aiFirstMsg });
  });

  socket.on('screening_send', async ({ roomId, text }) => {
    const room = rooms[roomId];
    if (!room) return;
    const partner = room.users.find(u => u.id !== socket.id);
    socket.emit('screening_msg', { from: 'me', text });
    room.history[socket.id].push({ role: 'user', content: text });
    socket.emit('screening_typing', true);
    const aiReply = await callAI(room.history[socket.id], socket.lang, partner.nickname, socket.nickname);
    socket.emit('screening_typing', false);
    socket.emit('screening_msg', { from: 'ai', text: aiReply });
    room.history[socket.id].push({ role: 'assistant', content: aiReply });
  });

  socket.on('accept_chat', ({ roomId }) => {
      io.to(roomId).emit('chat_start', { partnerNickname: "Partner" });
  });

  socket.on('chat_send', ({ roomId, text }) => {
    socket.to(roomId).emit('chat_msg', { from: socket.nickname, text });
    socket.emit('chat_msg', { from: 'me', text });
  });

  socket.on('disconnect', () => {
    waitingQueue = waitingQueue.filter(u => u.id !== socket.id);
  });
});

server.listen(10000, '0.0.0.0');
