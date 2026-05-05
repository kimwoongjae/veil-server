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
// 글로벌 서비스 및 아시아 4개 국어(한/일/영/중)의 미묘한 뉘앙스 처리에 최적화된 최상위 모델군
const CF_MODELS = [
  '@cf/google/gemma-4-26b-a4b-it',     // 1순위: 사용자 요청 최신 젬마 모델 (번역 품질 우수)
  '@cf/meta/llama-3.1-70b-instruct',   // 2순위: 70B 대형 모델 (복잡한 뉘앙스 및 상황 파악)
  '@cf/meta/llama-4-scout-17b-16e-instruct', // 3순위: 차세대 Llama 4 Scout (고성능/고속)
  '@cf/qwen/qwen1.5-7b-chat-awq',      // 백업: 아시아 언어 보조
  '@cf/meta/llama-3.1-8b-instruct'     // 백업: 안정성 위주
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
      { role: 'system', content: `You are a professional, high-accuracy translator. 
Translate the user's message from ${fromLang} to ${toLang} faithfully.

EXAMPLES:
- "안녕" -> "こんにちは" (to Japanese) / "Hi" (to English)
- "반가워" -> "はじめまして" (to Japanese) / "Nice to meet you" (to English)
- "뭐해?" -> "何してるの？" (to Japanese) / "What are you doing?" (to English)

CRITICAL RULES:
1. NO CREATIVITY: Do NOT hallucinate context. If the source is just a greeting, use a standard greeting.
2. NO MIXING: Use ONLY the ${toLang} script. Never use slang or script from other languages (e.g. No "ㅎㅇ" in Japanese).
3. STYLE: Keep it casual for a chat, but maintain the exact meaning.
4. ONLY TRANSLATION: Output only the translated text.` },
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

// --- ⚡ 초고속 일석이조 AI 호출 (생성+번역 한 번에) ---
async function callAIWithTranslation(partnerNick, myProfile, targetLangName, objective, history) {
  const myLangCode = myProfile.lang || 'ko';
  const myLang = getLangName(myLangCode);
  const myNick = myProfile.nickname || 'Unknown';
  
  let profileText = `Age: ${myProfile.age || 'Unknown'}, Gender: ${myProfile.gender || 'Unknown'}, Country: ${myProfile.countryName || 'Unknown'}`;
  if (myProfile.hobby) profileText += `, Hobby: ${myProfile.hobby}`;
  if (myProfile.personality) profileText += `, Personality: ${myProfile.personality}`;

  console.log(`⚡ [Speed Gen] ${myNick}(${myLang}) -> Target(${targetLangName})`);
  
  try {
    const messages = [
      { 
        role: 'system', 
        content: `You are roleplaying as '${myNick}', chatting with '${partnerNick}'.
Persona: ${profileText}
Objective: "${objective}"

CRITICAL: You must provide your response in a strict JSON format with exactly two fields:
1. "reply": Your casual response in native ${myLang}.
2. "translation": The exact translation of that response into ${targetLangName}.

Rules:
- Be casual, like a mobile text (1-2 sentences).
- Use natural expressions (e.g. Korean casual "~해", Japanese casual "〜だよ").
- Output ONLY the JSON string. No explanations.` 
      },
      ...history
    ];

    let result = await fetchFromAI(messages);
    if (!result) return { reply: "...", translation: "..." };

    // JSON 파싱 (경계 부호 등 제거)
    const jsonStr = result.substring(result.indexOf('{'), result.lastIndexOf('}') + 1);
    const parsed = JSON.parse(jsonStr);
    return {
      reply: parsed.reply.trim(),
      translation: parsed.translation.trim()
    };
  } catch (e) {
    console.log("❌ [AI Speed Gen 에러]:", e.message);
    return { reply: "...", translation: "..." };
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

    const resultRaw = await fetchFromAI(messages);
    const result = resultRaw.trim();
    
    let summary = "상대방은 대화를 즐겁게 이어나가는 긍정적인 성격으로 보입니다.";
    let score = 75;

    const summaryMatch = result.match(/Summary:\s*([\s\S]+?)(?=\nScore:|$)/i);
    const scoreMatch = result.match(/Score:\s*(\d+)/i);

    if (summaryMatch) summary = summaryMatch[1].trim().replace(/^"+|"+$/g, '');
    if (scoreMatch) score = parseInt(scoreMatch[1]);
    
    return { summary, score };
  } catch (e) {
    console.error("❌ [Report Gen Error]:", e.message);
    return { summary: "상대방은 대화를 즐겁게 이어나가는 긍정적인 성격으로 보입니다.", score: 70 };
  }
}

// --- AI vs Human 인터랙티브 스크리닝 오케스트레이터 ---
const pendingReplies = {}; // { roomId: resolveFunction }

async function startInteractiveScreening(roomId, matcher, waiter) {
  const room = rooms[roomId];
  if (!room) return;
  
  console.log(`🍿 [인터랙티브 스크리닝] AI(${matcher.nickname}) -> Human(${waiter.nickname})`);
  
  const MAX_TURNS = 3; 
  let currentSpeaker = matcher; // 처음은 항상 Matcher의 AI가 시작
  let currentListener = waiter;
  
  for (let turn = 0; turn < MAX_TURNS; turn++) {
    if (!rooms[roomId]) break;

    // 1. AI 차례 (Matcher의 AI가 말함)
    io.to(roomId).emit('screening_typing', true);
    await new Promise(resolve => setTimeout(resolve, 500)); // 지연 시간 단축
    
    const sameLang = matcher.profile.lang === waiter.profile.lang;
    let aiData;

    if (sameLang) {
      // 같은 언어면 번역 없이 일반 대화 생성
      const myLang = getLangName(matcher.profile.lang);
      const messages = [
        { 
          role: 'system', 
          content: `You are roleplaying as '${matcher.nickname}', chatting with '${waiter.nickname}'.
Persona: ${JSON.stringify(matcher.profile)}
Objective: "${matcher.profile?.objective || "친절하게 대화해."}"
Rules:
- Speak ONLY in ${myLang}.
- Be casual and natural (1-2 sentences).
- Output ONLY the response text.` 
        },
        ...room.history[matcher.id]
      ];
      const reply = await fetchFromAI(messages);
      aiData = { reply: reply.trim(), translation: reply.trim() };
    } else {
      // 다른 언어면 번역 포함 생성
      aiData = await callAIWithTranslation(
        waiter.nickname, 
        matcher.profile, 
        getLangName(waiter.profile.lang),
        matcher.profile?.objective || "친절하게 대화해.",
        room.history[matcher.id]
      );
    }
    
    if (!rooms[roomId]) break;
    io.to(roomId).emit('screening_typing', false);
    
    matcher.emit('screening_msg', { from: 'me', text: aiData.reply });
    waiter.emit('screening_msg', { 
      from: 'ai', 
      text: sameLang ? aiData.reply : aiData.translation, 
      original: sameLang ? null : aiData.reply 
    });
    
    room.history[matcher.id].push({ role: 'assistant', content: aiData.reply });
    room.history[waiter.id].push({ role: 'user', content: sameLang ? aiData.reply : aiData.translation });

    // 2. 사람 차례 (Waiter가 직접 입력해야 함)
    if (!rooms[roomId]) break;
    console.log(`⏳ [Wait for Human] Waiting for ${waiter.nickname}'s reply...`);
    
    const humanReply = await new Promise((resolve) => {
      pendingReplies[roomId] = resolve;
      // 30초 타임아웃 (무한 대기 방지)
      setTimeout(() => resolve("(No response)"), 60000); // 60초로 연장
    });
    
    delete pendingReplies[roomId];
    if (!rooms[roomId]) break;

    const sameLangForHuman = waiter.profile.lang === matcher.profile.lang;
    const translatedForMatcher = sameLangForHuman 
      ? humanReply 
      : await translateWithAI(humanReply, waiter.profile.lang, matcher.profile.lang);
    
    waiter.emit('screening_msg', { from: 'me', text: humanReply });
    matcher.emit('screening_msg', { 
      from: 'ai', 
      text: translatedForMatcher, 
      original: sameLangForHuman ? null : humanReply 
    });

    room.history[waiter.id].push({ role: 'assistant', content: humanReply });
    room.history[matcher.id].push({ role: 'user', content: translatedForMatcher });
  }
  
  if (!rooms[roomId]) return;
  
  console.log(`📝 [리포트 생성 시작] ${roomId}`);
  io.to(roomId).emit('screening_typing', true);
  
  const [reportA, reportB] = await Promise.all([
    generateReport(room.history[matcher.id], matcher.profile.lang),
    generateReport(room.history[waiter.id], waiter.profile.lang)
  ]);
  
  io.to(roomId).emit('screening_typing', false);
  
  matcher.emit('report_ready', { partnerNickname: waiter.nickname, report: reportA });
  waiter.emit('report_ready', { partnerNickname: matcher.nickname, report: reportB });
}


// --- 매칭 대기열 및 룸 관리 ---
let waitingQueue = []; 
const rooms = {};

// --- 매칭 로직 (전역 관리) ---
function tryMatch() {
  // 1. 최우선: Matcher + Waiter 조합 찾기
  let matcher = waitingQueue.find(u => u.role === 'matcher' && !u.pendingPartner);
  let waiter = waitingQueue.find(u => u.role === 'waiter' && !u.pendingPartner);

  // 2. 차선: Waiter가 없으면 Matcher + Matcher 조합이라도 매칭 (유연성)
  if (matcher && !waiter) {
    waiter = waitingQueue.find(u => u.role === 'matcher' && u.id !== matcher.id && !u.pendingPartner);
    if (waiter) {
      console.log(`🔄 [Flexible Match] No waiters found. Matching two Matchers: ${matcher.nickname} & ${waiter.nickname}`);
    }
  }

  // 3. 차선: Matcher가 없으면 Waiter + Waiter 조합이라도 매칭
  if (!matcher && waiter) {
    matcher = waitingQueue.find(u => u.role === 'waiter' && u.id !== waiter.id && !u.pendingPartner);
    if (matcher) {
      console.log(`🔄 [Flexible Match] No matchers found. Matching two Waiters: ${matcher.nickname} & ${waiter.nickname}`);
    }
  }

  console.log(`🔍 [Matching Check] In Queue: ${waitingQueue.length} (Matchers: ${waitingQueue.filter(u=>u.role==='matcher').length}, Waiters: ${waitingQueue.filter(u=>u.role==='waiter').length})`);

  if (matcher && waiter) {
    // 큐에서 제거
    waitingQueue = waitingQueue.filter(u => u.id !== matcher.id && u.id !== waiter.id);
    
    console.log(`🤝 [Match Success] ${matcher.nickname}(${matcher.role}) <-> ${waiter.nickname}(${waiter.role})`);
    
    matcher.pendingPartner = waiter;
    waiter.pendingPartner = matcher;

    // 파트너 정보 교환 및 수락 대기 상태 진입
    waiter.emit('incoming_match', {
      fromId: matcher.id,
      fromNickname: matcher.nickname,
      fromProfile: matcher.profile
    });
    matcher.emit('match_waiting', { partnerNickname: waiter.nickname });
  }
}

io.on('connection', (socket) => {
  console.log('✅ 새 사용자 접속:', socket.id);

  // --- 1. 매칭 대기열 합류 (Matcher vs Waiter 분리) ---
  socket.on('join_queue', (data) => {
    socket.nickname = data.nickname;
    socket.profile = data.profile || { lang: 'ko' };
    socket.role = data.role; // 'matcher' 또는 'waiter'
    socket.pendingPartner = null; // 초기화
    
    // 이미 큐에 있다면 제거 후 다시 삽입 (중복 방지)
    waitingQueue = waitingQueue.filter(u => u.id !== socket.id);
    waitingQueue.push(socket);
    
    console.log(`⏳ [Queue Join] ${socket.role.toUpperCase()} | ${socket.nickname} | Total: ${waitingQueue.length}`);
    
    // 매칭 시도
    tryMatch();
  });

  // --- 2. 매칭 수락/거절 ---
  socket.on('respond_match', (data) => {
    const partner = socket.pendingPartner;
    if (!partner) return;

    if (data.accepted) {
      const roomId = `room_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
      rooms[roomId] = {
        users: [partner, socket],
        history: { [partner.id]: [], [socket.id]: [] },
        realHistory: [],
        accepted: { [partner.id]: false, [socket.id]: false }
      };

      [partner, socket].forEach(s => {
        s.join(roomId);
        s.roomId = roomId;
        delete s.pendingPartner;
      });

      io.to(roomId).emit('matched', { roomId });
      // 항상 matcher가 먼저 시작하므로 역할을 구분하여 전달
      const matcher = partner.role === 'matcher' ? partner : socket;
      const waiter = partner.role === 'waiter' ? partner : socket;
      startInteractiveScreening(roomId, matcher, waiter);
    } else {
      partner.emit('match_declined');
      delete socket.pendingPartner;
      delete partner.pendingPartner;
    }
  });

  // --- 3. 스크리닝 중 사람의 답변 전달 ---
  socket.on('screening_reply', ({ roomId, text }) => {
    if (pendingReplies[roomId]) {
      pendingReplies[roomId](text);
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
      
      // 각자 언어에 맞는 히스토리 생성
      const historyA = room.history[userA.id].map(m => ({
        from: m.role === 'assistant' ? 'me' : 'partner',
        text: m.content
      }));
      const historyB = room.history[userB.id].map(m => ({
        from: m.role === 'assistant' ? 'me' : 'partner',
        text: m.content
      }));

      userA.emit('chat_start', { partnerNickname: userB.nickname, history: historyA });
      userB.emit('chat_start', { partnerNickname: userA.nickname, history: historyB });
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
    console.log('❌ 사용자 접속 종료:', socket.id);
    waitingQueue = waitingQueue.filter(u => u.id !== socket.id);

    if (socket.roomId && rooms[socket.roomId]) {
      io.to(socket.roomId).emit('chat_ended');
      delete rooms[socket.roomId];
    }
  });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 서버 실행 중: ${PORT}`);
});
