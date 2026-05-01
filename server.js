// server.js의 callAI 함수 부분 수정
async function callAI(text, partnerNick, myNick, history, userLang, userCountry) {
  try {
    const url = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/ai/run/${CF_MODEL}`;
    
    const systemPrompt = `
      - 너의 이름은 '${partnerNick}'이고, 상대방은 '${myNick}'이야.
      - 너는 ${userCountry}에 사는 사람이야.
      - 반드시 '${userLang}' 언어로만 대답해.
      - 절대로 너가 AI임을 밝히지 마. 20대 한국인 혹은 현지인처럼 아주 자연스럽게 대화해.
      - 짧고 친근하게 대답하고 질문을 던져.
    `;

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${CF_API_TOKEN}` },
      body: JSON.stringify({
        messages: [
          { role: 'system', content: systemPrompt },
          ...history,
          { role: 'user', content: text }
        ]
      })
    });
    const data = await res.json();
    return data.result.response;
  } catch (e) {
    return "Connection error.";
  }
}

// socket.on('join_queue', ...) 부분에서 lang과 country를 받도록 수정
socket.on('join_queue', ({ nickname, profile }) => {
    socket.nickname = nickname;
    socket.lang = profile.lang || 'en';
    socket.country = profile.country || 'US';
    // ... 이하 매칭 로직 ...
});
