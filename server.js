require('dotenv').config();
const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const path = require('path');

const app = express();
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', model: 'claude-sonnet-4-6' });
});

// ── 채팅 ─────────────────────────────────────────────────
app.post('/api/chat', async (req, res) => {
  const { messages, pdfContext } = req.body;

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: '메시지가 필요합니다.' });
  }

  const validMessages = messages.filter(
    m => m && typeof m.role === 'string' && typeof m.content === 'string'
  );

  if (validMessages.length === 0) {
    return res.status(400).json({ error: '올바른 메시지 형식이 아닙니다.' });
  }

  const baseSystem =
    '당신은 친절하고 유능한 AI 어시스턴트입니다. ' +
    '사용자가 사용하는 언어로 자연스럽게 답변해 주세요. ' +
    '코드를 작성할 때는 마크다운 코드 블록을 사용하고, ' +
    '필요시 목록이나 제목 등 마크다운 서식을 활용해 가독성 좋게 답변해 주세요.';

  // PDF 컨텍스트가 있으면 시스템 프롬프트에 추가
  const systemPrompt = pdfContext
    ? `${baseSystem}\n\n아래는 사용자가 업로드한 PDF 문서의 내용입니다. 사용자의 질문에 답할 때 이 내용을 참고하세요.\n\n---\n${pdfContext}\n---`
    : baseSystem;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const sendEvent = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  try {
    const stream = client.messages.stream({
      model: 'claude-sonnet-4-6',
      max_tokens: 8096,
      system: systemPrompt,
      messages: validMessages,
    });

    stream.on('text', (text) => {
      sendEvent({ type: 'text', content: text });
    });

    stream.on('message', () => {
      sendEvent({ type: 'done' });
      res.end();
    });

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
  console.log(`\n🚀 AI 챗봇 서버 시작: http://localhost:${PORT}\n`);
});
