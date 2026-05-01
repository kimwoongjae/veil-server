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

// 환경변수 로드
const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID;
const CF_API_TOKEN  = process.env.CF_API_TOKEN;
const CF_MODEL      = '@cf/google/gemma-2-9b-it';

// --- AI 호출 핵심 함수 ---
async function callAI(messages) {
  // 1. 키 설정 확인
  if (!CF_ACCOUNT_ID || !CF_API_TOKEN) {
    console.error("❌ 설정 오류: Render의 Environment Variables에 CF_ACCOUNT_ID 또는 CF_API_TOKEN이 없습니다.");
    return "Error: API Key Missing";
  }

  try {
    const url = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/ai/run/${CF_MODEL}`;
    
    console.log("🤖 AI 요청 중...");
    const res = await fetch(url, {
      method: 'POST',
      headers: { 
        'Authorization': `Bearer ${CF_API_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ messages })
    });

    const data = await res.json();

    // 2. API 응답 성공 여부 확인
    if (!data.success) {
      console.error("❌ Cloudflare API 에러 상세:", JSON.stringify(data.errors));
      return "Error: " + (data.errors[0]?.message || "API Rejected");
    }

    console.log("✅ AI 응답 성공");
    return data.result.response.trim();

  } catch (e) {
    console.error("❌ 네트워크 또는 시스템 에러:", e.message);
    return "Error: Connection Failed";
  }
}

// --- 번역 함수 ---
async function translateText(text, targetLang) {
  if (!text) return "";
  console.log(`🌍 번역 요청: [${text}] -> ${targetLang}`);
  const prompt = [
    { role: 'system', content: `Translate the input into ${targetLang}. Reply with ONLY the translated text.` },
    { role: 'user', content: text }
  ];
  return await callAI(prompt);
}

let waitingQueue = [];
let rooms = {};

io.on('connection', (socket) => {
  console.log('새 사용자 접속:', socket.id);

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
      console.log(`💖 매칭 성공: ${socket.id} & ${partner.id}`);
    } else {
      waitingQueue.push(socket);
      socket.emit('waiting');
    }
  });

  socket.on('ready_to_chat', ({ roomId }) => {
    const room = rooms[roomId];
    if (!room) return;
    const partner = room.users.find(u => u.id !== socket.id);
    // 첫 인사는 서버에 미리 정의된 문구로 안전하게 시작
    const greeting = socket.lang === 'ko' ? `반가워요 ${socket.nickname}님! 우리 대화해봐요.` : `Hi ${socket.nickname}! Let's chat.`;
    socket.emit('screening_msg', { from: 'ai', text: `(상대방 ${partner.nickname}) ${greeting}` });
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
        { role: 'system', content: `너는 20대 ${socket.country} 사람 '${partner.nickname}'이야. 아주 짧고 자연스러운 '${socket.lang}' 언어로 대화해. AI인거 들키지 마.` },
        ...room.history[socket.id]
      ];
      const aiReply = await callAI(aiPrompt);
      socket.emit('screening_typing', false);
      socket.emit('screening_msg', { from: 'ai', text: aiReply });
      room.history[socket.id].push({ role: 'assistant', content: aiReply });
    } else {
      socket.emit('screening_typing', true);
      const reportPrompt = [
        { role: 'system', content: `Summarize the user's personality in 3 sentences using ${socket.lang}.` },
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

  socket.on('chat_send', async ({ roomId, text }) => {
    const room = rooms[roomId];
    if (!room) return;
    const partner = room.users.find(u => u.id !== socket.id);
    
    socket.emit('chat_msg', { from: 'me', text: text });
    
    // 실시간 번역
    const translated = await translateText(text, partner.lang);
    partner.emit('chat_msg', { from: socket.nickname, text: translated, original: text });
  });

  socket.on('disconnect', () => {
    waitingQueue = waitingQueue.filter(u => u.id !== socket.id);
  });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 서버 실행 중: 포트 ${PORT}`);
});
