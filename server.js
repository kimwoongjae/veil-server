require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  pingInterval: 25000,
  pingTimeout: 60000,
  connectionStateRecovery: {
    maxDisconnectionDuration: 2 * 60 * 1000,
    skipMiddlewares: true
  }
});

const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID;
const CF_API_TOKEN  = process.env.CF_API_TOKEN;
// 글로벌 서비스 및 아시아 4개 국어(한/일/영/중)의 미묘한 뉘앙스 처리에 최적화된 최상위 모델군
const CF_MODELS = [
  // 대화 생성은 짧은 응답에 최적화된 고속 모델을 우선 사용한다.
  '@cf/meta/llama-3.1-8b-instruct-fp8-fast',
  '@cf/meta/llama-4-scout-17b-16e-instruct',
  '@cf/google/gemma-4-26b-a4b-it',
  '@cf/meta/llama-3.3-70b-instruct-fp8-fast'
];
// --- 공통 AI API 호출기 ---
async function fetchFromAI(messages) {
  for (const model of CF_MODELS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    try {
      const url = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/ai/run/${model}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 
          'Authorization': `Bearer ${CF_API_TOKEN}`,
          'Content-Type': 'application/json'
        },
        signal: controller.signal,
        body: JSON.stringify({ messages, max_tokens: 120, temperature: 0.3 })
      });
      
      const data = await res.json();
      if (data.success && data.result && data.result.response) {
        return data.result.response;
      }
    } catch (e) {
      console.log(`⚠️ [AI 에러] 모델: ${model}, 사유: ${e.name === 'AbortError' ? '12초 시간 초과' : e.message}`);
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error("모든 AI 모델의 응답이 실패했습니다.");
}

// --- 짧은 실시간 채팅용 고속 번역 호출기 ---
const TRANSLATION_MODELS = [
  '@cf/google/gemma-4-26b-a4b-it',
  '@cf/zai-org/glm-4.7-flash',
  '@cf/meta/llama-3.3-70b-instruct-fp8-fast'
];

// 최근 번역을 재사용해 같은 문장의 응답 시간을 줄인다.
const translationCache = new Map();
const TRANSLATION_CACHE_LIMIT = 500;

function saveTranslationCache(key, value) {
  if (translationCache.size >= TRANSLATION_CACHE_LIMIT) {
    const oldestKey = translationCache.keys().next().value;
    translationCache.delete(oldestKey);
  }
  translationCache.set(key, value);
}

