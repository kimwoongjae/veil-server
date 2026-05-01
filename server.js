const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// 환경변수 공백 제거 및 로드
const CF_ACCOUNT_ID = (process.env.CF_ACCOUNT_ID || '').trim();
const CF_API_TOKEN  = (process.env.CF_API_TOKEN || '').trim();
const CF_MODEL      = '@cf/google/gemma-2-9b-it';

// --- AI 호출 핵심 함수 (에러 방어막 강화) ---
async function callAI(messages, userLang, partnerNick, myNick) {
  if (!CF_ACCOUNT_ID || !CF_API_TOKEN) {
    console.error("❌ API 키가 설정되지 않았습니다.");
    return "Error: API Key Missing";
  }

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
          { role: 'system', content: `너는 20대 한국인 '${partnerNick}'이야. 상대방 '${myNick}'과 채팅 중이야. 절대 AI인 티 내지 말고 아주 짧은 '${userLang}' 언어로 자연스럽게 대화해.` },
          ...messages
        ] 
      })
    });

    const data = await response.json();

    if (!data.success) {
      console.error("❌ Cloudflare 에러 응답:", JSON.stringify(data.errors));
      return "아 뭐야ㅋㅋ 나 방금 렉걸림. 다시 말해봐!";
    }

    return data.result.response.trim();
  } catch (e) {
    console.error("❌ 시스템 에러:", e.message);
    return "잠시만ㅋㅋ 인터넷이 좀 느린가봐.";
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

  // 🚀 AI가 먼저 말을 거는 로직 (에러 방지 처리)
  socket.on('ready_to_chat', async ({ roomId }) => {
    const room = rooms[roomId];
    if (!room) return;
    const partner = room.users.find(u => u.id !== socket.id);

    socket.emit('screening_typing', true);
    // AI에게 첫 인사를 시킴
    const firstPrompt = [{ role: 'user', content: '안녕! 반가워ㅋㅋ 매칭돼서 신기하다! 넌 어디 살아?' }];
    const aiFirstMsg = await callAI(firstPrompt, socket.lang, partner.nickname, socket.nickname);
    
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
    room.turns[socket.id]++;

    if (room.turns[socket.id] < 6) {
      socket.emit('screening_typing', true);
      const aiReply = await callAI(room.history[socket.id], socket.lang, partner.nickname, socket.nickname);
      socket.emit('screening_typing', false);
      socket.emit('screening_msg', { from: 'ai', text: aiReply });
      room.history[socket.id].push({ role: 'assistant', content: aiReply });
    } else {
      socket.emit('report_ready', { partnerNickname: partner.nickname, report: { summary: "분석 완료! 대화가 잘 통하는 분 같아요." } });
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
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 서버 실행 중: ${PORT}`);
});
