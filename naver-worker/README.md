# 네이버 리뷰 워커 (Playwright)

Vercel 서버리스는 브라우저(Playwright)를 못 돌리므로, 네이버 리뷰 수집은
이 **별도 워커**가 담당합니다. 워커가 헤드리스 브라우저로 네이버를 긁고,
Vercel 앱은 이 워커를 HTTP로 호출만 합니다.

```
Vercel(리뷰 사이트)  ──POST /collect {query}──▶  이 워커(Playwright) ──▶ 네이버
```

## ⚠️ 중요 — 반드시 "한국 가정용(residential) IP"에서 실행할 것
네이버는 **데이터센터 IP(AWS/Render 등)를 봇으로 감지해 CAPTCHA로 차단**합니다
(응답에 `ncaptcha` / `place: null`). 즉 이 워커를 클라우드(Render 등)에 올리면
네이버가 데이터를 주지 않습니다. **한국 가정/사무실 IP를 가진 머신**(집 PC,
전용 서버 등)에서 실행해야 정상 동작합니다.

권장 구성: 전용 PC에서 이 워커 실행 → 무료 터널(Cloudflare Tunnel:
`cloudflared tunnel --url http://localhost:3000`)로 외부 주소 생성 →
그 주소를 Vercel `NAVER_WORKER_URL` 에 연결. (카카오는 Vercel에서 상시
동작하므로 워커가 꺼져 있어도 무관 — 네이버만 워커에 의존.)

## API
- `GET  /health` → `{ ok: true }`
- `POST /collect` body `{ "query": "가게 이름" }` → `{ place, reviews }`
  - `WORKER_TOKEN` 이 설정돼 있으면 요청 헤더 `x-worker-token` 필요

## 로컬 실행
```bash
cd naver-worker
npm install
npx playwright install --with-deps chromium   # 최초 1회
WORKER_TOKEN=devsecret npm start               # http://localhost:3000
curl -XPOST localhost:3000/collect -H 'content-type: application/json' \
  -H 'x-worker-token: devsecret' -d '{"query":"커피에반하다 광교호수공원점"}'
```

## 배포 — Render (Docker, 가장 쉬움)
이 저장소는 `naver-worker/Dockerfile` 을 포함합니다.

1. 새 Web Service 생성(직접 링크): https://dashboard.render.com/select-repo?type=web
2. 저장소 `urmyfrenz-a11y/my_project` 선택
3. 설정:
   - **Root Directory**: `naver-worker`
   - **Runtime/Environment**: `Docker` (Dockerfile 자동 감지)
   - **Instance Type**: Free 로 시작 가능
4. **Environment** 에 변수 추가:
   - `WORKER_TOKEN` = 임의의 긴 비밀문자열 (예: 32자 랜덤)
   - (선택) `NAVER_MAX_REVIEWS` = `40`
5. Create → 배포되면 URL 확인 (예: `https://naver-review-worker.onrender.com`)
6. 확인: 브라우저로 `그URL/health` → `{ "ok": true }`

> Render 무료 플랜은 유휴 시 슬립됩니다(첫 요청이 느릴 수 있음). 상시 필요하면
> 유료 인스턴스나 Railway를 쓰세요. Railway 새 프로젝트: https://railway.app/new
> (Railway도 Root Directory=`naver-worker`, Dockerfile 자동 사용)

## Vercel(리뷰 사이트)에 연결
워커 URL/토큰을 Vercel 프로젝트 환경변수에 넣습니다(직접 링크):
https://vercel.com/hichul-kim-s-projects/map-review/settings/environment-variables

- `NAVER_WORKER_URL` = 워커 주소 (예: `https://naver-review-worker.onrender.com`)
- `NAVER_WORKER_TOKEN` = 위에서 정한 `WORKER_TOKEN` 과 동일 값

넣고 재배포하면, 리뷰 사이트에서 **네이버 플레이스**도 실제 리뷰가 수집됩니다.
(`NAVER_WORKER_URL` 이 없으면 네이버는 "준비중"으로 표시됩니다.)
