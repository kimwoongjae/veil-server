const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID;
const CF_API_TOKEN  = process.env.CF_API_TOKEN;
const CF_MODEL      = '@cf/google/gemma-2-9b-it';

// --- AI 호출 함수 (대화용) ---
async function callAI(text, partnerNick, myNick, history, lang) {
  try {
    const url = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/ai/run/${CF_MODEL}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${CF_API_TOKEN}` },
      body: JSON.stringify({
        messages: [
          { role: 'system', content: `너는 20대 한국인 '${partnerNick}'이야. 아주 자연스러운 '${lang}' 언어로 짧게 카톡하듯 대화해. 절대로 AI임을 밝히지 마.` },
          ...history,
          { role: 'user', content: text }
        ]
      })
    });
    const data = await res.json();
    return data.result.response.trim();
  } catch (e) { return "Error"; }
}

// --- 실시간 번역 함수 ---
async function translateText(text, targetLang) {
  try {
    const url = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/ai/run/${CF_MODEL}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${CF_API_TOKEN}` },
      body: JSON.stringify({
        messages: [
          { role: 'system', content: `Translate the following text into ${targetLang}. Provide ONLY the translated text, no explanation.` },
          { role: 'user', content: text }
        ]
      })
    });
    const data = await res.json();
    return data.result.response.trim();
  } catch (e) { return text; } // 실패 시 원문 반환
}

let waitingQueue = [];
let rooms = {};

io.on('connection', (socket) => {
  socket.on('join_queue', ({ nickname, profile }) => {
    socket.nickname = nickname;
    socket.lang = profile.lang || 'ko'; // 사용자의 언어 저장
    if (waitingQueue.length > 0) {
      const partner = waitingQueue.shift();
      const roomId = socket.id + '_' + partner.id;
      rooms[roomId] = { users: [socket, partner], turns: { [socket.id]: 0, [partner.id]: 0 }, history: { [socket.id]: [], [partner.id]: [] }, accepted: { [socket.id]: false, [partner.id]: false } };
      socket.join(roomId); partner.join(roomId);
      io.to(roomId).emit('matched', { roomId });
      socket.emit('screening_msg', { from: 'ai', text: `안녕! 반가워ㅋㅋ` });
      partner.emit('screening_msg', { from: 'ai', text: `Hi! Nice to meet you.` });
    } else {
      waitingQueue.push(socket);
      socket.emit('waiting');
    }
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
      const aiReply = await callAI(text, partner.nickname, socket.nickname, room.history[socket.id], socket.lang);
      socket.emit('screening_typing', false);
      socket.emit('screening_msg', { from: 'ai', text: aiReply });
    } else {
      socket.emit('report_ready', { partnerNickname: partner.nickname, report: { summary: "AI 분석 완료!", tags: ["분석중"], recommendation: "추천" } });
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

  // --- 실시간 번역 채팅 로직 ---
  socket.on('chat_send', async ({ roomId, text }) => {
    const room = rooms[roomId];
    if (!room) return;
    const partner = room.users.find(u => u.id !== socket.id);

    // 상대방 언어로 번역
    const translated = await translateText(text, partner.lang);

    // 보낸 사람에겐 원문 표시
    socket.emit('chat_msg', { from: 'me', text: text });
    // 받는 사람에겐 번역문 + 원문 표시
    partner.emit('chat_msg', { from: socket.nickname, text: translated, original: text });
  });

  socket.on('disconnect', () => {
    waitingQueue = waitingQueue.filter(u => u.id !== socket.id);
  });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, '0.0.0.0');
