# AI 채팅 🤖

Google Gemini API를 활용한 AI 챗봇 웹 애플리케이션입니다.

## 기능

- ✦ **실시간 스트리밍** - AI 응답을 타이핑하듯 실시간으로 표시
- 📝 **마크다운 렌더링** - 코드 블록, 리스트, 표 등 완전 지원
- 💾 **대화 기록 저장** - 브라우저 localStorage에 자동 저장
- 🔄 **다중 대화** - 여러 대화를 생성하고 전환 가능
- 📱 **반응형 디자인** - 모바일, 태블릿, 데스크탑 지원
- 🔐 **로그인 불필요** - 별도 인증 없이 바로 사용

## 실행 방법

### 1. 패키지 설치

```bash
npm install
```

### 2. 환경 변수 설정

```bash
cp .env.example .env
```

`.env` 파일을 열고 `GEMINI_API_KEY`에 실제 API 키를 입력하세요.

API 키는 [Google AI Studio](https://aistudio.google.com/app/apikey)에서 무료로 발급받을 수 있습니다.

```env
GEMINI_API_KEY=AIzaSy...
PORT=3000
```

### 3. 서버 실행

```bash
# 프로덕션
npm start

# 개발 (자동 재시작)
npm run dev
```

### 4. 브라우저에서 접속

```
http://localhost:3000
```

## 프로젝트 구조

```
ai-chatbot/
├── server.js          # Express 백엔드 (SSE 스트리밍)
├── package.json
├── .env               # API 키 (git에서 제외됨)
├── .env.example       # 환경 변수 템플릿
└── public/
    ├── index.html     # 채팅 UI
    ├── style.css      # 스타일
    └── app.js         # 프론트엔드 로직
```

## 기술 스택

- **백엔드**: Node.js + Express
- **AI**: Google Gemini API (`gemini-2.0-flash`)
- **스트리밍**: Server-Sent Events (SSE)
- **프론트엔드**: Vanilla HTML/CSS/JS
- **마크다운**: marked.js
- **코드 하이라이팅**: highlight.js
