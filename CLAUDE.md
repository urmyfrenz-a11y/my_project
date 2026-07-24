# 작업 지침 (사용자 선호)

## 웹 콘솔 안내 시 — 반드시 직접 URL 제공
Vercel, Google Cloud, Kakao Developers 등 웹 콘솔 작업을 안내할 때는
**"○○ 탭 → ⋯ → 메뉴" 같은 클릭 경로로 설명하지 말고, 바로 이동 가능한
정확한 URL을 제공**한다. 사용자가 링크를 클릭하면 해당 화면으로 바로 가야 한다.

## 이 저장소의 배포 구성 (참고)
저장소 `urmyfrenz-a11y/my_project` 는 여러 앱을 담는다.
- 루트(`app/`) = **pdfdoctor** (PDF 편집기). Vercel 프로젝트: `pdfdoctor`.
- `review-scraper/` = **장소 리뷰 수집기**(구글/카카오/네이버). Vercel 프로젝트
  `map-review` (Root Directory = `review-scraper`), 프로덕션 도메인
  **https://mapreview.vercel.app**.
  - 팀 slug: `hichul-kim-s-projects`, 프로젝트 slug: `map-review`.
  - 환경변수: `KAKAO_REST_API_KEY`(작동중), `GOOGLE_MAPS_API_KEY`(결제 필요),
    `NAVER_WORKER_URL` / `NAVER_WORKER_TOKEN`(네이버 워커 연결용).
  - 카카오 리뷰는 `place-api.map.kakao.com/places/panel3/{id}` 를 `pf: web`
    헤더로 호출해 `kakaomap_review.reviews` 를 파싱한다.
- `naver-worker/` = **네이버 리뷰 Playwright 워커**. Vercel 서버리스는 브라우저를
  못 돌리므로 별도(Render/Railway) 배포. `review-scraper` 는 `NAVER_WORKER_URL`
  로 이 워커를 HTTP 호출한다.
- `kakao-worker/` = **카카오 리뷰 Playwright 워커 (폐기/미사용)**. Render에 배포는
  돼 있으나 `review-scraper` 는 더 이상 호출하지 않는다. 이유: 카카오 place 페이지는
  리뷰 XHR/내장데이터가 없고, 지도앱 UI는 무료 인프라에서 무겁고 불안정하며,
  카카오의 많은 리뷰는 대부분 **네이버 검색과 중복되는 외부 블로그 링크**라 실익이
  적음. **카카오는 panel3(별점+블로그, ~7개)만 사용.** (Vercel의 KAKAO_WORKER_URL/
  KAKAO_WORKER_TOKEN 환경변수와 Render kakao-worker 서비스는 지워도 됨 — 선택.)

## '인터넷 검색' = 네이버 검색 오픈API
`review-scraper` 의 "네이버 검색" 소스는 네이버 검색 오픈API(무료 25,000건/일,
과금 없음)를 쓴다. 환경변수 `NAVER_SEARCH_CLIENT_ID`/`NAVER_SEARCH_CLIENT_SECRET`.
(Bing/DuckDuckGo 스크래핑은 Vercel 데이터센터 IP가 차단돼 폴백만 하고 실동작 안 함.)

## 배포 트리거(중요)
`review-scraper` (Vercel map-review)와 두 워커(Render) 모두 **`main` 브랜치 push
시 자동 배포**된다. 즉 저장소 어디를 커밋해도 Vercel/Render가 다시 빌드된다.

## 주요 콘솔 직접 링크 (map-review 프로젝트)
- 프로젝트 홈: https://vercel.com/hichul-kim-s-projects/map-review
- 배포 목록(재배포는 여기서): https://vercel.com/hichul-kim-s-projects/map-review/deployments
- 환경변수: https://vercel.com/hichul-kim-s-projects/map-review/settings/environment-variables
- 배포 보호(공개 전환): https://vercel.com/hichul-kim-s-projects/map-review/settings/deployment-protection
- 도메인: https://vercel.com/hichul-kim-s-projects/map-review/settings/domains

## Render 워커 직접 링크
- **kakao-worker** (Service ID `srv-d9hockl8nd3s73f1d7ig`, URL
  `https://kakao-review-worker.onrender.com`)
  - Deploys(재배포/Manual Deploy): https://dashboard.render.com/web/srv-d9hockl8nd3s73f1d7ig/deploys
  - Logs: https://dashboard.render.com/web/srv-d9hockl8nd3s73f1d7ig/logs
  - Environment(환경변수): https://dashboard.render.com/web/srv-d9hockl8nd3s73f1d7ig/env
  - Settings: https://dashboard.render.com/web/srv-d9hockl8nd3s73f1d7ig/settings
  - 진단: `https://kakao-review-worker.onrender.com/debug?placeId=<id>` (JSON)
- Render 대시보드 홈: https://dashboard.render.com/
- 새 Web Service: https://dashboard.render.com/select-repo?type=web
