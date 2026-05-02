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
const CF_MODEL      = '@cf/meta/llama-3-8b-instruct'; 

// --- 언어 매핑 ---
const langMap = {
  'ko': 'Korean',
  'en': 'English',
  'ja': 'Japanese',
  'zh': 'Chinese'
};

function getLangName(code) {
  return langMap[code] || 'English';
}

// --- 번역 통역사 함수 ---
async function translateWithAI(text, fromCode, toCode) {
  if (fromCode === toCode || !text) return text;
  
  const fromLang = getLangName(fromCode);
  const toLang = getLangName(toCode);
  
  console.log(`🌐 [통역 중...] ${fromLang} -> ${toLang}`);
  
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
          { role: 'system', content: `You are an expert native translator specializing in casual messenger chats.
Translate the given text into perfectly natural, native-sounding ${toLang}.
Context: The text is a short message from a casual chat app.
CRITICAL RULES:
1. NEVER use literal, word-for-word translation. Capture the true meaning and natural tone. (e.g., 'そうです' -> '맞아요', '何歳ですか' -> '몇 살이세요?')
2. Make it sound like a native 20-something year old speaking naturally.
3. Output ONLY the final translated text. DO NOT add quotes, notes, or English.
4. Use ONLY the native script of ${toLang}.` },
          { role: 'user', content: text }
        ]
      })
    });
    
    const data = await res.json();
    if (!data.success) throw new Error("Translation API Failed");
    
    let result = data.result?.response?.trim() || text;
    // 간혹 AI가 겹따옴표를 붙여서 대답하는 경우 제거
    if (result.startsWith('"') && result.endsWith('"')) {
      result = result.slice(1, -1);
    }
    return result;
  } catch (e) {
    console.log("❌ [번역 에러]:", e.message);
    return text;
  }
}

// --- AI 호출 함수 ---
async function callAI(partnerNick, myNick, objective, history, myLangCode) {
  const myLang = getLangName(myLangCode);
  console.log(`🤖 [AI 대화 생성] (이름: ${myNick}, 언어: ${myLang})`);
  
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
          { 
            role: 'system', 
            content: `You are roleplaying as a human named '${myNick}', chatting with '${partnerNick}'.
Your Objective: "${objective}"

CRITICAL RULES:
1. You MUST write your response ENTIRELY in ${myLang} native script.
2. NEVER use English or Romaji. If ${myLang} is Korean, use ONLY Hangul. If Japanese, use ONLY Kana/Kanji.
3. NEVER say you are an AI, an assistant, or a model. Act like a real person on a chat app.
4. Keep your responses short, natural, and casual (like a mobile text message).` 
          },
          ...history
        ]
      })
    });

    const data = await res.json();
    if (!data.success) {
      throw new Error("AI API 호출 실패");
    }

    const reply = data.result?.response;
    if (!reply) return "어라? 뭐라고?";
    return reply.trim();
  } catch (e) {
    console.log("❌ [AI 생성 에러]:", e.message);
    return "...";
  }
}

// --- 분석 보고서 생성 함수 ---
async function generateReport(history, myLangCode) {
  const myLang = getLangName(myLangCode);
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
          { role: 'system', content: `You are a psychologist analyzing a chat log. Summarize the opponent's personality, traits, and interests based on the chat.
CRITICAL: You MUST write your summary ENTIRELY in ${myLang} native script. NO English. Keep it to 3 short sentences.` },
          { role: 'user', content: `Analyze the opponent in this chat log: ${JSON.stringify(history)}` }
        ]
      })
    });
    const data = await res.json();
    return data.result?.response?.trim() || "대화가 아주 잘 통하는 분인 것 같아요!";
  } catch (e) {
    return "대화가 아주 잘 통하는 분인 것 같아요!";
  }
}

