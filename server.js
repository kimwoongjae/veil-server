const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

// 환경변수 (Render에서 설정한 값)
const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID;
const CF_API_TOKEN  = process.env.CF_API_TOKEN;
// 가장 기본적이고 잘 작동하는 젬마 모델 주소
const CF_MODEL      = '@cf/google/gemma-7b-it-lora';

async function callAI(messages) {
  try {
    // 주소를 한 줄로 명확하게 작성하여 에러 방지
    const url = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/ai/run/${CF_MODEL}`;
    
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${CF_API_TOKEN}` },
      body: JSON.stringify({ messages })
    });

    const data = await res.json();
    if (!data.success) return "Error: " + data.errors[0].message;
    return data.result.response.trim();
  } catch (e) {
    return "Error: Connection Failed";
  }
}

let waitingQueue = [];
let rooms = {};

io.on('connection', (socket) => {
  console.log('접속:', socket.id);

  socket.on('join_queue', ({ nickname, profile }) => {
    socket.nickname = nickname;
    socket.lang = profile.lang || 'ko';
    socket.country = profile.countryName || 'Unknown';

    if (waitingQueue.length > 0) {
      const partner = waitingQueue.shift();
      if (partner.id === socket.id) { waitingQueue.push(socket); return; }
      
      const roomId = socket.id + '_' + partner.id;
      rooms[roomId] = { 
        users: [socket, partner], 
        turns: { [socket.id]: 0, [partner.id]: 0 }, 
        history: { [socket.id]: [], [partner.id]: [] },
        accepted: { [socket.id]: false, [partner.id]: false }
      };
      socket.join(roomId); partner.join(roomId);
      io.to(roomId).emit('matched', { roomId });
    } else {
      waitingQueue.push(socket);
      socket.emit('waiting');
    }
  });

  socket.on('ready_to_chat', ({ roomId }) => {
    const room = rooms[roomId];
    if (!room) return;
    const partner = room.users.find(u => u.id !== socket.id);
    const msg = socket.lang === 'ko' ? `안녕! 반가워ㅋㅋ` : `Hi! Nice to meet you.`;
    socket.emit('screening_msg', { from: 'ai', text: `(상대방 ${partner.nickname}) ${msg}` });
  });

  socket.on('screening_send', async ({ roomId, text }) => {
    const room = rooms[roomId];
    if (!room) return;
    const partner = room.users.find(u => u.id !== socket.id);
    
    socket.emit('screening_msg', { from: 'me', text });
    room.history[socket.id].push({ role: 'user', content: text });
    room.turns[socket.id]++;

    if (room.turns[socket.id] < 5) {
      socket.emit('screening_typing', true);
      // AI 지침을 아주 단순하게 수정
      const aiPrompt = [
        { role: 'system', content: `너는 20대 한국인이야. 아주 짧고 자연스럽게 한국어로 대화해.` },
        ...room.history[socket.id]
      ];
      const aiReply = await callAI(aiPrompt);
      socket.emit('screening_typing', false);
      socket.emit('screening_msg', { from: 'ai', text: aiReply });
    } else {
      socket.emit('report_ready', { partnerNickname: partner.nickname, report: { summary: "분석 완료! 대화해보세요." } });
    }
  });

  socket.on('accept_chat', ({ roomId }) => {
    const room = rooms[roomId];
    if (!room) return;
    room.accepted[socket.id] = true;
    if (Object.values(room.accepted).every(v => v === true)) {
      room.users.forEach(u => u.emit('chat_start', { partnerNickname: room.users.find(p => p.id !== u.id).nickname }));
    }
  });

  socket.on('chat_send', ({ roomId, text }) => {
    socket.to(roomId).emit('chat_msg', { from: socket.nickname, text });
    socket.emit('chat_msg', { from: 'me', text });
  });

  socket.on('disconnect', () => {
    waitingQueue = waitingQueue.filter(u => u.id !== socket.id);
  });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, '0.0.0.0');
