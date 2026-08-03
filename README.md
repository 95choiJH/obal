# 오뱅알

치지직 채널 페이지에 방송 일정, 예정 컨텐츠, 메모, 다시보기 링크를 표시하는 브라우저 확장 프로그램과 일정 관리자 페이지입니다.

## 구성

- `manifest.json`, `background.js`, `content.js`, `config.js`: 브라우저 확장 프로그램
- `admin/`: Supabase Auth로 로그인해 일정을 편집하는 관리자 페이지
- `supabase/rls-hardening.sql`: 운영용 RLS 정책
- `supabase/functions/chzzk-search`: 치지직 채널 검색 프록시
- `supabase/functions/submit-feedback`: 공개 문의/제보 접수 API
- `supabase/functions/telegram-obal-alert`: 일정 제보 텔레그램 알림

## Supabase 설정

`config.js`와 `admin/config.js`에 같은 Supabase 프로젝트 URL과 anon/publishable key를 넣습니다. 이 키는 공개되어도 되는 키이며, 데이터 보호는 RLS와 Edge Function에서 처리합니다.

```js
supabaseUrl: "https://xxxx.supabase.co",
supabaseKey: "anon 또는 publishable key",
tableName: "schedule",
upcomingContentTableName: "upcoming_content",
feedbackTableName: "feedback",
```

## 보안 정책

운영 DB에는 `supabase/rls-hardening.sql`을 SQL Editor에서 실행하세요. 이 파일이 RLS의 기준입니다.

핵심 정책:

- `schedule`, `upcoming_content`: anon/authenticated는 조회만 가능
- 일정과 소식의 등록/수정/삭제: `public.admin_users`에 등록된 Supabase Auth UID만 가능
- `feedback`: anon 직접 insert 금지
- 공개 문의/제보 등록: `submit-feedback` Edge Function이 검증/rate limit 후 service role로 insert
- 문의/제보 조회 및 상태 변경: `public.admin_users`에 등록된 관리자만 가능

관리자 추가 예시:

```sql
insert into public.admin_users (user_id)
values ('Supabase Auth > Users에서 복사한 UUID');
```

## Edge Functions 배포

```powershell
npx supabase login
npx supabase link --project-ref ggebdrlvzrgoyumlrnxe
npx supabase functions deploy chzzk-search
npx supabase functions deploy submit-feedback
npx supabase functions deploy telegram-obal-alert
```

`submit-feedback`는 `SUPABASE_URL`과 `SUPABASE_SERVICE_ROLE_KEY`가 필요합니다. Supabase가 기본 제공하지 않는 환경이면 Edge Function secrets에 직접 등록하세요.

운영 배포 후에는 브라우저 호출 origin을 제한하세요. Chrome Web Store 배포 후 확장 프로그램 ID가 확정되면 `chrome-extension://확장프로그램ID`를 넣고, 관리자 페이지를 별도 호스팅하면 해당 `https://관리자도메인`도 함께 넣습니다. 여러 origin은 쉼표로 구분합니다.

```powershell
npx supabase secrets set FEEDBACK_ALLOWED_ORIGINS="chrome-extension://확장프로그램ID,https://관리자도메인"
npx supabase secrets set CHZZK_SEARCH_ALLOWED_ORIGINS="chrome-extension://확장프로그램ID,https://관리자도메인"
```

텔레그램 알림에는 다음 secrets가 필요합니다.

```text
TELEGRAM_BOT_TOKEN
TELEGRAM_CHAT_ID
FEEDBACK_WEBHOOK_SECRET
```

시크릿은 절대 `config.js`, `admin/config.js`, README, 확장 패키지에 넣지 마세요.

## 관리자 페이지

`admin/index.html`은 외부 CDN 대신 `admin/vendor/supabase-2.45.4.min.js`를 로컬로 로드합니다. 배포할 때 `admin/vendor/`도 함께 올려야 합니다.

로컬 테스트:

```powershell
cd admin
python -m http.server 8000
```

브라우저에서 `http://localhost:8000`으로 접속합니다.

## 확장 프로그램 패키징

```powershell
.\package-extension.ps1
```

결과물은 `dist/obaengal-extension.zip`에 생성됩니다.

## 문의/제보 흐름

1. content script가 background script에 `submitFeedback` 메시지를 보냅니다.
2. background script가 `submit-feedback` Edge Function을 호출합니다.
3. Edge Function이 type, message, contact, relatedLink를 검증하고 IP 기준 간단한 rate limit을 적용합니다.
4. Edge Function이 service role로 `feedback` 테이블에 insert합니다.
5. DB trigger 또는 Supabase webhook이 `telegram-obal-alert`를 호출합니다.

## 운영 체크리스트

- `supabase/rls-hardening.sql` 실행
- `public.admin_users`에 관리자 UID 추가
- `chzzk-search`, `submit-feedback`, `telegram-obal-alert` 배포
- Edge Function secrets 설정 (`SUPABASE_SERVICE_ROLE_KEY`, `FEEDBACK_ALLOWED_ORIGINS`, `CHZZK_SEARCH_ALLOWED_ORIGINS`, Telegram secrets)
- 관리자 페이지 배포 시 `admin/vendor/` 포함
- 확장 프로그램 재패키징 후 설치/배포


