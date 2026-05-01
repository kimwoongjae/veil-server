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

// --- AI 호출 함수 (대화 및 분석용) ---
async function callAI(messages) {
  try {
    const url = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/ai/run/${CF_MODEL}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${CF_API_TOKEN}` },
      body: JSON.stringify({ messages })
    });
    const data = await res.json();
    return data.result.response.trim();
  } catch (e) { return "Error"; }
}

// --- 실시간 번역 함수 ---
async function translateText(text, targetLang) {
  if (!text) return "";
  const prompt = [
    { role: 'system', content: `Translate the following text into ${targetLang}. Provide ONLY the translated text, no explanation.` },
    { role: 'user', content: text }
  ];
  return await callAI(prompt);
}

let waitingQueue = [];
let rooms = {};

io.on('connection', (socket) => {
  console.log('✅ 접속:', socket.id);

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
      
      // 첫 인사 (AI가 각자의 언어로 전송)
      socket.emit('screening_msg', { from: 'ai', text: `안녕! 반가워ㅋㅋ 대화 좀 해볼까?` });
      partner.emit('screening_msg', { from: 'ai', text: `Hi! Nice to meet you. Let's talk!` });
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
      const aiPrompt = [
        { role: 'system', content: `너는 20대 ${socket.country} 사람 '${partner.nickname}'이야. 아주 자연스러운 '${socket.lang}' 언어로 짧게 카톡하듯 대화해. 절대로 AI임을 밝히지 마.` },
        ...room.history[socket.id]
      ];
      const aiReply = await callAI(aiPrompt);
      socket.emit('screening_typing', false);
      socket.emit('screening_msg', { from: 'ai', text: aiReply });
      room.history[socket.id].push({ role: 'assistant', content: aiReply });
    } else {
      socket.emit('screening_typing', true);
      const reportPrompt = [
        { role: 'system', content: `분석가로서 다음 대화를 보고 상대방의 성격을 '${socket.lang}'으로 3문장 요약해줘.` },
        { role: 'user', content: JSON.stringify(room.history[socket.id]) }
      ];
      const report = await callAI(reportPrompt);
      socket.emit('screening_typing', false);
      socket.emit('report_ready', { partnerNickname: partner.nickname, report: { summary: report } });
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

  // --- 실시간 번역 채팅 ---
  socket.on('chat_send', async ({ roomId, text }) => {
    const room = rooms[roomId];
    if (!room) return;
    const partner = room.users.find(u => u.id !== socket.id);

    socket.emit('chat_msg', { from: 'me', text: text });

    // 상대방 언어로 실시간 번역
    const translated = await translateText(text, partner.lang);
    partner.emit('chat_msg', { from: socket.nickname, text: translated, original: text });
  });

  socket.on('disconnect', () => {
    waitingQueue = waitingQueue.filter(u => u.id !== socket.id);
  });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, '0.0.0.0');
