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

```powershell
npx supabase functions deploy chzzk-search
npx supabase functions deploy submit-feedback
```

`chzzk-search`는 스트리머 자동완성에 필요합니다. `submit-feedback`는 확장 프로그램의 공개 문의/제보 등록에 필요합니다.

## 로컬 테스트

```powershell
cd admin
python -m http.server 8000
```

브라우저에서 `http://localhost:8000`으로 접속하세요.

`file://`로 직접 열면 Supabase Auth 세션/리다이렉트 동작이 제한될 수 있어 권장하지 않습니다.

## 배포

정적 호스팅이면 됩니다. Netlify, Vercel, GitHub Pages, Supabase Storage 등을 사용할 수 있습니다.

배포 시 포함해야 할 파일:

- `index.html`
- `config.js`
- `app.js`
- `vendor/supabase-2.45.4.min.js`
