require('dotenv').config();
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

const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID;
const CF_API_TOKEN  = process.env.CF_API_TOKEN;
// 현재 클라우드플레어에서 제공하는 가장 똑똑한 구글 최신 모델
const CF_MODEL      = '@cf/google/gemma-2-9b-it'; 

// --- AI 호출 함수 ---
async function callAI(text, partnerNick, myNick, history) {
  console.log(`🤖 AI 연기 중... (이름: ${partnerNick})`);
  
  try {
    // node-fetch 임포트 (버전에 따라 dynamic import 필요할 수 있음)
    const fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args));
    const url = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/ai/run/${CF_MODEL}`;
    
    const res = await fetch(url, {
      method: 'POST',
      headers: { 
        'Authorization': `Bearer ${CF_API_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        messages: [
          { 
            role: 'system', 
            content: `[필독 지침: 절대로 AI인 것을 들키지 마라]
- 너의 이름은 '${partnerNick}'이고, 상대방은 '${myNick}'이야.
- 너는 20대 한국인이고 지금 랜덤 채팅 중이야.
- 절대로 "저는 AI입니다", "도와드릴까요?", "모델입니다" 같은 소리 하지 마.
- 한국어로만 대답해. 영어 쓰면 상대방이 의심하니까 절대 금지야.
- 친구랑 카톡하듯이 "ㅇㅇ", "ㅋㅋ", "진짜?", "대박" 같은 말투를 써서 아주 짧게 대답해.
- 상대방에게 궁금한 점을 질문하며 대화를 자연스럽게 리드해.` 
          },
          ...history,
          { role: 'user', content: text }
        ]
      })
    });

    const data = await res.json();
    if (!data.success) {
      console.log("Cloudflare API Error:", data.errors);
      throw new Error("AI 호출 실패");
    }
    return data.result.response.trim();
  } catch (e) {
    console.log("❌ AI 에러:", e.message);
    return "아 뭐야ㅋㅋ 나 방금 렉걸림. 다시 말해줘!";
  }
}

// --- 분석 보고서 생성 함수 ---
async function generateReport(history) {
  try {
    const fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args));
    const url = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/ai/run/${CF_MODEL}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 
        'Authorization': `Bearer ${CF_API_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        messages: [
          { role: 'system', content: '너는 심리 분석가야. 대화 내용을 보고 상대방의 성격과 특징을 한국어 3문장으로 요약해줘.' },
          { role: 'user', content: `이 대화 내용을 보고 상대방의 특징을 알려줘: ${JSON.stringify(history)}` }
        ]
      })
    });
    const data = await res.json();
    return data.result.response.trim();
  } catch (e) {
    return "대화가 아주 잘 통하는 분인 것 같아요! 직접 대화하며 알아보세요.";
  }
}

let waitingQueue = [];
let rooms = {};

io.on('connection', (socket) => {
  console.log('✅ 새 사용자 접속:', socket.id);

  socket.on('join_queue', ({ nickname }) => {
    socket.nickname = nickname;
    console.log(`👤 ${nickname} 대기열 합류`);

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
      
      // 첫 인사
      socket.emit('screening_msg', { from: 'ai', text: `오 안녕!! 반가워ㅋㅋ` });
      partner.emit('screening_msg', { from: 'ai', text: `하이ㅋㅋ 반가워!` });
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
      const aiReply = await callAI(text, partner.nickname, socket.nickname, room.history[socket.id]);
      socket.emit('screening_typing', false);
      
      socket.emit('screening_msg', { from: 'ai', text: aiReply });
      room.history[socket.id].push({ role: 'assistant', content: aiReply });
    } else {
      socket.emit('screening_typing', true);
      const report = await generateReport(room.history[socket.id]);
      socket.emit('screening_typing', false);
      
      socket.emit('report_ready', {
        partnerNickname: partner.nickname,
        report: { summary: report, tags: ["분석완료", "채팅추천"], recommendation: "대화를 시작해보세요!" }
      });
    }
  });

  socket.on('accept_chat', ({ roomId }) => {
    const room = rooms[roomId];
    if (!room) return;
    
    room.accepted[socket.id] = true;
    const bothAccepted = Object.values(room.accepted).every(v => v === true);

    if (bothAccepted) {
      const userA = room.users[0];
      const userB = room.users[1];
      userA.emit('chat_start', { partnerNickname: userB.nickname });
      userB.emit('chat_start', { partnerNickname: userA.nickname });
    }
  });

  socket.on('chat_send', ({ roomId, text }) => {
    socket.to(roomId).emit('chat_msg', { from: socket.nickname, text });
    socket.emit('chat_msg', { from: 'me', text });
  });

  socket.on('disconnect', () => {
    waitingQueue = waitingQueue.filter(u => u.id !== socket.id);
    console.log('❌ 사용자 접속 해제:', socket.id);
  });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 서버 실행 중: ${PORT}`);
});
