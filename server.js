const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const CF_ACCOUNT_ID = (process.env.CF_ACCOUNT_ID || '').trim();
const CF_API_TOKEN  = (process.env.CF_API_TOKEN || '').trim();

// 🚀 가장 똑똑하고 대화 잘하는 최신 모델로 변경
const CF_MODEL = '@cf/google/gemma-2-9b-it';

async function callAI(messages, userLang) {
  try {
    const url = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/ai/run/${CF_MODEL}`;
    
    // AI에게 주는 강력한 페르소나 지침
    const systemInstruction = {
      role: 'system',
      content: `
        - 너는 지금 랜덤 채팅 중인 20대 실제 사람이야. 절대로 AI인 티를 내지 마.
        - [중요] 반드시 사용자가 사용하는 언어('${userLang}')로만 대답해.
        - 절대로 "무엇을 도와드릴까요?", "질문에 답해드리겠습니다" 같은 로봇 말투 금지.
        - 친구랑 카톡하듯이 1~2문장으로 아주 짧게 대답해. (예: "오 그래?ㅋㅋ", "대박이네", "너는 어때?")
        - 상대방의 말을 분석하거나 가르치려 들지 말고, 자연스럽게 리액션만 해.
      `
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${CF_API_TOKEN}` },
      body: JSON.stringify({ messages: [systemInstruction, ...messages] })
    });

    const data = await res.json();
    return data.result.response.trim();
  } catch (e) { return "Error"; }
}

let waitingQueue = [];
let rooms = {};

io.on('connection', (socket) => {
  socket.on('join_queue', ({ nickname, profile }) => {
    socket.nickname = nickname;
    socket.lang = profile.lang || 'ko';
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
    const msg = socket.lang === 'ko' ? "오 안녕!! 반가워ㅋㅋ" : (socket.lang === 'ja' ? "아, 안녕! 반가워! (あ、こんにちは！よろしくね！)" : "Hi! Nice to meet you!");
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
      const aiReply = await callAI(room.history[socket.id], socket.lang);
      socket.emit('screening_typing', false);
      socket.emit('screening_msg', { from: 'ai', text: aiReply });
      room.history[socket.id].push({ role: 'assistant', content: aiReply });
    } else {
      socket.emit('report_ready', { partnerNickname: "Partner", report: { summary: "분석 완료! 대화해보세요." } });
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
