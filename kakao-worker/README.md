# 카카오맵 리뷰 워커 (Playwright)

카카오 패널 API(`place-api.map.kakao.com/places/panel3/{id}`)는 리뷰를 **~7개만**
돌려줍니다. 100개 이상을 모으려면 실제 브라우저로 장소 페이지를 열어 후기 탭을
스크롤하며 리뷰 응답을 가로채야 합니다. 이 **별도 워커**가 그 일을 합니다.

```
Vercel(리뷰 사이트) ──POST /collect {placeId}──▶ 이 워커(Playwright) ──▶ 카카오
```

## ✅ 네이버와 다른 점 — 데이터센터 IP 차단 없음
네이버와 달리 **카카오는 데이터센터 IP(Render/Railway 등)를 막지 않습니다.**
따라서 이 워커는 클라우드 무료 플랜에서 **그대로 안정적으로 동작**합니다.
(네이버 워커처럼 집 PC/한국 IP가 필요 없습니다.)

## API
- `GET  /health` → `{ ok: true }`
- `POST /collect` body `{ "placeId": "12345" }` → `{ placeId, reviews }`
  - `placeId` 대신 `{ "query": "가게명" }` 를 보내려면 워커에 `KAKAO_REST_API_KEY`
    환경변수가 있어야 합니다(질의→placeId 변환용). Vercel 앱은 이미 placeId 를
    넘겨주므로 보통은 필요 없습니다.
  - `WORKER_TOKEN` 이 설정돼 있으면 요청 헤더 `x-worker-token` 필요

리뷰 항목 형태:
```json
{ "reviewId": "…", "author": "…", "rating": 4.5, "text": "…",
  "createdAt": "2024-03-15", "likeCount": 3 }
```

## 로컬 실행
```bash
cd kakao-worker
npm install
npx playwright install --with-deps chromium   # 최초 1회
WORKER_TOKEN=devsecret npm start               # http://localhost:3000
curl -XPOST localhost:3000/collect -H 'content-type: application/json' \
  -H 'x-worker-token: devsecret' -d '{"placeId":"8137464"}'
```

## 배포 — Render (Docker, 가장 쉬움)
이 저장소는 `kakao-worker/Dockerfile` 을 포함합니다.

1. 새 Web Service 생성(직접 링크): https://dashboard.render.com/select-repo?type=web
2. 저장소 `urmyfrenz-a11y/my_project` 선택
3. 설정:
   - **Root Directory**: `kakao-worker`
   - **Runtime/Environment**: `Docker` (Dockerfile 자동 감지)
   - **Instance Type**: Free 로 시작 가능
4. **Environment** 에 변수 추가:
   - `WORKER_TOKEN` = 임의의 긴 비밀문자열 (예: 32자 랜덤)
   - (선택) `KAKAO_MAX_REVIEWS` = `120`
5. Create → 배포되면 URL 확인 (예: `https://kakao-review-worker.onrender.com`)
6. 확인: 브라우저로 `그URL/health` → `{ "ok": true }`

> Render 무료 플랜은 유휴 시 슬립됩니다(첫 요청이 느릴 수 있음). 상시 필요하면
> 유료 인스턴스나 Railway를 쓰세요. Railway 새 프로젝트: https://railway.app/new
> (Railway도 Root Directory=`kakao-worker`, Dockerfile 자동 사용)

## Vercel(리뷰 사이트)에 연결
워커 URL/토큰을 Vercel 프로젝트 환경변수에 넣습니다(직접 링크):
https://vercel.com/hichul-kim-s-projects/map-review/settings/environment-variables

- `KAKAO_WORKER_URL` = 워커 주소 (예: `https://kakao-review-worker.onrender.com`)
- `KAKAO_WORKER_TOKEN` = 위에서 정한 `WORKER_TOKEN` 과 동일 값

넣고 재배포하면 카카오맵 리뷰가 **100개 이상**까지 수집됩니다.
(`KAKAO_WORKER_URL` 이 없으면 패널 API 기준 **~7개**로 자동 대체됩니다.)
