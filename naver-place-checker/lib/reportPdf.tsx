// 진단 결과를 "진짜 PDF 파일"로 만들어 곧바로 다운로드한다(브라우저 인쇄창 없이).
// @react-pdf/renderer 로 벡터 PDF를 생성하며, 한글은 앱에 번들한 Pretendard(TTF)를
// same-origin 으로 임베드한다(런타임 CDN 의존 없음).
//
// 이 모듈은 클릭 시점에 동적 import 되어 초기 번들에 포함되지 않는다.

import type { DiagnosisRow, PlaceMeta } from "./types";

let fontsReady = false;

function markOf(r: DiagnosisRow): { t: string; bg: string; color: string } {
  if (r.kind === "number") return { t: "수", bg: "#eef8f2", color: "#048a45" };
  if (r.ok === true) return { t: "O", bg: "#e6f7ee", color: "#12a150" };
  if (r.kind === "optional") return { t: "선택", bg: "#eef1f5", color: "#7a8794" };
  return { t: "X", bg: "#fdeaea", color: "#e5484d" };
}

export async function buildReportBlob(
  place: PlaceMeta,
  rows: DiagnosisRow[],
  score: { done: number; total: number },
  dateStr: string,
): Promise<Blob> {
  const { Document, Page, View, Text, Font, StyleSheet, pdf } = await import(
    "@react-pdf/renderer"
  );

  if (!fontsReady) {
    Font.register({
      family: "Pretendard",
      fonts: [
        { src: "/fonts/Pretendard-Regular.ttf", fontWeight: 400 },
        { src: "/fonts/Pretendard-Bold.ttf", fontWeight: 700 },
      ],
    });
    // 한 단어(공백 없는 긴 한글)를 억지로 쪼개지 않도록.
    Font.registerHyphenationCallback((word) => [word]);
    fontsReady = true;
  }

  const pct = score.total ? Math.round((score.done / score.total) * 100) : 0;
  const grade = pct >= 80 ? "우수" : pct >= 50 ? "보통" : "보완필요";
  const gradeColor = pct >= 80 ? "#048a45" : pct >= 50 ? "#b7791f" : "#e5484d";

  const s = StyleSheet.create({
    page: {
      fontFamily: "Pretendard",
      fontSize: 9.5,
      color: "#1a1a1a",
      paddingTop: 40,
      paddingBottom: 44,
      paddingHorizontal: 44,
      lineHeight: 1.55,
    },
    // header
    head: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "flex-start",
      borderBottomWidth: 2,
      borderBottomColor: "#03c75a",
      paddingBottom: 12,
      marginBottom: 14,
    },
    kicker: { fontSize: 9, fontWeight: 700, color: "#048a45", marginBottom: 3 },
    title: { fontSize: 19, fontWeight: 700, letterSpacing: -0.4 },
    metaRow: { flexDirection: "row", flexWrap: "wrap", marginTop: 8 },
    metaItem: { fontSize: 9, color: "#444", marginRight: 16, marginBottom: 2 },
    metaB: { fontWeight: 700, color: "#111" },
    scoreBox: {
      borderWidth: 1.5,
      borderColor: "#03c75a",
      borderRadius: 8,
      paddingVertical: 6,
      paddingHorizontal: 14,
      alignItems: "center",
      marginLeft: 16,
    },
    scoreGrade: { fontSize: 17, fontWeight: 700 },
    scoreSub: { fontSize: 8, color: "#666", marginTop: 2 },
    // disclaimer
    callout: {
      backgroundColor: "#f5f8f6",
      borderWidth: 1,
      borderColor: "#dfe8e2",
      borderRadius: 6,
      padding: 9,
      marginBottom: 14,
    },
    calloutText: { fontSize: 8.8, color: "#4a5a52", lineHeight: 1.5 },
    calloutB: { fontWeight: 700, color: "#2f6b4a" },
    // table
    tHead: {
      flexDirection: "row",
      backgroundColor: "#f0f5f2",
      borderTopWidth: 1,
      borderBottomWidth: 1,
      borderColor: "#cdd8d1",
    },
    th: {
      fontSize: 8.5,
      fontWeight: 700,
      color: "#333",
      textAlign: "center",
      paddingVertical: 6,
      paddingHorizontal: 5,
    },
    tRow: {
      flexDirection: "row",
      borderBottomWidth: 1,
      borderColor: "#e2e8e4",
    },
    cMark: { width: "10%", alignItems: "center", justifyContent: "flex-start", paddingVertical: 7 },
    cItem: { width: "22%", paddingVertical: 7, paddingHorizontal: 6 },
    cStatus: { width: "27%", paddingVertical: 7, paddingHorizontal: 6 },
    cRec: { width: "41%", paddingVertical: 7, paddingHorizontal: 6 },
    itemText: { fontSize: 9, fontWeight: 700, color: "#1a1a1a" },
    statusText: { fontSize: 9, color: "#333" },
    statusMiss: { fontSize: 9, color: "#e5484d", fontWeight: 700 },
    recAction: { fontSize: 8.8, color: "#0a6b3b" },
    recGuide: { fontSize: 8.5, color: "#9099a3" }, // 옅은 색 모범답안
    recEmpty: { fontSize: 9, color: "#b6bdc6", textAlign: "center" },
    mk: {
      minWidth: 18,
      borderRadius: 9,
      paddingVertical: 1,
      paddingHorizontal: 5,
      fontSize: 8,
      fontWeight: 700,
      textAlign: "center",
    },
    // tips
    tipsWrap: { marginTop: 18, borderTopWidth: 1, borderColor: "#ddd", paddingTop: 12 },
    h2: { fontSize: 12.5, fontWeight: 700, color: "#048a45", marginBottom: 8 },
    h3: { fontSize: 10.5, fontWeight: 700, marginTop: 12, marginBottom: 4 },
    p: { fontSize: 9, color: "#333", marginBottom: 4 },
    li: { flexDirection: "row", marginBottom: 2.5, paddingRight: 4 },
    liDot: { width: 10, fontSize: 9, color: "#048a45" },
    liText: { flex: 1, fontSize: 9, color: "#333" },
    liB: { fontWeight: 700, color: "#111" },
    foot: {
      position: "absolute",
      bottom: 22,
      left: 44,
      right: 44,
      textAlign: "center",
      fontSize: 8,
      color: "#999",
      borderTopWidth: 1,
      borderColor: "#eee",
      paddingTop: 8,
    },
  });

  const Li = ({ label, rest }: { label: string; rest: string }) => (
    <View style={s.li}>
      <Text style={s.liDot}>•</Text>
      <Text style={s.liText}>
        <Text style={s.liB}>{label}</Text>
        {rest}
      </Text>
    </View>
  );

  const bodyRows = rows.map((r) => {
    const m = markOf(r);
    const isAction = r.kind !== "number" && r.ok !== true;
    const recText = isAction ? r.recommend || r.note : r.note;
    return (
      <View key={r.key} style={s.tRow} wrap={false}>
        <View style={s.cMark}>
          <Text style={[s.mk, { backgroundColor: m.bg, color: m.color }]}>{m.t}</Text>
        </View>
        <View style={s.cItem}>
          <Text style={s.itemText}>{r.label}</Text>
        </View>
        <View style={s.cStatus}>
          <Text style={r.ok === false ? s.statusMiss : s.statusText}>{r.status}</Text>
        </View>
        <View style={s.cRec}>
          {recText ? (
            <Text style={isAction ? s.recAction : s.recGuide}>{recText}</Text>
          ) : (
            <Text style={s.recEmpty}>—</Text>
          )}
        </View>
      </View>
    );
  });

  const doc = (
    <Document title={`네이버 플레이스 세팅 진단 리포트 - ${place.name}`}>
      <Page size="A4" style={s.page}>
        {/* 헤더 */}
        <View style={s.head}>
          <View style={{ flex: 1, paddingRight: 12 }}>
            <Text style={s.kicker}>네이버 플레이스 세팅 진단 리포트</Text>
            <Text style={s.title}>{place.name}</Text>
            <View style={s.metaRow}>
              {place.category ? (
                <Text style={s.metaItem}>
                  업종 <Text style={s.metaB}>{place.category}</Text>
                </Text>
              ) : null}
              <Text style={s.metaItem}>
                업종군 <Text style={s.metaB}>{place.bizTypeLabel}</Text>
              </Text>
              <Text style={s.metaItem}>
                필수 <Text style={s.metaB}>{score.done}/{score.total}</Text> 완료
              </Text>
              <Text style={s.metaItem}>
                진단일 <Text style={s.metaB}>{dateStr}</Text>
              </Text>
            </View>
          </View>
          <View style={[s.scoreBox, { borderColor: gradeColor }]}>
            <Text style={[s.scoreGrade, { color: gradeColor }]}>{grade}</Text>
            <Text style={s.scoreSub}>필수 {score.done}/{score.total}</Text>
          </View>
        </View>

        {/* 자동진단 한계 안내 */}
        <View style={s.callout}>
          <Text style={s.calloutText}>
            <Text style={s.calloutB}>※ 소식·대표사진</Text>은 공개 데이터 수집(크롤링)만으로는
            정확히 확인할 수 없어 자동 진단 항목에서 제외했습니다. 두 항목은 스마트플레이스에
            로그인해 <Text style={s.calloutB}>직접 확인</Text>해 주세요. (소식은 월 2회 이상 발행,
            대표사진은 1200px 이상·최소 5장 권장)
          </Text>
        </View>

        {/* 표 */}
        <View style={s.tHead}>
          <Text style={[s.th, { width: "10%" }]}>판정</Text>
          <Text style={[s.th, { width: "22%" }]}>필수 항목</Text>
          <Text style={[s.th, { width: "27%" }]}>현재 상태</Text>
          <Text style={[s.th, { width: "41%" }]}>권고 · 확인 사항</Text>
        </View>
        {bodyRows}

        {/* 추가 팁 */}
        <View style={s.tipsWrap}>
          <Text style={s.h2}>추가 팁 — 상위노출을 위한 핵심 가이드</Text>

          <Text style={s.h3}>1. 노출 알고리즘 4대 축 (2025~2026)</Text>
          <Text style={s.p}>
            순위는 대체로 적합도 · 인기도 · 거리 · 신뢰도 조합으로 결정되며, 무게중심이
            &quot;실제 이용자 행동 데이터 + 활동성 + 신뢰도&quot;로 이동했습니다.
          </Text>
          <Li label="적합도(관련성) " rest="— 업체명·업종 카테고리·키워드·상세설명이 검색어와 얼마나 맞는가" />
          <Li label="인기도 " rest="— 클릭수, 플레이스 저장(즐겨찾기) 수, 리뷰수, 전화·길찾기·예약 전환" />
          <Li label="거리 " rest="— 검색 위치와 매장의 물리적 거리" />
          <Li label="신뢰도 " rest="— 진짜 방문(영수증) 리뷰 비율, 부자연스러운 리뷰 패턴 여부" />

          <Text style={s.h3}>2. 놓치기 쉬운 세팅·활동 항목</Text>
          <Li label="업체명(상호) " rest="— 정식 상호 사용. 과도한 키워드 삽입은 어뷰징 위험" />
          <Li label="검색 키워드 10~15개 " rest="— 업종·지역·서비스 조합으로 관리자 검색어 등록(대표키워드 5개와 별개)" />
          <Li label="소식(새소식) " rest="— 월 2회 이상 이벤트·신메뉴·공지 발행(살아있는 매장 신호)" />
          <Li label="네이버 톡톡 " rest="— 문의 응대 채널 연결(응대율·속도가 신뢰도에 반영)" />
          <Li label="동영상 / 네이버 클립(숏폼) " rest="— 최근 노출 가중" />
          <Li label="대표사진(썸네일) 지정 & 1200px 이상 " rest="— 첫 이미지가 클릭률을 좌우" />
          <Li label="지도 핀(마커) 위치 정밀 조정 " rest="— 지하·고층·복합건물 좌표 정확도" />
          <Li label="NAP 일관성 " rest="— 상호·주소·전화가 웹 전반에서 동일해야(로컬 SEO 핵심)" />
          <Li label="편의시설/시설정보 " rest="— 주차·화장실·반려동물·포장·배달·예약 가능 여부 등 상세히" />
          <Li label="리뷰 최신성 & 답글률 " rest="— 리뷰 '수'보다 최근 유입 속도와 답글이 핵심 지표" />
          <Li label="정보 정확성 " rest="— 영업시간이 실제와 일치, 전화 연결 정상, 폐업·휴업 여부" />

          <Text style={s.h3}>3. 네이버 플레이스 메뉴 구성 참고</Text>
          <Li label="기본 6 " rest="— 홈 · 소식 · 메뉴 · 리뷰 · 사진 · 정보 (모든 업종)" />
          <Li label="예약/주문 " rest="— 스마트플레이스 비즈니스 도구 연동 시 생성" />
          <Li label="업종 특화 " rest="— 객실(숙박) · 코스/패키지(클래스·투어) · 가격(학원·헬스·미용·주차) · 의사(병원)" />
          <Li label="부가 " rest="— 블로그(연동 SNS 최신글) · 주변(자동 추천)" />
        </View>

        <Text
          style={s.foot}
          fixed
          render={({ pageNumber, totalPages }) =>
            `플레이스 닥터 · 공개 플레이스 페이지 기준 진단 · 대표키워드·스마트콜·통계 등 관리자 전용 항목 제외    ·    ${pageNumber} / ${totalPages}`
          }
        />
      </Page>
    </Document>
  );

  return pdf(doc).toBlob();
}
