# 서울 상권분석 (Seoul Sangkwon)

서울 지도에서 위치를 선택하거나 주소를 검색하면 9개 팩터로 상권을 분석해
한 장의 인포그래픽과 종합 상권 점수로 도출하는 웹 서비스입니다.

## 기술 스택
- Next.js 16 (App Router) + React 19 + Tailwind CSS 4
- 카카오맵 JavaScript SDK (지도), 카카오 로컬 REST API (주소검색·POI)
- 서울 열린데이터광장 상권분석서비스 API
- 공공데이터포털 (소상공인 상가정보, 지하철정보)

## 환경변수
`.env.example` 을 `.env.local` 로 복사해 채우세요. 자세한 키 발급법은 `docs/API_KEYS.md`.

| 변수 | 용도 |
|---|---|
| `NEXT_PUBLIC_KAKAO_JS_KEY` | 지도 표시 (클라이언트) |
| `KAKAO_REST_KEY` | 주소검색·POI (서버) |
| `SEOUL_OPENAPI_KEY` | 서울 상권분석서비스 (서버) |
| `DATA_GO_KR_KEY` | 상가·지하철 (서버) |

## 로컬 실행
```bash
npm install
cp .env.example .env.local   # 키 채우기
npm run dev                  # http://localhost:3000
```

키가 없어도 좌표 기반 데모 데이터로 전체 흐름이 동작하며, 키를 넣으면 실데이터로 전환됩니다.

<!-- deploy: production branch activated -->