// --- AI vs AI 자동 스크리닝 오케스트레이터 ---
async function startAutonomousScreening(roomId, userA, userB) {
  const room = rooms[roomId];
  if (!room) return;
  
  console.log(`🍿 [관전 모드 시작] ${userA.nickname}(${userA.profile.lang}) vs ${userB.nickname}(${userB.profile.lang})`);
  
  // 초기 인사 설정 (각자의 모국어로 생성)
  let initialGreetingA = "안녕하세요! 반가워요ㅋㅋ";
  let initialGreetingB = "안녕하세요! 반가워요ㅋㅋ";
  
  if (userA.profile.lang !== 'ko') initialGreetingA = await translateWithAI(initialGreetingA, 'ko', userA.profile.lang);
  if (userB.profile.lang !== 'ko') initialGreetingB = await translateWithAI(initialGreetingB, 'ko', userB.profile.lang);

  // User A가 보낸 것으로 처리
  const translatedForB = await translateWithAI(initialGreetingA, userA.profile.lang, userB.profile.lang);
  
  userA.emit('screening_msg', { from: 'me', text: initialGreetingA });
  userB.emit('screening_msg', { from: 'ai', text: translatedForB, original: initialGreetingA });
  
  room.history[userA.id].push({ role: 'assistant', content: initialGreetingA });
  room.history[userB.id].push({ role: 'user', content: translatedForB });
  
  let currentSpeaker = userB;
  let currentListener = userA;
  const MAX_TURNS = 5; 
  
  for (let turn = 0; turn < MAX_TURNS; turn++) {
    if (!rooms[roomId]) break;

    io.to(roomId).emit('screening_typing', true);
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    // 현재 화자의 AI가 화자의 모국어로 대답을 생성
    const aiReply = await callAI(
      currentListener.nickname, 
      currentSpeaker.nickname, 
      currentSpeaker.profile?.objective || "친절하게 대화해.",
      room.history[currentSpeaker.id],
      currentSpeaker.profile.lang
    );
    
    if (!rooms[roomId]) break;
    
    // 생성된 대답을 청자의 모국어로 번역
    const translatedReply = await translateWithAI(aiReply, currentSpeaker.profile.lang, currentListener.profile.lang);
    
    io.to(roomId).emit('screening_typing', false);
    
    // 메시지 전송
    currentSpeaker.emit('screening_msg', { from: 'me', text: aiReply });
    currentListener.emit('screening_msg', { from: 'ai', text: translatedReply, original: aiReply });
    
    // 히스토리 업데이트 (각자의 모국어로 저장)
    room.history[currentSpeaker.id].push({ role: 'assistant', content: aiReply });
    room.history[currentListener.id].push({ role: 'user', content: translatedReply });
    
    [currentSpeaker, currentListener] = [currentListener, currentSpeaker];
  }
  
  if (!rooms[roomId]) return;
  
  console.log(`📝 [리포트 생성 시작] ${roomId}`);
  io.to(roomId).emit('screening_typing', true);
  
  // 리포트도 각자의 모국어로 생성
  const [reportA, reportB] = await Promise.all([
    generateReport(room.history[userA.id], userA.profile.lang),
    generateReport(room.history[userB.id], userB.profile.lang)
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
    socket.profile.lang = socket.profile.lang || 'ko';

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
      
      startAutonomousScreening(roomId, socket, partner);
    } else {
      waitingQueue.push(socket);
      socket.emit('waiting');
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

  // --- 실제 채팅 실시간 번역 ---
  socket.on('chat_send', async ({ roomId, text }) => {
    const room = rooms[roomId];
    if (!room) return;

    const partner = room.users.find(u => u.id !== socket.id);
    
    // 보낸 사람에게는 원본만 즉시 표시
    socket.emit('chat_msg', { from: 'me', text });

    // 받는 사람에게는 번역된 텍스트와 원본을 함께 표시
    let translatedText = text;
    if (socket.profile.lang !== partner.profile.lang) {
        translatedText = await translateWithAI(text, socket.profile.lang, partner.profile.lang);
    }

    socket.to(roomId).emit('chat_msg', { 
        from: socket.nickname, 
        text: translatedText,
        original: (translatedText !== text) ? text : null
    });
  });

  socket.on('disconnect', () => {
    waitingQueue = waitingQueue.filter(u => u.id !== socket.id);
    for (const roomId in rooms) {
      if (rooms[roomId].users.some(u => u.id === socket.id)) {
        socket.to(roomId).emit('chat_msg', { from: 'system', text: '상대방의 연결이 끊어졌습니다.' });
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
