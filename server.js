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
const CF_MODEL      = '@cf/google/gemma-7b-it-lora';

async function callAI(prompt) {
  if (!CF_ACCOUNT_ID || !CF_API_TOKEN) return "AI 설정이 완료되지 않았습니다.";
  try {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/ai/run/${CF_MODEL}`,
      {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${CF_API_TOKEN}` },
        body: JSON.stringify({ messages: [{ role: 'user', content: prompt }] })
      }
    );
    const data = await res.json();
    return data.result?.response || "대화 중 오류가 발생했습니다.";
  } catch (e) {
    return "AI 연결 실패";
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
      io.to(roomId).emit('screening_msg', { from: 'ai', text: `반가워요! AI가 두 분의 대화를 돕습니다.` });
    } else {
      waitingQueue.push(socket);
      socket.emit('waiting');
    }
  });

  socket.on('screening_send', async ({ roomId, text }) => {
    socket.emit('screening_msg', { from: 'me', text });
    socket.emit('screening_typing', true);
    const reply = await callAI(text);
    socket.emit('screening_typing', false);
    socket.emit('screening_msg', { from: 'ai', text: reply });
    socket.emit('report_ready', { 
      partnerNickname: "상대방", 
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
    waitingQueue = waitingQueue.filter(u => u.id !== socket.id);
  });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 서버 실행 중: ${PORT}`);
});
