// 최소 서비스워커 — PWA "앱으로 설치"(바탕화면/홈 아이콘) 활성화용.
// 네트워크는 그대로 통과시키고, 설치 가능 조건(fetch 핸들러 존재)만 충족.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {
  /* passthrough — 브라우저 기본 처리 */
});
