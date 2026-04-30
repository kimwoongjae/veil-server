const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

// 환경변수 확인
const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID;
const CF_API_TOKEN  = process.env.CF_API_TOKEN;
// 더 안정적인 모델(Llama 3)로 변경해봅니다.
const CF_MODEL      = '@cf/meta/llama-3-8b-instruct';

async function callAI(text) {
  if (!CF_ACCOUNT_ID || !CF_API_TOKEN) {
    console.log("❌ 에러: Render 환경변수(ID/Token)가 설정되지 않았습니다.");
    return "AI 설정 오류가 발생했습니다.";
  }

  try {
    const url = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/ai/run/${CF_MODEL}`;
    console.log("🤖 AI 호출 중...");

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${CF_API_TOKEN}` },
      body: JSON.stringify({
        messages: [
          { role: 'system', content: '너는 친절한 채팅 상대방이야. 한국어로 짧게 대답해줘.' },
          { role: 'user', content: text }
        ]
      })
    });

    const data = await res.json();

    if (data.success) {
      console.log("✅ AI 응답 성공");
      return data.result.response;
    } else {
      console.log("❌ AI 응답 실패:", data.errors);
      return "상대방이 생각 중입니다... (AI 오류)";
    }
  } catch (e) {
    console.log("❌ AI 연결 에러:", e.message);
    return "연결이 잠시 지연되고 있습니다.";
  }
}

let waitingQueue = [];
let rooms = {};

io.on('connection', (socket) => {
  console.log('접속:', socket.id);

  socket.on('join_queue', ({ nickname }) => {
    socket.nickname = nickname;
    if (waitingQueue.length > 0) {
      const partner = waitingQueue.shift();
      if (partner.id === socket.id) { waitingQueue.push(socket); return; }
      
      const roomId = socket.id + '_' + partner.id;
      rooms[roomId] = { [socket.id]: true, [partner.id]: true };
      socket.join(roomId); partner.join(roomId);
      
      io.to(roomId).emit('matched', { roomId });
      io.to(roomId).emit('screening_msg', { from: 'ai', text: `매칭 성공! AI가 대화를 돕습니다. 먼저 인사를 나눠보세요!` });
    } else {
      waitingQueue.push(socket);
      socket.emit('waiting');
    }
  });

  socket.on('screening_send', async ({ roomId, text }) => {
    socket.emit('screening_msg', { from: 'me', text });
    socket.emit('screening_typing', true);
    
    // AI 대답 가져오기
    const reply = await callAI(text);
    
    socket.emit('screening_typing', false);
    socket.emit('screening_msg', { from: 'ai', text: reply });
    
    // 테스트를 위해 한 번만 대화해도 리포트 버튼이 뜨도록 설정
    socket.emit('report_ready', { 
      partnerNickname: "매칭 상대", 
      report: { summary: "분석 완료! 대화를 시작해보세요.", tags: ["친절함"], recommendation: "추천" } 
    });
  });

  socket.on('accept_chat', ({ roomId }) => {
    io.to(roomId).emit('chat_start', { partnerNickname: "매칭 상대" });
  });

  socket.on('chat_send', ({ roomId, text }) => {
    socket.to(roomId).emit('chat_msg', { from: socket.nickname, text });
    socket.emit('chat_msg', { from: 'me', text });
  });

  socket.on('disconnect', () => {
    waitingUsers = waitingQueue.filter(u => u.id !== socket.id);
  });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 서버 실행 중: ${PORT}`);
});
