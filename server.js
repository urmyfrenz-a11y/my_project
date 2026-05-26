require('dotenv').config();
const express = require('express');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const path = require('path');

const app = express();
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const SYSTEM_PROMPT =
  '당신은 친절하고 유능한 AI 어시스턴트입니다. ' +
  '사용자가 사용하는 언어로 자연스럽게 답변해 주세요. ' +
  '코드를 작성할 때는 마크다운 코드 블록을 사용하고, ' +
  '필요시 목록이나 제목 등 마크다운 서식을 활용해 가독성 좋게 답변해 주세요.';

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', model: 'gemini-1.5-flash' });
});

app.post('/api/chat', async (req, res) => {
  const { messages } = req.body;

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: '메시지가 필요합니다.' });
  }

  const validMessages = messages.filter(
    m => m && typeof m.role === 'string' && typeof m.content === 'string'
  );

  if (validMessages.length === 0) {
    return res.status(400).json({ error: '올바른 메시지 형식이 아닙니다.' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const sendEvent = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  try {
    // systemInstruction 대신 대화 첫 턴에 시스템 컨텍스트 삽입
    const history = [
      { role: 'user',  parts: [{ text: `[지시] ${SYSTEM_PROMPT}` }] },
      { role: 'model', parts: [{ text: '네, 이해했습니다. 도움을 드리겠습니다.' }] },
      ...validMessages.slice(0, -1).map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      })),
    ];

    const lastMessage = validMessages[validMessages.length - 1];

    const model = genAI.getGenerativeModel(
      { model: 'gemini-1.5-flash' },
      { apiVersion: 'v1' }
    );

    const chat = model.startChat({ history });
    const result = await chat.sendMessageStream(lastMessage.content);

    for await (const chunk of result.stream) {
      const text = chunk.text();
      if (text) sendEvent({ type: 'text', content: text });
    }

    sendEvent({ type: 'done' });
    res.end();

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
