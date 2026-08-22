// ============================================================
// 치지직 일정표 설정
// 이 파일만 수정하면 됩니다.
// ============================================================

const CHZZK_SCHEDULE_CONFIG = {
  // Supabase 프로젝트 URL (예: https://xxxx.supabase.co)
  supabaseUrl: "https://ggebdrlvzrgoyumlrnxe.supabase.co",

  // Supabase 공개 키 (anon public 또는 sb_publishable_... 키)
  // 브라우저에 노출돼도 안전합니다. RLS가 데이터를 보호합니다.
  supabaseKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdnZWJkcmx2enJnb3l1bWxybnhlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM0MDEyODMsImV4cCI6MjA5ODk3NzI4M30.Z2rc-fvYqguOyTcYPiaGaO2mjFuDFGaUEdod1ps5NOc",

  // 일정이 저장된 테이블 이름
  tableName: "schedule",

  // 소식/예정 컨텐츠 목록이 저장된 테이블 이름
  upcomingContentTableName: "upcoming_content",

  // 문의/제보가 저장될 테이블 이름 (콘텐츠 스크립트에서 사용)
  feedbackTableName: "feedback",

  // 캐시 유지 시간(분). 이 시간 안에는 네트워크 요청 없이 캐시를 사용합니다.
  cacheTtlMinutes: 10,

  // 치지직 페이지가 열려 있을 때 일정과 소식을 자동으로 다시 불러오는 주기(분)
  autoRefreshMinutes: 1,

  // 임시 UI 테스트: 아래 채널에서는 testSourceChannelId의 일정 데이터를 표시합니다.
  // 테스트 종료 후 testChannelId를 빈 문자열로 바꾸면 비활성화됩니다.
  testChannelId: "",
  testSourceChannelId: "",

  // (선택) 인라인 삽입 위치를 직접 지정하고 싶을 때 CSS 선택자를 입력.
  // 비워두면 자동 탐색합니다. 예: '[class*="_information_1lz65"]'
  anchorSelector: "",
};

