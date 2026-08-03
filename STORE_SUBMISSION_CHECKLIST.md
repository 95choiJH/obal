# Chrome Web Store 제출 체크리스트

## 업로드 파일

- `dist/obaengal-extension.zip`

## 권한 설명

### `storage`

방송 일정 데이터를 짧은 시간 동안 로컬 캐시에 저장해 페이지 이동과 새로고침 시 불필요한 네트워크 요청을 줄입니다.

### `https://*.supabase.co/*`

Supabase에서 방송 일정, 소식, 스트리머 검색 프록시, 문의/제보 API를 호출하기 위해 필요합니다.

### `https://chzzk.naver.com/*` content script

치지직 채널 페이지 안에 방송 일정 UI를 표시하기 위해 필요합니다.

## 개인정보/데이터 처리

이 확장 프로그램은 치지직 페이지에 방송 일정 UI를 표시합니다.

수집 또는 전송되는 사용자 입력:

- 문의/제보 내용
- 일정 제보 관련 링크
- 확장 프로그램 버전

현재 UI에서는 이메일 입력란을 노출하지 않습니다. 코드에는 선택 연락처 필드가 남아 있지만 화면에서는 주석 처리되어 있습니다.

저장 위치:

- 문의/제보는 Supabase `feedback` 테이블에 저장됩니다.
- 일정/소식은 Supabase `schedule`, `upcoming_content` 테이블에서 읽습니다.
- 확장 프로그램은 일정 데이터를 브라우저 로컬 저장소에 캐시합니다.

보안 경계:

- 확장 프로그램에 포함된 Supabase 키는 anon/public key입니다.
- `schedule`, `upcoming_content`는 anon/authenticated 조회만 허용합니다.
- 관리자 수정 권한은 `public.admin_users`에 등록된 Supabase Auth UID로 제한합니다.
- `feedback` 직접 insert는 열지 않고 `submit-feedback` Edge Function을 통해서만 등록합니다.
- 운영 배포 후 `FEEDBACK_ALLOWED_ORIGINS`, `CHZZK_SEARCH_ALLOWED_ORIGINS`를 확장 프로그램 ID로 제한합니다.

## 제출 전 확인

- `supabase/rls-hardening.sql` 운영 DB 적용
- `public.admin_users`에 관리자 UID 등록
- `upcoming_content.hidden` 컬럼 존재 확인
- `chzzk-search`, `submit-feedback`, `telegram-obal-alert` Edge Function 배포
- `SUPABASE_SERVICE_ROLE_KEY`, Telegram secrets 설정
- Chrome Web Store 업로드 후 확장 ID 확인
- `FEEDBACK_ALLOWED_ORIGINS`, `CHZZK_SEARCH_ALLOWED_ORIGINS` 설정 후 Edge Function 재배포
- 치지직 페이지에서 일정 표시, 문의/제보 전송, 메모/소식 숨김 동작 확인

