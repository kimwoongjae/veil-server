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
// 현재 클라우드플레어에서 제공하는 가장 똑똑하고 확실하게 작동하는 무료 모델 (Llama 3)
const CF_MODEL      = '@cf/meta/llama-3-8b-instruct'; 

// --- AI 호출 함수 ---
async function callAI(partnerNick, myNick, objective, history) {
  console.log(`🤖 [AI 호출 시작] 연기 중... (이름: ${myNick})`);
  
  try {
    const url = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/ai/run/${CF_MODEL}`;
    
    // 네이티브 fetch 사용 (Node 18+ 지원, Render 기본 환경)
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
- 너의 이름은 '${myNick}'이고, 상대방은 '${partnerNick}'이야.
- 너는 주인을 대신해 상대방을 검증하는 AI 비서야. 하지만 절대 AI 티를 내면 안 돼. 실제 20대 사람처럼 연기해.
- 🎯 주인님의 특명(Objective): "${objective}"
- 위 특명을 완수하기 위해 상대방에게 자연스럽게 질문하고 대화를 리드해.
- **가장 중요한 규칙: 상대방이 말하는 언어(한국어, 일본어, 영어 등)와 동일한 언어로만 대답해.**
- 친구랑 모바일 메신저로 대화하듯이 아주 짧고 자연스러운 구어체로 대답해.` 
          },
          ...history
        ]
      })
    });

    const data = await res.json();
    if (!data.success) {
      console.log("❌ [Cloudflare API Error]:", data.errors);
      throw new Error("AI API 호출 실패");
    }

    const reply = data.result?.response;
    if (!reply) return "어라? 잠깐 딴생각했어ㅋㅋ 뭐라고?";
    return reply.trim();
  } catch (e) {
    console.log("❌ [서버 내부 에러 발생]:", e.message);
    return "아 뭐야ㅋㅋ 나 방금 렉걸림. 다시 말해줘!";
  }
}

// --- 분석 보고서 생성 함수 ---
async function generateReport(history) {
  try {
    const url = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/ai/run/${CF_MODEL}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 
        'Authorization': `Bearer ${CF_API_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        messages: [
          { role: 'system', content: '너는 심리 분석가야. 대화 내용을 보고 상대방의 성격, 특징, 관심사를 한국어 3문장으로 요약해줘.' },
          { role: 'user', content: `이 대화 내용을 보고 상대방의 특징을 알려줘: ${JSON.stringify(history)}` }
        ]
      })
    });
    const data = await res.json();
    return data.result?.response?.trim() || "대화가 아주 잘 통하는 분인 것 같아요! 직접 대화하며 알아보세요.";
  } catch (e) {
    console.log("❌ [리포트 생성 에러]:", e.message);
    return "대화가 아주 잘 통하는 분인 것 같아요! 직접 대화하며 알아보세요.";
  }
}

// --- AI vs AI 자동 스크리닝 오케스트레이터 ---
async function startAutonomousScreening(roomId, userA, userB) {
  const room = rooms[roomId];
  if (!room) return;
  
  console.log(`🍿 [관전 모드 시작] ${userA.nickname} vs ${userB.nickname}`);
  
  // 첫 번째 턴 (User A의 AI가 먼저 인사함)
  const firstMsg = "안녕하세요! 반가워요ㅋㅋ";
  userA.emit('screening_msg', { from: 'me', text: firstMsg });
  userB.emit('screening_msg', { from: 'ai', text: firstMsg });
  
  room.history[userA.id].push({ role: 'assistant', content: firstMsg });
  room.history[userB.id].push({ role: 'user', content: firstMsg });
  
  let currentSpeaker = userB;
  let currentListener = userA;
  const MAX_TURNS = 5; // 첫인사 제외하고 5번 더 핑퐁
  
  for (let turn = 0; turn < MAX_TURNS; turn++) {
    if (!rooms[roomId]) break; // 누군가 나갔으면 중단

    // 현재 화자가 타이핑 중임을 알림
    io.to(roomId).emit('screening_typing', true);
    
    // 자연스러운 타이핑 딜레이 (1.5초)
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    // AI 호출
    const aiReply = await callAI(
      currentListener.nickname, 
      currentSpeaker.nickname, 
      currentSpeaker.profile?.objective || "친절하게 대화해.",
      room.history[currentSpeaker.id]
    );
    
    if (!rooms[roomId]) break;
    io.to(roomId).emit('screening_typing', false);
    
    // 메시지 전송 (화자에게는 'me', 청자에게는 'ai'로 표시됨)
    currentSpeaker.emit('screening_msg', { from: 'me', text: aiReply });
    currentListener.emit('screening_msg', { from: 'ai', text: aiReply });
    
    // 히스토리 업데이트
    room.history[currentSpeaker.id].push({ role: 'assistant', content: aiReply });
    room.history[currentListener.id].push({ role: 'user', content: aiReply });
    
    // 역할 교대
    [currentSpeaker, currentListener] = [currentListener, currentSpeaker];
  }
  
  if (!rooms[roomId]) return;
  
  // 스크리닝 종료 후 리포트 생성
  console.log(`📝 [리포트 생성 시작] ${roomId}`);
  io.to(roomId).emit('screening_typing', true);
  
  const [reportA, reportB] = await Promise.all([
    generateReport(room.history[userA.id]),
    generateReport(room.history[userB.id])
  ]);
  
  io.to(roomId).emit('screening_typing', false);
  
  userA.emit('report_ready', { partnerNickname: userB.nickname, report: { summary: reportA } });
  userB.emit('report_ready', { partnerNickname: userA.nickname, report: { summary: reportB } });
}

let waitingQueue = [];
let rooms = {};

io.on('connection', (socket) => {
  console.log('✅ 새 사용자 접속:', socket.id);

  socket.on('join_queue', ({ nickname, profile }) => {
    socket.nickname = nickname;
    socket.profile = profile || {};
    console.log(`👤 ${nickname} 대기열 합류 (목적: ${socket.profile.objective})`);

    if (waitingQueue.length > 0) {
      const partner = waitingQueue.shift();
      if (partner.id === socket.id) { waitingQueue.push(socket); return; }

      const roomId = socket.id + '_' + partner.id;
      rooms[roomId] = {
        users: [socket, partner],
        history: { [socket.id]: [], [partner.id]: [] },
        accepted: { [socket.id]: false, [partner.id]: false }
      };

      socket.join(roomId); partner.join(roomId);
      io.to(roomId).emit('matched', { roomId });
      
      // 매칭 즉시 자동 스크리닝 시작
      startAutonomousScreening(roomId, socket, partner);
    } else {
      waitingQueue.push(socket);
      socket.emit('waiting');
    }
  });

  // 이제 수동 screening_send 이벤트는 무시하거나 삭제함
  socket.on('screening_send', () => {
    console.log("관전 모드에서는 수동 입력이 무시됩니다.");
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
    
    // 만약 진행 중인 방이 있다면 파기
    for (const roomId in rooms) {
      if (rooms[roomId].users.some(u => u.id === socket.id)) {
        socket.to(roomId).emit('chat_msg', { from: 'ai', text: '상대방의 연결이 끊어졌습니다.' });
        delete rooms[roomId];
      }
    }
    console.log('❌ 사용자 접속 해제:', socket.id);
  });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 서버 실행 중: ${PORT}`);
});