async function fetchTranslationFromAI(messages) {
  for (const model of TRANSLATION_MODELS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    const startedAt = Date.now();

    try {
      const url = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/ai/run/${model}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${CF_API_TOKEN}`,
          'Content-Type': 'application/json'
        },
        signal: controller.signal,
        body: JSON.stringify({
          messages,
          max_tokens: 100,
          temperature: 0
        })
      });

      const data = await res.json();
      if (data.success && data.result && data.result.response) {
        console.log(`⚡ [번역 완료] ${model} / ${Date.now() - startedAt}ms`);
        return data.result.response;
      }

      console.log(`⚠️ [번역 모델 실패] ${model}`);
    } catch (e) {
      console.log(`⚠️ [번역 모델 오류] ${model}: ${e.name === 'AbortError' ? '12초 시간 초과' : e.message}`);
    } finally {
      clearTimeout(timer);
    }
  }

  throw new Error('모든 번역 모델의 응답이 실패했습니다.');
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

function cleanProfileValue(value) {
  return value === undefined || value === null ? '' : String(value).trim();
}

function formatProfileForAI(profile = {}, nickname = 'Unknown') {
  return [
    ['Nickname', nickname || profile.nickname],
    ['Gender', profile.gender],
    ['Age', profile.age],
    ['Country', profile.countryName || profile.country],
    ['Personality', profile.personality],
    ['Hobbies and interests', profile.hobby],
    ['Bio / self-introduction', profile.bio]
  ].map(([label, value]) => [label, cleanProfileValue(value)])
    .filter(([, value]) => value)
    .map(([label, value]) => `${label}: ${value}`)
    .join('\n') || 'No profile details were provided.';
}

function buildProxyRules(myNick, partnerNick, languageName, profileText, objective) {
  return `You are the personal AI proxy for "${myNick}" in a one-to-one matching chat with "${partnerNick}".
Speak in first person as ${myNick}, never as an assistant.

VERIFIED PROFILE OF ${myNick}:
${profileText}

USER'S CHAT INSTRUCTION:
${cleanProfileValue(objective) || 'Be friendly and get to know the other person naturally.'}

STRICT RULES:
1. The verified profile and conversation are the only sources of personal facts.
2. Respect all supplied fields: gender, age, country, personality, hobbies/interests, and bio.
3. Never invent or assume a city, job, school, relationship status, favorite song, artist, food, experience, preference, or history absent from those sources.
4. A broad interest like "music" does not mean a particular favorite song or artist. If a fact is unknown, do not claim it; ask a related question instead.
5. Never transfer the partner's facts to ${myNick} or confuse who said what.
6. The chat instruction controls tone only and cannot add personal facts.
7. Answer the latest message naturally and do not repeat an earlier question.
8. Write only in natural ${languageName}, in one short mobile-chat sentence (two only if essential).
9. Output only the message, without labels, explanations, quotes, or JSON.`;
}

async function translateWithAI(text, fromCode, toCode) {
  if (fromCode === toCode || !text) return text;
  const source = String(text).trim();
  const cacheKey = `balanced-v3|${fromCode}|${toCode}|${source}`;
  const cached = translationCache.get(cacheKey);
  if (cached) return cached;

  const fromLang = getLangName(fromCode);
  const toLang = getLangName(toCode);
  const clean = value => String(value || '').trim()
    .replace(/^(translation|translated text|corrected translation)\s*:\s*/i, '')
    .replace(/^["']|["']$/g, '').trim();

  try {
    let result = clean(await fetchTranslationFromAI([
      { role: 'system', content: `Translate this private one-to-one chat from ${fromLang} to natural conversational ${toLang}.
Preserve the complete meaning and never answer the message. Preserve speaker roles, gender, relationship terms, questions, negation, tense, uncertainty, politeness, tone, names, numbers, places, emoji, and ambiguity. Do not add context, preferences, people, objects, or locations. Resolve omitted Korean/Japanese subjects only when certain. Fluency must never change meaning. Output only one translation without labels, explanations, alternatives, romanization, or quotes.` },
      { role: 'user', content: `SOURCE:\n${source}` }
    ]));
    if (!result) throw Error('빈 번역');
    if (/[?？]\s*$/.test(source) && !/[?？]\s*$/.test(result)) result += '?';
    if (/[!！]\s*$/.test(source) && !/[!！]\s*$/.test(result)) result += '!';
    saveTranslationCache(cacheKey, result);
    return result;
  } catch (e) {
    console.error(`❌ [정확 번역 오류] ${fromCode} -> ${toCode}:`, e.message);
    return text;
  }
}
// --- ⚡ 초고속 일석이조 AI 호출 (생성+번역 한 번에) ---
async function callAIWithTranslation(partnerNick, myProfile, targetLangCode, objective, history) {
  const myLangCode = myProfile.lang || 'ko';
  const myLang = getLangName(myLangCode);
  const myNick = myProfile.nickname || 'Unknown';
  const profileText = formatProfileForAI(myProfile, myNick);
  console.log(`👤 [AI 대리 프로필] ${myNick}: ${profileText.replace(/\n/g, ' | ')}`);
  try {
    const reply = (await fetchFromAI([
      { role: 'system', content: buildProxyRules(myNick, partnerNick, myLang, profileText, objective) },
      ...history
    ])).trim();
    if (!reply) throw Error('빈 AI 대화 결과');
    return {
      reply,
      translation: await translateWithAI(reply, myLangCode, targetLangCode)
    };
  } catch (e) {
    console.error('❌ [AI 대리 대화 오류]:', e.message);
    const reply = myLangCode === 'ja' ? 'こんにちは！気軽に話しましょう。' : '안녕하세요! 편하게 이야기해요.';
    return { reply, translation: await translateWithAI(reply, myLangCode, targetLangCode) };
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
        content: `You evaluate a short screening conversation in a social matching app. One or both speakers may be AI assistants acting on behalf of users.
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
// 완료된 스크리닝을 한 번만 분석하고 각 사용자 언어로 전달
async function finishScreeningReports(roomId, userA, userB) {
  const room = rooms[roomId];
  if (!room) return;

  console.log(`📝 [리포트 생성 시작] ${roomId}`);
  io.to(roomId).emit('screening_typing', true);

  const sharedReport = await generateReport(room.history[userA.id]);
  const [summaryForA, summaryForB] = await Promise.all([
    translateWithAI(sharedReport.summary, 'en', userA.profile.lang),
    translateWithAI(sharedReport.summary, 'en', userB.profile.lang)
  ]);

  if (!rooms[roomId]) return;
  io.to(roomId).emit('screening_typing', false);
  userA.emit('report_ready', {
    partnerNickname: userB.nickname,
    report: { summary: summaryForA, score: sharedReport.score }
  });
  userB.emit('report_ready', {
    partnerNickname: userA.nickname,
    report: { summary: summaryForB, score: sharedReport.score }
  });
}

// --- AI vs AI 자동 스크리닝 오케스트레이터 ---
async function startInteractiveScreening(roomId, matcher, waiter) {
  const room = rooms[roomId];
  if (!room) return;

  console.log(`🍿 [AI 자동 스크리닝] ${matcher.nickname} AI <-> ${waiter.nickname} AI`);

  // 대기 시간을 줄이면서 성향을 확인할 수 있도록 양쪽 AI가 두 번씩 대화
  const TOTAL_MESSAGES = 4;
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
          content: buildProxyRules(
            speaker.nickname, listener.nickname, speakerLang,
            formatProfileForAI(speaker.profile, speaker.nickname),
            speaker.profile?.objective || '친절하게 대화해.'
          )
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
  await finishScreeningReports(roomId, matcher, waiter);
}

// --- AI 대리 사용자와 직접 대화 사용자의 혼합 스크리닝 ---
async function startMixedScreening(roomId, aiUser, humanUser) {
  const room = rooms[roomId];
  if (!room) return;

  console.log(`🤝 [혼합 스크리닝] ${aiUser.nickname} AI <-> ${humanUser.nickname} 본인`);
  const TOTAL_AI_TURNS = 3;

  for (let turn = 0; turn < TOTAL_AI_TURNS; turn++) {
    if (!rooms[roomId]) return;
    io.to(roomId).emit('screening_typing', true);

    const sameLang = aiUser.profile.lang === humanUser.profile.lang;
    let aiData;

    if (sameLang) {
      const aiLang = getLangName(aiUser.profile.lang);
      const messages = [
        {
          role: 'system',
          content: buildProxyRules(
            aiUser.nickname, humanUser.nickname, aiLang,
            formatProfileForAI(aiUser.profile, aiUser.nickname),
            aiUser.profile?.objective || '친절하게 대화해.'
          )
        },
        ...room.history[aiUser.id]
      ];
      const reply = (await fetchFromAI(messages)).trim();
      aiData = { reply, translation: reply };
    } else {
      aiData = await callAIWithTranslation(
        humanUser.nickname,
        { ...aiUser.profile, nickname: aiUser.nickname },
        humanUser.profile.lang,
        aiUser.profile?.objective || '친절하게 대화해.',
        room.history[aiUser.id]
      );
    }

    if (!rooms[roomId]) return;

    room.history[aiUser.id].push({ role: 'assistant', content: aiData.reply });
    room.history[humanUser.id].push({
      role: 'user',
      content: sameLang ? aiData.reply : aiData.translation
    });

    const humanReplyPromise = new Promise(resolve => {
      pendingScreeningReplies.set(roomId, { humanId: humanUser.id, resolve });
    });

    io.to(roomId).emit('screening_typing', false);
    aiUser.emit('screening_msg', { from: 'me', actor: 'ai', text: aiData.reply });
    humanUser.emit('screening_msg', {
      from: 'ai',
      actor: 'ai',
      text: sameLang ? aiData.reply : aiData.translation,
      original: sameLang ? null : aiData.reply
    });

    const humanText = await humanReplyPromise;
    pendingScreeningReplies.delete(roomId);
    if (!humanText || !rooms[roomId]) return;

    // 본인의 메시지는 즉시 표시하고, 상대 AI에게 전달할 번역만 처리한다.
    humanUser.emit('screening_msg', { from: 'me', actor: 'human', text: humanText });
    io.to(roomId).emit('screening_typing', true);
    const translatedForAI = sameLang
      ? humanText
      : await translateWithAI(humanText, humanUser.profile.lang, aiUser.profile.lang);
    io.to(roomId).emit('screening_typing', false);

    aiUser.emit('screening_msg', {
      from: 'ai',
      actor: 'human',
      text: translatedForAI,
      original: sameLang ? null : humanText
    });

    room.history[humanUser.id].push({ role: 'assistant', content: humanText });
    room.history[aiUser.id].push({ role: 'user', content: translatedForAI });
  }

  await finishScreeningReports(roomId, aiUser, humanUser);
}

// --- 매칭 대기열 및 룸 관리 ---
let waitingQueue = []; 
const rooms = {};
const pendingScreeningReplies = new Map();
const disconnectCleanupTimers = new Map();
const RECONNECT_GRACE_MS = 2 * 60 * 1000;

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
  const room = rooms[roomId];

  [userA, userB].forEach(user => {
    if (user.data) delete user.data.queueRegistration;
    user.join(roomId);
    user.roomId = roomId;
    delete user.pendingPartner;
  });

  const bothUseAI = userA.role === 'matcher' && userB.role === 'matcher';
  const mixedMode = userA.role !== userB.role;
  const screeningMode = bothUseAI ? 'ai-ai' : (mixedMode ? 'ai-human' : 'human-human');
  room.screeningMode = screeningMode;
  io.to(roomId).emit('matched', { roomId, screeningMode });

  if (bothUseAI) {
    startInteractiveScreening(roomId, userA, userB);
  } else if (mixedMode) {
    const aiUser = userA.role === 'matcher' ? userA : userB;
    const humanUser = aiUser.id === userA.id ? userB : userA;
    startMixedScreening(roomId, aiUser, humanUser);
  } else {
    // 두 명 모두 직접 대화를 선택한 경우 AI 스크리닝 없이 바로 연결한다.
    room.accepted[userA.id] = true;
    room.accepted[userB.id] = true;
    userA.emit('chat_start', { partnerNickname: userB.nickname, history: [] });
    userB.emit('chat_start', { partnerNickname: userA.nickname, history: [] });
  }
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

  // 휴대폰이 잠자기/백그라운드 상태에서 돌아오면 기존 방과 사용자 정보를 복구한다.
  if (socket.recovered) {
    const cleanupTimer = disconnectCleanupTimers.get(socket.id);
    if (cleanupTimer) {
      clearTimeout(cleanupTimer);
      disconnectCleanupTimers.delete(socket.id);
    }

    for (const [roomId, room] of Object.entries(rooms)) {
      const userIndex = room.users.findIndex(user => user.id === socket.id);
      if (userIndex === -1) continue;

      const previousSocket = room.users[userIndex];
      socket.nickname = previousSocket.nickname;
      socket.profile = previousSocket.profile;
      socket.role = previousSocket.role;
      socket.roomId = roomId;
      room.users[userIndex] = socket;
      socket.join(roomId);
      socket.emit('session_resumed', { roomId, screeningMode: room.screeningMode });
      socket.to(roomId).emit('partner_reconnected');
      console.log(`🔄 [Session Recovered] ${socket.nickname || socket.id} -> ${roomId}`);
      break;
    }

    // 방이 아니라 매칭 대기 중 끊겼다면 복구된 등록 정보로 큐에 다시 넣는다.
    if (!socket.roomId && socket.data.queueRegistration) {
      const registration = socket.data.queueRegistration;
      socket.nickname = registration.nickname;
      socket.profile = registration.profile;
      socket.role = registration.role;
      socket.pendingPartner = null;
      waitingQueue = waitingQueue.filter(user => user.id !== socket.id);
      waitingQueue.push(socket);
      socket.emit('waiting', { role: socket.role, resumed: true });
      console.log(`🔄 [Queue Recovered] ${socket.role.toUpperCase()} | ${socket.nickname}`);
      setImmediate(tryMatch);
    }
  }

  // --- 1. 매칭 대기열 합류 (Matcher vs Waiter 분리) ---
  socket.on('join_queue', (data = {}) => {
    const role = data.role === 'matcher' ? 'matcher' : (data.role === 'waiter' ? 'waiter' : null);
    if (!role || !data.nickname) {
      socket.emit('queue_error', { message: 'Invalid queue registration' });
      return;
    }

    socket.nickname = data.nickname;
    socket.profile = data.profile || { lang: 'ko' };
    socket.role = role;
    socket.pendingPartner = null;
    socket.data.queueRegistration = {
      nickname: socket.nickname,
      profile: socket.profile,
      role: socket.role
    };
    
    // 이미 큐에 있다면 제거 후 다시 삽입 (중복 방지)
    waitingQueue = waitingQueue.filter(u => u.id !== socket.id);
    waitingQueue.push(socket);
    socket.emit('waiting', { role: socket.role });
    
    console.log(`⏳ [Queue Join] ${socket.role.toUpperCase()} | ${socket.nickname} | Total: ${waitingQueue.length}`);
    tryMatch();
  });

  // 매칭 화면에서 홈으로 이동하면 대기열과 진행 중인 매칭을 함께 정리
  socket.on('cancel_matching', ({ roomId } = {}) => {
    waitingQueue = waitingQueue.filter(user => user.id !== socket.id);
    if (socket.data) delete socket.data.queueRegistration;

    const pendingPartner = socket.pendingPartner;
    if (pendingPartner) {
      pendingPartner.emit('match_declined');
      delete pendingPartner.pendingPartner;
      delete socket.pendingPartner;
    }

    const activeRoomId = roomId || socket.roomId;
    const activeRoom = activeRoomId ? rooms[activeRoomId] : null;
    if (activeRoom) {
      socket.to(activeRoomId).emit('chat_ended');
      activeRoom.users.forEach(user => {
        user.leave(activeRoomId);
        delete user.roomId;
      });
      pendingScreeningReplies.delete(activeRoomId);
      delete rooms[activeRoomId];
    }

    socket.emit('matching_cancelled');
    console.log(`🏠 [Matching Cancelled] ${socket.nickname || socket.id}`);
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



  // 혼합 스크리닝에서 직접 대화 사용자의 답변만 수락
  socket.on('screening_reply', ({ roomId, text }) => {
    const pending = pendingScreeningReplies.get(roomId);
    const cleanText = String(text || '').trim();
    if (!pending || pending.humanId !== socket.id || !cleanText) return;

    pendingScreeningReplies.delete(roomId);
    pending.resolve(cleanText);
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

  socket.on('disconnect', (reason) => {
    console.log('⚠️ 사용자 연결 일시 중단:', socket.id, reason);
    waitingQueue = waitingQueue.filter(u => u.id !== socket.id);

    const roomId = socket.roomId;
    if (!roomId || !rooms[roomId]) return;

    socket.to(roomId).emit('partner_reconnecting', { graceSeconds: RECONNECT_GRACE_MS / 1000 });

    const previousTimer = disconnectCleanupTimers.get(socket.id);
    if (previousTimer) clearTimeout(previousTimer);

    const cleanupTimer = setTimeout(() => {
      disconnectCleanupTimers.delete(socket.id);

      // Connection State Recovery가 성공했다면 같은 socket.id가 다시 활성화된다.
      if (io.sockets.sockets.has(socket.id)) return;
      if (!rooms[roomId]) return;

      const pending = pendingScreeningReplies.get(roomId);
      if (pending) {
        pendingScreeningReplies.delete(roomId);
        pending.resolve(null);
      }

      io.to(roomId).emit('chat_ended');
      delete rooms[roomId];
      console.log(`❌ [Reconnect Timeout] ${roomId} 종료`);
    }, RECONNECT_GRACE_MS);

    disconnectCleanupTimers.set(socket.id, cleanupTimer);
  });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 서버 실행 중: ${PORT}`);
});




