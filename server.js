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

// --- 언어 매핑 (전 세계 30개 이상의 언어 지원) ---
const langMap = {
  'ko': 'Korean',
  'en': 'English',
  'ja': 'Japanese',
  'zh': 'Chinese (Simplified)',
  'zh-TW': 'Chinese (Traditional)',
  'vi': 'Vietnamese',
  'fr': 'French',
  'pt': 'Portuguese',
  'es': 'Spanish',
  'de': 'German',
  'ru': 'Russian',
  'ar': 'Arabic',
  'hi': 'Hindi',
  'it': 'Italian',
  'tr': 'Turkish',
  'id': 'Indonesian',
  'th': 'Thai',
  'ms': 'Malay',
  'nl': 'Dutch',
  'pl': 'Polish',
  'sv': 'Swedish',
  'fil': 'Filipino',
  'my': 'Burmese',
  'km': 'Khmer',
  'lo': 'Lao',
  'bn': 'Bengali',
  'pa': 'Punjabi',
  'te': 'Telugu',
  'mr': 'Marathi',
  'ta': 'Tamil',
  'ur': 'Urdu'
};

function getLangName(code) {
  return langMap[code] || 'English';
}

async function translateWithAI(text, fromCode, toCode) {
  if (fromCode === toCode || !text) return text;
  
  const fromLang = getLangName(fromCode);
  const toLang = getLangName(toCode);
  
  console.log(`🌐 [Global Translation] ${fromLang} -> ${toLang}`);
  
  try {
    const messages = [
      { role: 'system', content: `You are a world-class native translator specializing in casual, colloquial dating app conversations.
Your goal is to translate the user's message from ${fromLang} to ${toLang} so it sounds perfectly natural to a native speaker.

CRITICAL RULES for High Quality:
1. FOCUS on the target culture. If the target is Korean, use appropriate casual endings (e.g., -어, -야). If Japanese, use natural casual forms (e.g., -다ね, -だよ).
2. If the text is in Korean/Japanese/Chinese/English, ensure the nuances of honorifics and social distance are maintained but kept casual enough for a 1-on-1 chat.
3. Translate the INTENT, not just words. Use slang or idioms if they fit the vibe.
4. NEVER output explanations, notes, or multiple options. Output ONLY the translated text in ${toLang}.
5. Do NOT use translation software artifacts like "(Note: ...)" or "Literally: ...".` },
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
        content: `You are roleplaying as a human named '${myNick}', chatting with '${partnerNick}' on a casual dating/social app.
Your Persona: ${profileText}
Your Current Objective: "${objective}"

CRITICAL RULES for Authenticity:
1. You MUST write ENTIRELY in ${myLang} native script.
2. ACT like a real person, not an AI. Use casual, modern language that a 20-30 year old would use in ${myLang}.
3. If ${myLang} is Korean, use natural casual endings like "~해", "~야", "ㅋㅋ", "ㅎㅎ".
4. If ${myLang} is Japanese, use natural casual forms like "〜だよ", "〜だね", "笑".
5. If ${myLang} is Chinese, use natural colloquialisms and avoid formal business-like phrasing.
6. Keep messages short and engaging (1-2 sentences), like a real mobile text message.
7. NEVER mention you are a model or assistant. Stay in character at all times.` 
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
      { role: 'system', content: `You are a psychologist and relationship expert analyzing a chat log for a dating app.
Summarize the Opponent's personality and conversational style in 3 short sentences.
Also, provide a Compatibility Score (0-100) based on how well the two speakers seem to get along, their shared interests, and tone.

CRITICAL RULES:
1. You MUST write your summary ENTIRELY in ${myLang}.
2. You MUST return the result in EXACTLY this format:
Summary: [Your summary here]
Score: [Number only, 0-100]
` },
      { role: 'user', content: `Chat Log:\n${chatScript}\n\nProvide the report now:` }
    ];

    let result = await fetchFromAI(messages);
    result = result.trim();
    
    let summary = "상대방은 대화를 즐겁게 이어나가는 긍정적인 성격으로 보입니다.";
    let score = 75;

    const summaryMatch = result.match(/Summary:\s*([\s\S]+?)(?=\nScore:|$)/i);
    const scoreMatch = result.match(/Score:\s*(\d+)/i);

    if (summaryMatch) summary = summaryMatch[1].trim().replace(/^"+|"+$/g, '');
    if (scoreMatch) score = parseInt(scoreMatch[1]);
    
    return { summary, score };
  } catch (e) {
    return { summary: "상대방은 대화를 즐겁게 이어나가는 긍정적인 성격으로 보입니다.", score: 70 };
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
  
  const [reportA, reportB] = await Promise.all([
    generateReport(room.history[userA.id], userA.profile.lang),
    generateReport(room.history[userB.id], userB.profile.lang)
  ]);
  
  io.to(roomId).emit('screening_typing', false);
  
  userA.emit('report_ready', { partnerNickname: userB.nickname, report: reportA });
  userB.emit('report_ready', { partnerNickname: userA.nickname, report: reportB });
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
        realHistory: [], // 실제 채팅 내역 저장용
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

    // 서버에 실제 대화 내역 저장 (AI 도움말용)
    room.realHistory.push({ role: 'user', name: socket.nickname, content: text, lang: socket.profile.lang });

    socket.to(roomId).emit('chat_msg', { 
        from: socket.nickname, 
        text: translatedText,
        original: (translatedText !== text) ? text : null
    });
  });

  // --- AI 답변 도우미 ---
  socket.on('ask_ai_help', async ({ roomId }) => {
    const room = rooms[roomId];
    if (!room) return;

    console.log(`✨ [AI 도우미 요청] Room: ${roomId}, User: ${socket.nickname}`);
    
    try {
      const myLang = getLangName(socket.profile.lang);
      const chatScript = room.realHistory.map(m => `${m.name}: ${m.content}`).join('\n');
      
      const messages = [
        { 
          role: 'system', 
          content: `You are an AI wingman helping '${socket.nickname}' chat with a partner.
Based on the following chat history and '${socket.nickname}''s profile, suggest ONE natural, engaging next message (response or a question) in ${myLang}.

Profile: ${JSON.stringify(socket.profile)}

CRITICAL RULES:
1. Output ONLY the suggested text in ${myLang}. No quotes, no explanations.
2. Make it sound casual and natural for a 20-30 year old.
3. If there's no history yet, suggest a friendly icebreaker.` 
        },
        { role: 'user', content: `Chat History:\n${chatScript}\n\nSuggest a message now:` }
      ];

      const suggestion = await fetchFromAI(messages);
      socket.emit('ai_suggestion', { text: suggestion.trim().replace(/^"+|"+$/g, '') });
    } catch (e) {
      console.log("❌ [AI 도움 에러]:", e.message);
      socket.emit('ai_suggestion', { text: "음... 뭐라고 하면 좋을까?" });
    }
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
