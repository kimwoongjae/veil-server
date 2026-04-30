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

// Render의 Environment Variables에서 가져오는 값들
const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID;
const CF_API_TOKEN  = process.env.CF_API_TOKEN;
const CF_MODEL      = '@cf/meta/llama-3-8b-instruct'; // 한국어에 가장 똑똑한 모델

// --- AI 호출 함수 ---
async function callAI(text, partnerNick, myNick, history) {
  console.log(`🤖 AI(${partnerNick})가 대답을 생성 중...`);
  
  try {
    const url = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/ai/run/${CF_MODEL}`;
    
    // AI에게 줄 지침(프롬프트)
    const systemPrompt = `
      - 너의 이름은 '${partnerNick}'이야. 너는 지금 랜덤 채팅 중인 '실제 사람'이야.
      - 상대방의 이름은 '${myNick}'이야. 
      - 절대로 너가 AI임을 밝히지 마. "도움이 필요하신가요?", "저는 모델입니다" 같은 말 금지.
      - 반드시 '한국어'로만 대화해. 친구랑 카톡하듯이 아주 자연스럽고 친근한 말투를 써.
      - 문장은 1~2문장으로 짧게 대답하고, 상대방에게 궁금한 점을 한 가지 물어봐.
      - 대화 내용이 자연스럽게 이어지도록 해.
    `;

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${CF_API_TOKEN}` },
      body: JSON.stringify({
        messages: [
          { role: 'system', content: systemPrompt },
          ...history, // 이전 대화 기억하기
          { role: 'user', content: text }
        ]
      })
    });

    const data = await res.json();
    return data.result.response;
  } catch (e) {
    console.log("❌ AI 에러:", e.message);
    return "아, 미안! 잠시 인터넷이 끊겼나 봐. 다시 말해줄래?";
  }
}

// --- 분석 보고서 생성 함수 ---
async function generateReport(history) {
  try {
    const url = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/ai/run/${CF_MODEL}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${CF_API_TOKEN}` },
      body: JSON.stringify({
        messages: [
          { role: 'system', content: '너는 심리 분석가야. 대화 내용을 보고 상대방의 성격과 특징을 한국어 3문장으로 요약해줘.' },
          { role: 'user', content: `다음 대화를 분석해줘: ${JSON.stringify(history)}` }
        ]
      })
    });
    const data = await res.json();
    return data.result.response;
  } catch (e) {
    return "상대방은 아주 신비로운 사람인 것 같네요! 직접 대화하며 알아보세요.";
  }
}

let waitingQueue = [];
let rooms = {};

io.on('connection', (socket) => {
  console.log('✅ 새 사용자 접속:', socket.id);

  socket.on('join_queue', ({ nickname, profile }) => {
    socket.nickname = nickname;
    socket.profile = profile || {};
    
    console.log(`👤 ${nickname} 대기열 합류`);

    if (waitingQueue.length > 0) {
      const partner = waitingQueue.shift();
      if (partner.id === socket.id) { waitingQueue.push(socket); return; }

      const roomId = socket.id + '_' + partner.id;
      
      // 방 정보 생성 (대화 턴 수와 히스토리 저장)
      rooms[roomId] = {
        users: [socket, partner],
        turns: { [socket.id]: 0, [partner.id]: 0 },
        history: { [socket.id]: [], [partner.id]: [] },
        accepted: { [socket.id]: false, [partner.id]: false }
      };

      socket.join(roomId);
      partner.join(roomId);

      io.to(roomId).emit('matched', { roomId });
      
      // 첫 인사 전송
      const msg = "안녕! 반가워요. 우리 대화 좀 해볼까요?";
      socket.emit('screening_msg', { from: 'ai', text: `(상대방 ${partner.nickname}) ${msg}` });
      partner.emit('screening_msg', { from: 'ai', text: `(상대방 ${socket.nickname}) ${msg}` });
    } else {
      waitingQueue.push(socket);
      socket.emit('waiting');
    }
  });

  socket.on('screening_send', async ({ roomId, text }) => {
    const room = rooms[roomId];
    if (!room) return;

    const myId = socket.id;
    const partner = room.users.find(u => u.id !== myId);
    
    // 나의 메시지 전송
    socket.emit('screening_msg', { from: 'me', text });
    room.history[myId].push({ role: 'user', content: text });
    room.turns[myId]++;

    // 5턴 이하일 때는 AI가 대답
    if (room.turns[myId] < 5) {
      socket.emit('screening_typing', true);
      const aiReply = await callAI(text, partner.nickname, socket.nickname, room.history[myId]);
      socket.emit('screening_typing', false);
      
      socket.emit('screening_msg', { from: 'ai', text: aiReply });
      room.history[myId].push({ role: 'assistant', content: aiReply });
    } else {
      // 5턴이 넘으면 AI 리포트 생성
      socket.emit('screening_typing', true);
      const report = await generateReport(room.history[myId]);
      socket.emit('screening_typing', false);
      
      socket.emit('report_ready', {
        partnerNickname: partner.nickname,
        report: { summary: report, tags: ["분석완료"], recommendation: "대화를 추천합니다!" }
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
    console.log('❌ 사용자 접속 해제');
  });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 서버 실행 중: ${PORT}`);
});
