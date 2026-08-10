// Mobile PWA public configuration.
// Uses the same public Supabase anon key as the extension. Data safety is handled by RLS.
const OBAENGAL_MOBILE_CONFIG = {
  supabaseUrl: "https://ggebdrlvzrgoyumlrnxe.supabase.co",
  supabaseKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdnZWJkcmx2enJnb3l1bWxybnhlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM0MDEyODMsImV4cCI6MjA5ODk3NzI4M30.Z2rc-fvYqguOyTcYPiaGaO2mjFuDFGaUEdod1ps5NOc",
  tableName: "schedule",
  upcomingContentTableName: "upcoming_content",
  feedbackFunctionName: "submit-feedback",
  chzzkSearchFunctionName: "chzzk-search",
  defaultChannelId: "0dad8baf12a436f722faa8e5001c5011",
  defaultChannelName: "오뱅알",
  timezone: "Asia/Seoul",
  cacheTtlMinutes: 5,
};
