# 일정 관리자 페이지

Supabase Auth로 로그인해 방송 일정, 소식, 문의/제보 상태를 관리하는 정적 관리자 페이지입니다.

## 파일

- `index.html`: 로그인 및 편집 UI
- `config.js`: Supabase URL, anon/publishable key, 채널 ID 설정
- `app.js`: 로그인, 관리자 권한 확인, 데이터 로드/저장 로직
- `vendor/supabase-2.45.4.min.js`: 로컬 vendoring한 Supabase JS SDK

## 보안 전제

- 로그인만으로 저장 권한이 생기지 않습니다.
- 로그인한 사용자의 UID가 `public.admin_users`에 있어야 저장/문의함 관리가 가능합니다.
- RLS 정책은 프로젝트 루트의 `supabase/rls-hardening.sql`을 기준으로 실행하세요.
- 관리자 페이지는 외부 CDN 대신 `vendor/supabase-2.45.4.min.js`를 로드합니다.

관리자 UID 추가:

```sql
insert into public.admin_users (user_id)
values ('Supabase Auth > Users에서 복사한 UUID');
```

## 필요한 Edge Functions

먼저 `supabase/rls-hardening.sql`을 SQL Editor에서 실행해
`check_edge_rate_limit` RPC와 비공개 카운터 테이블을 생성한 다음 배포하세요.
두 함수는 rate-limit 저장소를 확인할 수 없으면 요청을 `503`으로 차단하도록 구성되어 있으므로 순서가 중요합니다.

```powershell
npx supabase functions deploy chzzk-search
npx supabase functions deploy chzzk-category-search
npx supabase functions deploy sync-live-category
npx supabase functions deploy submit-feedback
```

`chzzk-search`는 스트리머 자동완성에 필요합니다. `chzzk-category-search`는 게임/카테고리 자동완성에 필요합니다. `sync-live-category`는 방송 시작 및 카테고리 변경 감지 후 방송 시작 날짜 일정의 게임 목록 및 부 자동 생성에 필요합니다. `submit-feedback`는 확장 프로그램의 공개 문의/제보 등록에 필요합니다.

`chzzk-category-search`는 치지직 Open API Client 인증을 사용하므로 Edge Function secrets에 `CHZZK_CLIENT_ID`, `CHZZK_CLIENT_SECRET`을 설정해야 합니다.

`sync-live-category`는 `LIVE_CATEGORY_SYNC_SECRET`으로 인증합니다. 챕터와 방제 기록은 `?mode=chapters`를 **5초마다** 호출합니다. 일정 자동 생성과 다시보기 탐색은 `?mode=maintenance`로 분리하며 기존 실행 주기를 유지합니다(2026-09-14 운영 확인: 10초). 챕터 시각은 치지직 상태 응답을 받은 시점으로 계산하며, 중복되거나 늦게 도착한 과거 관측은 DB에서 걸러냅니다. 치지직 API 반영 지연과 네트워크 지연은 별도로 발생할 수 있습니다.

배포 순서: `supabase db push --linked`로 마이그레이션을 적용하고, `sync-live-category`를 배포한 뒤 `supabase/configure-fast-live-chapters.sql`을 실행하세요. 이 SQL은 기존 Cron의 인증 정보와 실행 주기를 재사용하고, 기존 작업을 유지 관리 작업으로 바꾸면서 5초 수집 작업을 추가합니다. 기존 작업이 하나가 아니거나 URL 형식이 다르면 변경하지 않고 오류로 중단합니다. 모드 없는 호출은 기존 전체 동기화를 수행하므로, 별도의 전체 동기화 Cron을 중복 등록하지 마세요.

일정에 추가할 카테고리는 `LIVE_CATEGORY_SYNC_TYPES`로 제한할 수 있습니다. 기본값 `*`는 전체 카테고리이며, `GAME`을 설정하면 게임만 일정에 추가합니다. 이 설정과 일정 자동 생성 토글은 챕터 수집을 막지 않습니다.

테스트로 실제 저장 경로를 검증할 때는 `POST` body에 `startedAt`과 `testCategories`를 보낼 수 있습니다. Cron의 빈 body `{}`는 기존처럼 현재 라이브 상태를 조회합니다.

## 로컬 테스트

```powershell
cd admin
node local-server.js
```

브라우저에서 `http://127.0.0.1:8001`으로 접속하세요. 로컬 서버는 Supabase Edge Function 프록시 경로를 함께 제공합니다.

`file://`로 직접 열면 Supabase Auth 세션/리다이렉트 동작이 제한될 수 있어 권장하지 않습니다.

## 배포

정적 호스팅이면 됩니다. Netlify, Vercel, GitHub Pages, Supabase Storage 등을 사용할 수 있습니다.

배포 시 포함해야 할 파일:

- `index.html`
- `config.js`
- `app.js`
- `vendor/supabase-2.45.4.min.js`

## 자동 카테고리/부 생성 설정

설정 메뉴의 자동 카테고리/부 생성 토글은 public.admin_settings 테이블에 auto_live_category_sync 값으로 저장됩니다. OFF이면 sync-live-category가 disabled로 종료되어 치지직 카테고리를 일정의 게임 목록과 부 제목에 반영하지 않습니다. 테이블이 아직 없으면 기본 OFF로 동작하므로, 운영 DB에 supabase/rls-hardening.sql을 적용하세요.
