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
// 아시아 언어(한국어/일본어) 처리에 최적화된 고품질 모델만 엄선 (오역이 심한 Llama 3.0은 제외)
const CF_MODELS = [
  '@cf/qwen/qwen1.5-7b-chat-awq',   // 1순위: 한/일어 번역 압도적 1위 Qwen (가볍고 빠름)
  '@cf/meta/llama-3.1-8b-instruct'  // 2순위: 다국어 성능이 대폭 개선된 Llama 3.1
];

// --- 공통 AI API 호출기 ---
async function fetchFromAI(messages) {
  for (const model of CF_MODELS) {
    try {
      const url = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/ai/run/${model}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 
          'Authorization': `Bearer ${CF_API_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ messages })
        // 콜드 스타트(첫 구동) 시 10초 이상 걸릴 수 있으므로 8초 타임아웃 삭제
      });
      
      const data = await res.json();
      if (data.success && data.result && data.result.response) {
        return data.result.response;
      }
    } catch (e) {
      console.log(`⚠️ [AI 에러] 모델: ${model}, 사유: ${e.message}`);
    }
  }
  throw new Error("모든 AI 모델의 응답이 실패했습니다.");
}

// --- 언어 매핑 ---
const langMap = {
  'ko': 'Korean',
  'en': 'English',
  'ja': 'Japanese',
  'zh': 'Chinese',
  'vi': 'Vietnamese',
  'fr': 'French',
  'pt': 'Portuguese',
  'es': 'Spanish',
  'de': 'German',
  'ru': 'Russian',
  'ar': 'Arabic',
  'hi': 'Hindi'
};

function getLangName(code) {
  return langMap[code] || 'English';
}

async function translateWithAI(text, fromCode, toCode) {
  if (fromCode === toCode || !text) return text;
  
  const fromLang = getLangName(fromCode);
  const toLang = getLangName(toCode);
  
  console.log(`🌐 [초고성능 번역 중...] ${fromLang} -> ${toLang}`);
  
  try {
    const messages = [
      { role: 'system', content: `You are a top-tier native translator for a casual dating app.
Translate the following text into perfectly natural, colloquial ${toLang}.

CRITICAL RULES:
1. Translate the INTENT and VIBE, not the literal words. (e.g. If Korean is "여자분이세요?", translate to "女性の方ですか？" in Japanese. NEVER use derogatory terms like "お前").
2. Use polite but friendly casual language suitable for 20-30 year olds chatting online.
3. NEVER mix languages or scripts. Output ONLY the perfectly translated ${toLang} text. No quotes, no explanations.
4. ABSOLUTELY NO TRANSLATOR NOTES. NEVER output things like "(Note: ...)" or "I translated this as...".` },
      { role: 'user', content: text }
    ];

    let result = await fetchFromAI(messages);
    result = result.trim();
    
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
async function callAI(partnerNick, myProfile, objective, history) {
  const myLangCode = myProfile.lang || 'ko';
  const myLang = getLangName(myLangCode);
  const myNick = myProfile.nickname || 'Unknown';
  
  let profileText = `Age: ${myProfile.age || 'Unknown'}, Gender: ${myProfile.gender || 'Unknown'}, Country: ${myProfile.countryName || 'Unknown'}`;
  if (myProfile.hobby) profileText += `, Hobby: ${myProfile.hobby}`;
  if (myProfile.personality) profileText += `, Personality: ${myProfile.personality}`;

  console.log(`🤖 [AI 대화 생성] (이름: ${myNick}, 언어: ${myLang})`);
  
  try {
    const messages = [
      { 
        role: 'system', 
        content: `You are roleplaying as a human named '${myNick}', chatting with '${partnerNick}'.
Here is your persona/profile: ${profileText}
Your Objective: "${objective}"

CRITICAL RULES:
1. You MUST write your response ENTIRELY in ${myLang} native script.
2. NEVER use English or Romaji. If ${myLang} is Korean, use ONLY Hangul. If Japanese, use ONLY Kana/Kanji.
3. NEVER say you are an AI, an assistant, or a model. Act like a real person on a chat app based strictly on your profile.
4. Keep your responses short, natural, and casual (like a mobile text message).` 
      },
      ...history
    ];

    let reply = await fetchFromAI(messages);
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
  const chatScript = history.map(m => `${m.role === 'assistant' ? 'Me' : 'Opponent'}: ${m.content}`).join('\n');
  
  try {
    const messages = [
      { role: 'system', content: `You are a psychologist analyzing a chat log. Summarize the Opponent's personality and conversational style in 3 short sentences.
CRITICAL RULE: You MUST write your summary ENTIRELY in ${myLang}. Do NOT use English.` },
      { role: 'user', content: `Chat Log:\n${chatScript}\n\nProvide the summary now:` }
    ];

    let result = await fetchFromAI(messages);
    result = result.trim();
    
    // 간혹 AI가 응답을 따옴표로 감싸거나 비정상적인 따옴표 뭉치를 보내는 경우 정제
    result = result.replace(/^"+|"+$/g, '').trim();
    if (!result) result = "상대방은 대화를 즐겁게 이어나가는 긍정적인 성격으로 보입니다.";
    
    return result;
  } catch (e) {
    return "상대방은 대화를 즐겁게 이어나가는 긍정적인 성격으로 보입니다.";
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
      currentSpeaker.profile, 
      currentSpeaker.profile?.objective || "친절하게 대화해.",
      room.history[currentSpeaker.id]
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
  socket.on('leave_chat', ({ roomId }) => {
    socket.to(roomId).emit('chat_ended');
    delete rooms[roomId];
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
