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
  '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
  '@cf/meta/llama-4-scout-17b-16e-instruct',
  '@cf/meta/llama-3.1-8b-instruct-fp8-fast'
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

  try {
    const messages = [
      {
        role: 'system',
        content: `You are a high-accuracy translator for a casual one-to-one chat app.
Translate the user's message from ${fromLang} to ${toLang}.

RULES:
1. Preserve the exact meaning, question intent, tone, politeness, names, numbers, and emoji.
2. Use natural conversational ${toLang}; do not add, remove, answer, or explain anything.
3. Resolve omitted subjects and objects from the words in the source, not by guessing a new topic.
4. Distinguish nationality/person words from language words. For example, Korean "일본어도 하세요?" means "Can you speak Japanese too?", so in Japanese translate it as "日本語も話せますか？", never "日本人でも？".
5. Output only the translation, with no quotation marks, labels, notes, or alternatives.`
      },
      { role: 'user', content: text }
    ];

    let translated = (await fetchFromAI(messages)).trim();

    // 모델이 드물게 덧붙이는 따옴표나 번역 라벨 제거
    translated = translated
      .replace(/^(translation|translated text)\s*:\s*/i, '')
      .replace(/^["']|["']$/g, '')
      .trim();

    if (!translated) throw new Error('빈 번역 결과');

    // 질문과 감탄의 의도가 번역 중 사라지지 않도록 보존
    if (/[?？]\s*$/.test(text) && !/[?？]\s*$/.test(translated)) {
      translated += '?';
    }
    if (/!\s*$/.test(text) && !/[!！]\s*$/.test(translated)) {
      translated += '!';
    }

    return translated;
  } catch (e) {
    console.error(
      `❌ [AI 번역 오류] ${fromCode} -> ${toCode}:`,
      e.message
    );

    // 모든 번역 모델이 실패하면 채팅이 중단되지 않도록 원문 전달
    return text;
  }
}
// --- ⚡ 초고속 일석이조 AI 호출 (생성+번역 한 번에) ---
async function callAIWithTranslation(
  partnerNick,
  myProfile,
  targetLangCode,
  objective,
  history
) {
  const myLangCode = myProfile.lang || 'ko';
  const myLang = getLangName(myLangCode);
  const targetLangName = getLangName(targetLangCode);
  const myNick = myProfile.nickname || 'Unknown';

  let profileText =
    `Age: ${myProfile.age || 'Unknown'}, ` +
    `Gender: ${myProfile.gender || 'Unknown'}, ` +
    `Country: ${myProfile.countryName || 'Unknown'}`;

  if (myProfile.hobby) {
    profileText += `, Hobby: ${myProfile.hobby}`;
  }
  if (myProfile.personality) {
    profileText += `, Personality: ${myProfile.personality}`;
  }

  console.log(
    `💬 [AI Chat] ${myNick}(${myLang}) -> Target(${targetLangName})`
  );

  try {
    const messages = [
      {
        role: 'system',
        content: `You are roleplaying as '${myNick}', chatting with '${partnerNick}'.
Persona: ${profileText}
Objective: "${objective}"

Rules:
- Write only in ${myLang}.
- Be casual and natural, like a mobile chat.
- Use only 1-2 short sentences.
- Continue naturally from the conversation history.
- Preserve questions as questions.
- Do not invent facts about the other person.
- Output only the message text. Do not output JSON, labels, or explanations.`
      },
      ...history
    ];

    const reply = (await fetchFromAI(messages)).trim();

    if (!reply) {
      throw new Error('AI 대화 생성 결과가 비어 있습니다.');
    }

    const translation = await translateWithAI(
      reply,
      myLangCode,
      targetLangCode
    );

    return {
      reply,
      translation
    };
  } catch (e) {
    console.error('❌ [AI 대화 생성 오류]:', e.message);
    return {
      reply: '...',
      translation: '...'
    };
  }
}

// --- AI 대화 기반 공통 분석 보고서 생성 ---
async function generateReport(history) {
  const chatScript = history
    .filter(m => m && m.content && m.content.trim())
    .map(m => `${m.role === 'assistant' ? 'Assistant A' : 'Assistant B'}: ${m.content.trim()}`)
    .join('\n');

  const fallback = {
    summary: 'The AI assistants exchanged a short conversation, but there is not enough evidence yet to make a confident judgment. Treat this as a preliminary impression rather than a conclusion about either person.',
    score: 50
  };

  if (!chatScript) return fallback;

  try {
    const messages = [
      {
        role: 'system',
        content: `You evaluate a short conversation between two AI assistants acting on behalf of users in a social matching app.
This is NOT a direct conversation between the users, so all conclusions must be tentative and evidence-based.

Write a neutral compatibility report in English using 2 or 3 concise sentences, followed by one integer score.
Mention at least one concrete topic or interaction visible in the transcript. Do not invent personality traits, feelings, intentions, or shared interests that are not supported by the transcript.

SCORING RUBRIC:
- 50: neutral or insufficient evidence
- 60-69: some conversational potential
- 70-79: good reciprocal engagement supported by clear evidence
- 80-89: strong compatibility supported by several specific mutual signals
- 90-100: exceptional and rare; use only with extensive, highly consistent evidence
Reduce the score for generic exchanges, repetition, awkward replies, unanswered questions, or very little evidence.
A short screening conversation should normally remain between 45 and 75.

Return EXACTLY:
Summary: [English summary]
Score: [integer from 0 to 100]`
      },
      { role: 'user', content: `AI assistant conversation:\n${chatScript}` }
    ];

    const result = (await fetchFromAI(messages)).trim();
    const summaryMatch = result.match(/Summary:\s*([\s\S]+?)(?=\nScore:|$)/i);
    const scoreMatch = result.match(/Score:\s*(\d{1,3})/i);

    if (!summaryMatch || !scoreMatch) return fallback;

    const summary = summaryMatch[1].trim().replace(/^"+|"+$/g, '');
    const score = Math.max(0, Math.min(100, Number.parseInt(scoreMatch[1], 10)));

    if (!summary || !Number.isFinite(score)) return fallback;
    return { summary, score };
  } catch (e) {
    console.error('❌ [Report Gen Error]:', e.message);
    return fallback;
  }
}
// --- AI vs AI 자동 스크리닝 오케스트레이터 ---
async function startInteractiveScreening(roomId, matcher, waiter) {
  const room = rooms[roomId];
  if (!room) return;

  console.log(`🍿 [AI 자동 스크리닝] ${matcher.nickname} AI <-> ${waiter.nickname} AI`);

  // 기존 3회 왕복과 같은 분량: 양쪽 AI가 번갈아 총 6개 메시지 생성
  const TOTAL_MESSAGES = 6;
  let speaker = matcher;
  let listener = waiter;

  for (let turn = 0; turn < TOTAL_MESSAGES; turn++) {
    if (!rooms[roomId]) break;

    io.to(roomId).emit('screening_typing', true);

    const sameLang = speaker.profile.lang === listener.profile.lang;
    let aiData;

    if (sameLang) {
      const speakerLang = getLangName(speaker.profile.lang);
      const messages = [
        {
          role: 'system',
          content: `You are the AI assistant of '${speaker.nickname}', having a short screening conversation with the AI assistant of '${listener.nickname}'.
Persona: ${JSON.stringify(speaker.profile)}
Objective: "${speaker.profile?.objective || '친절하게 대화해.'}"
Rules:
- Speak ONLY in ${speakerLang}.
- Reply naturally to the latest message and help the conversation progress.
- Use only 1 short sentence.
- Do not repeat a question that was already asked.
- Do not invent facts about either person.
- Output ONLY the message text.`
        },
        ...room.history[speaker.id]
      ];
      const reply = (await fetchFromAI(messages)).trim();
      aiData = { reply, translation: reply };
    } else {
      aiData = await callAIWithTranslation(
        listener.nickname,
        { ...speaker.profile, nickname: speaker.nickname },
        listener.profile.lang,
        speaker.profile?.objective || '친절하게 대화해.',
        room.history[speaker.id]
      );
    }

    if (!rooms[roomId]) break;

    io.to(roomId).emit('screening_typing', false);

    // 말한 사람에게는 자신의 AI 메시지, 상대에게는 상대방 AI 메시지로 표시
    speaker.emit('screening_msg', {
      from: 'me',
      text: aiData.reply
    });
    listener.emit('screening_msg', {
      from: 'ai',
      text: sameLang ? aiData.reply : aiData.translation,
      original: sameLang ? null : aiData.reply
    });

    room.history[speaker.id].push({ role: 'assistant', content: aiData.reply });
    room.history[listener.id].push({
      role: 'user',
      content: sameLang ? aiData.reply : aiData.translation
    });

    // 다음 메시지는 상대방 AI가 즉시 생성
    [speaker, listener] = [listener, speaker];
  }

  if (!rooms[roomId]) return;

  console.log(`📝 [리포트 생성 시작] ${roomId}`);
  io.to(roomId).emit('screening_typing', true);

  // 동일한 대화를 한 번만 분석하여 두 사용자에게 같은 점수를 제공한다.
  const sharedReport = await generateReport(room.history[matcher.id]);
  const [summaryForMatcher, summaryForWaiter] = await Promise.all([
    translateWithAI(sharedReport.summary, 'en', matcher.profile.lang),
    translateWithAI(sharedReport.summary, 'en', waiter.profile.lang)
  ]);
  const reportA = { summary: summaryForMatcher, score: sharedReport.score };
  const reportB = { summary: summaryForWaiter, score: sharedReport.score };

  io.to(roomId).emit('screening_typing', false);

  matcher.emit('report_ready', { partnerNickname: waiter.nickname, report: reportA });
  waiter.emit('report_ready', { partnerNickname: matcher.nickname, report: reportB });
}

// --- 매칭 대기열 및 룸 관리 ---
let waitingQueue = []; 
const rooms = {};

// 두 사용자를 즉시 룸에 연결하고 AI 자동 스크리닝 시작
function startMatchedRoom(userA, userB) {
  if (!userA || !userB) return;

  const roomId = `room_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
  rooms[roomId] = {
    users: [userA, userB],
    history: { [userA.id]: [], [userB.id]: [] },
    realHistory: [],
    accepted: { [userA.id]: false, [userB.id]: false }
  };

  [userA, userB].forEach(user => {
    user.join(roomId);
    user.roomId = roomId;
    delete user.pendingPartner;
  });

  io.to(roomId).emit('matched', { roomId });

  // 같은 역할끼리 매칭된 경우에도 두 사용자를 확실하게 구분
  const matcher = userA.role === 'matcher' ? userA : userB;
  const waiter = matcher.id === userA.id ? userB : userA;
  startInteractiveScreening(roomId, matcher, waiter);
}
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

    // 상대방 프로필에서 자동 수락을 선택했다면 확인 창 없이 바로 시작
    const requiresApproval = waiter.profile?.requireMatchApproval !== false;
    if (!requiresApproval) {
      console.log(`⚡ [Auto Accept] ${waiter.nickname} skipped the approval dialog.`);
      startMatchedRoom(matcher, waiter);
    } else {
      waiter.emit('incoming_match', {
        fromId: matcher.id,
        fromNickname: matcher.nickname,
        fromProfile: matcher.profile
      });
      matcher.emit('match_waiting', { partnerNickname: waiter.nickname });
    }
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
      startMatchedRoom(partner, socket);
    } else {
      partner.emit('match_declined');
      delete socket.pendingPartner;
      delete partner.pendingPartner;
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
  socket.on('chat_send', ({ roomId, text }) => {
    const room = rooms[roomId];
    if (!room) return;

    const partner = room.users.find(u => u.id !== socket.id);
    if (!partner) return;

    const msgId = `msg_${Date.now()}_${socket.id.substring(0, 4)}`;

    // 1. 보낸 사람에게는 원본만 즉시 표시
    socket.emit('chat_msg', { id: msgId, from: 'me', text });

    // 2. 받는 사람에게도 원본을 즉시 전송 (지연 시간 최소화)
    // 언어가 다를 경우 '번역 중' 상태를 함께 보낼 수 있음
    const isDifferentLang = socket.profile.lang !== partner.profile.lang;
    
    partner.emit('chat_msg', { 
        id: msgId,
        from: socket.nickname, 
        text: text, // 우선 원본 전송
        isTranslating: isDifferentLang 
    });

    // 서버에 실제 대화 내역 저장
    room.realHistory.push({ role: 'user', name: socket.nickname, content: text, lang: socket.profile.lang });

    // 3. 비동기 번역 시작 (기다리지 않음)
    if (isDifferentLang) {
        translateWithAI(text, socket.profile.lang, partner.profile.lang).then(translatedText => {
            // 번역이 완료되면 발신자와 수신자 모두에게 업데이트 전송
            const updateData = {
                id: msgId,
                text: translatedText,
                original: text
            };
            
            partner.emit('chat_update', updateData);
            socket.emit('chat_update', updateData); // 내가 보낸 메시지도 번역본 확인 가능
        }).catch(err => {
            console.error("Translation error:", err);
        });
    }
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
