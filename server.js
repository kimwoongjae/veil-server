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
const CF_MODEL      = '@cf/meta/llama-3-8b-instruct';

async function callAI(text) {
  console.log("🤖 AI에게 물어보는 중: ", text);
  try {
    const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/ai/run/${CF_MODEL}`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${CF_API_TOKEN}` },
      body: JSON.stringify({ messages: [{ role: 'user', content: text }] })
    });
    const data = await res.json();
    console.log("✅ AI 응답 완료");
    return data.result.response;
  } catch (e) {
    console.log("❌ AI 에러:", e.message);
    return "AI 대화 오류";
  }
}

let waitingQueue = [];
io.on('connection', (socket) => {
  console.log('✅ 새 사용자 접속:', socket.id);

  socket.on('join_queue', ({ nickname }) => {
    socket.nickname = nickname;
    console.log(`👤 ${nickname} 대기열 합류`);
    if (waitingQueue.length > 0) {
      const partner = waitingQueue.shift();
      const roomId = socket.id + partner.id;
      socket.join(roomId); partner.join(roomId);
      io.to(roomId).emit('matched', { roomId });
      console.log(`💖 매칭 성공: ${nickname} & ${partner.nickname}`);
    } else {
      waitingQueue.push(socket);
    }
  });

  socket.on('screening_send', async ({ roomId, text }) => {
    console.log(`💬 메시지 수신: ${text}`);
    socket.emit('screening_msg', { from: 'me', text });
    const reply = await callAI(text);
    socket.emit('screening_msg', { from: 'ai', text: reply });
  });
});

server.listen(10000, '0.0.0.0');
