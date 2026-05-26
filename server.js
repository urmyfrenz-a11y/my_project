require('dotenv').config();
const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const path = require('path');

const app = express();
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    model: 'claude-sonnet-4-6',
    searchEnabled: !!process.env.BRAVE_API_KEY,
  });
});

// ── 웹 검색 (Brave Search API) ────────────────────────────
async function searchWeb(query) {
  const key = process.env.BRAVE_API_KEY;
  if (!key) throw new Error('BRAVE_API_KEY가 설정되지 않았습니다.');

  const url = new URL('https://api.search.brave.com/res/v1/web/search');
  url.searchParams.set('q', query);
  url.searchParams.set('count', '5');
  url.searchParams.set('country', 'KR');
  url.searchParams.set('search_lang', 'ko');
  url.searchParams.set('text_decorations', '0');

  const res = await fetch(url.toString(), {
    headers: {
      'Accept': 'application/json',
      'Accept-Encoding': 'gzip',
      'X-Subscription-Token': key,
    },
  });

  if (!res.ok) throw new Error(`Brave Search API 오류: ${res.status}`);
  return res.json();
}

function formatSearchResults(data) {
  const parts = [];

  // 뉴스 결과
  if (data.news?.results?.length > 0) {
    const news = data.news.results.slice(0, 2);
    news.forEach((r, i) => {
      parts.push(`[뉴스 ${i + 1}] ${r.title}\n${r.description || ''}\n출처: ${r.url}`);
    });
  }

  // 일반 웹 결과 (상위 5개)
  if (data.web?.results?.length > 0) {
    data.web.results.slice(0, 5).forEach((r, i) => {
      parts.push(`[결과 ${i + 1}] ${r.title}\n${r.description || ''}\n출처: ${r.url}`);
    });
  }

  return parts.join('\n\n');
}

// ── 채팅 ─────────────────────────────────────────────────
app.post('/api/chat', async (req, res) => {
  const { messages, pdfContext, useSearch } = req.body;

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: '메시지가 필요합니다.' });
  }

  const validMessages = messages.filter(
    m => m && typeof m.role === 'string' && typeof m.content === 'string'
  );

  if (validMessages.length === 0) {
    return res.status(400).json({ error: '올바른 메시지 형식이 아닙니다.' });
  }

  // ── 구글 검색 실행 ──────────────────────────────────────
  let searchContext = '';
  if (useSearch) {
    try {
      const query = validMessages[validMessages.length - 1].content;
      const data  = await searchWeb(query);
      searchContext = formatSearchResults(data);
      console.log(`[Search] "${query}" → ${data.web?.results?.length || 0}개 결과`);
    } catch (err) {
      console.error('[Search Error]', err.message);
      // 검색 실패 시 일반 답변으로 폴백 (오류 중단 없음)
      searchContext = '';
    }
  }

  // ── 시스템 프롬프트 조합 ────────────────────────────────
  let systemPrompt =
    '당신은 친절하고 유능한 AI 어시스턴트입니다. ' +
    '사용자가 사용하는 언어로 자연스럽게 답변해 주세요. ' +
    '코드를 작성할 때는 마크다운 코드 블록을 사용하고, ' +
    '필요시 목록이나 제목 등 마크다운 서식을 활용해 가독성 좋게 답변해 주세요.';

  if (pdfContext) {
    systemPrompt +=
      '\n\n아래는 사용자가 업로드한 PDF 문서의 내용입니다. 질문에 답할 때 참고하세요.' +
      `\n\n---\n${pdfContext}\n---`;
  }

  if (searchContext) {
    systemPrompt +=
      '\n\n아래는 방금 구글에서 검색한 최신 결과입니다. 이 정보를 바탕으로 답변하고, ' +
      '답변 마지막에 참고한 출처 링크를 1~3개 정도 알려주세요.' +
      `\n\n---\n${searchContext}\n---`;
  }

  // ── SSE 스트리밍 응답 ───────────────────────────────────
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const sendEvent = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  // 검색 결과가 있으면 프론트에 알림 (검색 중 표시 해제용)
  if (searchContext) {
    sendEvent({ type: 'search_done' });
  }

  try {
    const stream = client.messages.stream({
      model: 'claude-sonnet-4-6',
      max_tokens: 8096,
      system: systemPrompt,
      messages: validMessages,
    });

    stream.on('text', (text) => sendEvent({ type: 'text', content: text }));
    stream.on('message', () => { sendEvent({ type: 'done' }); res.end(); });
    stream.on('error', (error) => {
      console.error('[Stream Error]', error.message);
      sendEvent({ type: 'error', message: '스트리밍 오류가 발생했습니다.' });
      res.end();
    });

  } catch (error) {
    console.error('[API Error]', error.message);
    if (!res.headersSent) {
      return res.status(500).json({ error: 'AI 서비스에 연결할 수 없습니다.' });
    }
    sendEvent({ type: 'error', message: error.message || '오류가 발생했습니다.' });
    res.end();
  }
});

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n🚀 AI 챗봇 서버 시작: http://localhost:${PORT}`);
  console.log(`🔍 웹 검색: ${process.env.BRAVE_API_KEY ? '활성화 (Brave Search)' : '비활성화 (BRAVE_API_KEY 없음)'}\n`);
});
