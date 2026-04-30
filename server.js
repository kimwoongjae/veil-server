require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args));

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID;
const CF_API_TOKEN  = process.env.CF_API_TOKEN;
const CF_MODEL      = '@cf/google/gemma-7b-it-lora'; 

async function callAI(prompt) {
  if (!CF_ACCOUNT_ID || !CF_API_TOKEN) return "서버 설정 오류";
  try {
    const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/ai/run/${CF_MODEL}`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${CF_API_TOKEN}` },
      body: JSON.stringify({ messages: [{ role: 'user', content: prompt }] })
    });
    const data = await res.json();
    return data.result?.response || "대화 중 오류가 발생했습니다.";
  } catch (e) { return "AI 연결 실패"; }
}

let waitingQueue = [];
let rooms = {};

io.on('connection', (socket) => {
  console.log('접속:', socket.id);
  socket.on('join_queue', ({ nickname }) => {
    socket.nickname = nickname;
    if (waitingQueue.length > 0) {
      const partner = waitingQueue.shift();
      const roomId = socket.id + '_' + partner.id;
      rooms[roomId] = { [socket.id]: { count: 0 }, [partner.id]: { count: 0 } };
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
    socket.emit('screening_typing', fal
