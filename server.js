const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// ── 환경변수 가져오기 (공백 제거 .trim() 추가) ──
const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID ? process.env.CF_ACCOUNT_ID.trim() : null;
const CF_API_TOKEN  = process.env.CF_API_TOKEN ? process.env.CF_API_TOKEN.trim() : null;
const CF_MODEL      = '@cf/google/gemma-2-9b-it';

// ── AI 호출 함수 ──
async function callAI(messages) {
  if (!CF_ACCOUNT_ID || !CF_API_TOKEN) {
    return "Error: API 설정값이 없습니다.";
  }

  try {
    // API 주소를 아주 정확하게 생성
    const url = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/ai/run/${CF_MODEL}`;
    
    const res = await fetch(url, {
      method: 'POST',
      headers: { 
        'Authorization': `Bearer ${CF_API_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ messages })
    });

    const data = await res.json();

    if (!data.success) {
      // Cloudflare가 보낸 실제 에러 메시지를 화면에 표시
      console.error("❌ 상세 에러:", data.errors);
      return "Error: " + (data.errors[0]?.message || "API Rejected");
    }

    return data.result.response.trim();
  } catch (e) {
    return "Error: " + e.message;
  }
}

// ── 번역 함수 ──
async function translateText(text, targetLang) {
  if (!text) return "";
  const prompt = [
    { role: 'system', content: `Translate into ${targetLang}. Only result.` },
    { role: 'user', content: text }
  ];
  return await callAI(prompt);
}

let waitingQueue = [];
let rooms = {};

io.on('connection', (socket) => {
  socket.on('join_queue', ({ nickname, profile }) => {
    socket.nickname = nickname;
    socket.lang = profile.lang || 'ko';
    socket.country = profile.countryName || 'Unknown';
    if (waitingQueue.length > 0) {
      const partner = waitingQueue.shift();
      const roomId = socket.id + '_' + partner.id;
      rooms[roomId] = { users: [socket, partner], turns: { [socket.id]: 0, [partner.id]: 0 }, history: { [socket.id]: [], [partner.id]: [] }, accepted: { [socket.id]: false, [partner.id]: false } };
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
    socket.emit('screening_msg', { from: 'me', text });
    room.history[socket.id].push({ role: 'user', content: text });
    room.turns[socket.id]++;
    if (room.turns[socket.id] < 5) {
      socket.emit('screening_typing', true);
      const aiPrompt = [{ role: 'system', content: `너는 20대 ${socket.country} 사람이야. '${socket.lang}'으로 짧게 대화해.` }, ...room.history[socket.id]];
      const aiReply = await callAI(aiPrompt);
      socket.emit('screening_typing', false);
      socket.emit('screening_msg', { from: 'ai', text: aiReply });
    } else {
      socket.emit('report_ready', { partnerNickname: "Partner", report: { summary: "Analysis Complete." } });
    }
  });

  socket.on('accept_chat', ({ roomId }) => {
    const room = rooms[roomId];
    if (!room) return;
    room.accepted[socket.id] = true;
    if (Object.values(room.accepted).every(v => v === true)) {
      room.users.forEach(u => u.emit('chat_start', { partnerNickname: "Partner" }));
    }
  });

  socket.on('chat_send', async ({ roomId, text }) => {
    const room = rooms[roomId];
    if (!room) return;
    const partner = room.users.find(u => u.id !== socket.id);
    socket.emit('chat_msg', { from: 'me', text });
    const translated = await translateText(text, partner.lang);
    partner.emit('chat_msg', { from: socket.nickname, text: translated, original: text });
  });

  socket.on('disconnect', () => {
    waitingQueue = waitingQueue.filter(u => u.id !== socket.id);
  });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, '0.0.0.0');
