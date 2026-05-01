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
const CF_MODEL      = '@cf/google/gemma-2-9b-it';

// --- AI 호출 핵심 함수 ---
async function callAI(messages, userLang, partnerNick, myNick) {
  try {
    const url = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/ai/run/${CF_MODEL}`;
    
    const systemInstruction = {
      role: 'system',
      content: `
        - 너는 지금 랜덤 채팅 앱에서 '${myNick}'과 매칭된 20대 실제 사람 '${partnerNick}'이야.
        - 너는 AI가 아니야. 로봇 같은 말투(도움, 질문 답변 등)는 절대 금지야.
        - 반드시 '${userLang}' 언어로만 대답해. 
        - 친구랑 카톡하듯이 아주 짧고 자연스럽게 대화해. "ㅋㅋ", "ㅇㅇ", "진짜?" 같은 표현을 섞어줘.
        - 상대방에게 궁금한 점을 질문하며 대화를 재미있게 이끌어 나가야 해.
      `
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${CF_API_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [systemInstruction, ...messages] })
    });

    const data = await res.json();
    return data.result.response.trim();
  } catch (e) { return "Error"; }
}

let waitingQueue = [];
let rooms = {};

io.on('connection', (socket) => {
  console.log('✅ 접속:', socket.id);

  socket.on('join_queue', ({ nickname, profile }) => {
    socket.nickname = nickname;
    socket.lang = profile.lang || 'ko';
    socket.country = profile.countryName || 'Korea';

    if (waitingQueue.length > 0) {
      const partner = waitingQueue.shift();
      if (partner.id === socket.id) { waitingQueue.push(socket); return; }
      const roomId = socket.id + '_' + partner.id;
      rooms[roomId] = { 
        users: [socket, partner], 
        history: { [socket.id]: [], [partner.id]: [] },
        turns: { [socket.id]: 0, [partner.id]: 0 },
        accepted: { [socket.id]: false, [partner.id]: false }
      };
      socket.join(roomId); partner.join(roomId);
      io.to(roomId).emit('matched', { roomId });
    } else {
      waitingQueue.push(socket);
      socket.emit('waiting');
    }
  });

  // 🚀 매칭 후 화면 전환되면 AI가 먼저 말을 거는 로직
  socket.on('ready_to_chat', async ({ roomId }) => {
    const room = rooms[roomId];
    if (!room) return;
    const partner = room.users.find(u => u.id !== socket.id);

    socket.emit('screening_typing', true);
    
    // AI에게 "먼저 첫인사를 건네봐"라고 요청
    const aiFirstMsg = await callAI(
        [{ role: 'user', content: '상대방에게 첫인사를 건네며 대화를 시작해줘. 아주 자연스럽고 친근하게!' }], 
        socket.lang, 
        partner.nickname, 
        socket.nickname
    );
    
    socket.emit('screening_typing', false);
    socket.emit('screening_msg', { from: 'ai', text: aiFirstMsg });
    // AI의 첫 마디를 기억에 저장
    room.history[socket.id].push({ role: 'assistant', content: aiFirstMsg });
  });

  socket.on('screening_send', async ({ roomId, text }) => {
    const room = rooms[roomId];
    if (!room) return;
    const partner = room.users.find(u => u.id !== socket.id);
    
    socket.emit('screening_msg', { from: 'me', text });
    room.history[socket.id].push({ role: 'user', content: text });
    room.turns[socket.id]++;

    if (room.turns[socket.id] < 6) {
      socket.emit('screening_typing', true);
      const aiReply = await callAI(room.history[socket.id], socket.lang, partner.nickname, socket.nickname);
      socket.emit('screening_typing', false);
      socket.emit('screening_msg', { from: 'ai', text: aiReply });
      room.history[socket.id].push({ role: 'assistant', content: aiReply });
    } else {
      socket.emit('report_ready', { partnerNickname: partner.nickname, report: { summary: "대화가 아주 잘 통하는 분이네요! 솔직하고 밝은 성격인 것 같아요." } });
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
