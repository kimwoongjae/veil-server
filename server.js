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

// ── Cloudflare AI 설정 ──
const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID;
const CF_API_TOKEN  = process.env.CF_API_TOKEN;
const CF_MODEL      = '@cf/google/gemma-3-12b-it'; // 무료 모델

// ── Cloudflare AI 호출 ──
async function callAI(prompt) {
  if (!CF_ACCOUNT_ID || !CF_API_TOKEN) {
    throw new Error('서버에 CF_ACCOUNT_ID / CF_API_TOKEN 환경변수가 설정되지 않았습니다.');
  }
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/ai/run/${CF_MODEL}`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${CF_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messages: [
          { role: 'system', content: 'You are a helpful assistant.' },
          { role: 'user',   content: prompt }
        ],
        max_tokens: 300,
        temperature: 0.85,
      })
    }
  );
  const data = await res.json();
  if (!data.success) throw new Error(data.errors?.[0]?.message || 'Cloudflare AI 오류');
  return data.result?.response?.trim() || '...';
}

// ── AI 분석 보고서 생성 ──
async function generateReport(targetNickname, history) {
  const conv = history.map(m => `${m.role}: ${m.text}`).join('\n');
  const prompt = `The following is a conversation with "${targetNickname}" during a random chat screening:\n${conv}\n\nReturn ONLY valid JSON (no markdown, no explanation):\n{"summary":"2-3 sentence personality summary","tags":["tag1","tag2","tag3","tag4"],"recommendation":"one-line recommendation"}`;
  const raw = await callAI(prompt);
  try {
    return JSON.parse(raw.replace(/```json|```/g, '').trim());
  } catch {
    return { summary: raw, tags: [], recommendation: '' };
  }
}

// ── 상태 관리 ──
const waitingQueue  = [];
const rooms         = {};
const userRoom      = {};
const screeningState = {};
const SCREENING_TURNS = 5;

// ── 소켓 이벤트 ──
io.on('connection', (socket) => {
  console.log('접속:', socket.id);

  // 1. 매칭 요청 (apiKey 파라미터 더 이상 필요 없음)
  socket.on('join_queue', ({ nickname, profile }) => {
    socket.nickname = nickname;
    socket.profile  = profile || {};

    if (waitingQueue.length > 0) {
      const partner = waitingQueue.shift();
      const roomId  = socket.id + '_' + partner.id;

      rooms[roomId] = {
        userA: partner,
        userB: socket,
        screeningDone: { [partner.id]: false, [socket.id]: false }
      };
      userRoom[socket.id]  = roomId;
      userRoom[partner.id] = roomId;

      screeningState[roomId] = {
        [partner.id]: { count: 0, history: [], partnerNick: nickname },
        [socket.id]:  { count: 0, history: [], partnerNick: partner.nickname }
      };

      socket.join(roomId);
      partner.join(roomId);

      partner.emit('matched', { roomId });
      socket.emit('matched',  { roomId });

      sendAIGreeting(partner, roomId);
      sendAIGreeting(socket,  roomId);
    } else {
      waitingQueue.push(socket);
      socket.emit('waiting');
    }
  });

  // AI 첫 인사
  async function sendAIGreeting(userSocket, roomId) {
    const state       = screeningState[roomId][userSocket.id];
    const partnerNick = state.partnerNick;
    const greeting    = `Hi! I'm ${partnerNick} 😊 Nice to meet you here!`;
    state.history.push({ role: partnerNick, text: greeting });
    userSocket.emit('screening_msg', { from: 'ai', text: greeting });
  }

  // 2. 스크리닝 메시지
  socket.on('screening_send', async ({ roomId, text }) => {
    const state = screeningState[roomId]?.[socket.id];
    if (!state) return;

    socket.emit('screening_msg', { from: 'me', text });
    state.history.push({ role: socket.nickname, text });
    state.count++;

    if (state.count >= SCREENING_TURNS) {
      socket.emit('screening_done');
      try {
        const report = await generateReport(state.partnerNick, state.history);
        socket.emit('report_ready', { partnerNickname: state.partnerNick, report });
      } catch (e) {
        socket.emit('report_ready', {
          partnerNickname: state.partnerNick,
          report: { summary: 'Analysis failed. Please try again.', tags: [], recommendation: '' }
        });
      }
      return;
    }

    // AI 응답
    socket.emit('screening_typing', true);
    try {
      const history = state.history.map(m => `${m.role}: ${m.text}`).join('\n');
      const prompt  =
        `You are pretending to be "${state.partnerNick}" in a random chat app.\n` +
        `Goal: naturally learn about "${socket.nickname}"'s personality and interests.\n` +
        `Rules: max 2 sentences, friendly tone, NEVER reveal you are AI.\n\n` +
        `Conversation so far:\n${history}\n` +
        `${socket.nickname}: ${text}\n` +
        `${state.partnerNick}:`;

      const reply = await callAI(prompt);
      state.history.push({ role: state.partnerNick, text: reply });
      socket.emit('screening_typing', false);
      socket.emit('screening_msg', { from: 'ai', text: reply });
    } catch (e) {
      socket.emit('screening_typing', false);
      socket.emit('screening_msg', { from: 'ai', text: '[AI Error: ' + e.message + ']' });
    }
  });

  // 3. 수락 → 채팅 시작
  socket.on('accept_chat', ({ roomId }) => {
    const room = rooms[roomId];
    if (!room) return;
    room.screeningDone[socket.id] = true;

    const both = Object.values(room.screeningDone).every(v => v);
    if (both) {
      room.userA.emit('chat_start', { partnerNickname: room.userB.nickname });
      room.userB.emit('chat_start', { partnerNickname: room.userA.nickname });
    } else {
      socket.emit('waiting_partner_accept');
    }
  });

  // 4. 라이브 채팅
  socket.on('chat_send', ({ roomId, text }) => {
    socket.to(roomId).emit('chat_msg', { from: socket.nickname, text });
    socket.emit('chat_msg', { from: 'me', text });
  });

  // 5. 연결 해제
  socket.on('disconnect', () => {
    console.log('해제:', socket.id);
    const qi = waitingQueue.findIndex(s => s.id === socket.id);
    if (qi !== -1) waitingQueue.splice(qi, 1);

    const roomId = userRoom[socket.id];
    if (roomId) {
      socket.to(roomId).emit('partner_left');
      delete rooms[roomId];
      delete screeningState[roomId];
      delete userRoom[socket.id];
    }
  });
});

app.get('/', (_, res) => res.send('VEIL Server Running ✅'));

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`🚀 VEIL 서버 실행 중: http://localhost:${PORT}`));
