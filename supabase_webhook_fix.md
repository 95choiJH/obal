# Supabase feedback webhook fallback

Supabase Dashboard Webhook 생성 시 `schema "supabase_functions" does not exist` 오류가 나면 Dashboard UI 대신 `pg_net` 트리거로 `telegram-obal-alert` Edge Function을 호출합니다.

## 전제

- `feedback` insert는 공개 클라이언트가 직접 하지 않고 `submit-feedback` Edge Function을 통해 수행합니다.
- `telegram-obal-alert`에는 `FEEDBACK_WEBHOOK_SECRET`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` secret이 설정되어 있어야 합니다.
- 아래 SQL의 `x-webhook-secret` 값은 `FEEDBACK_WEBHOOK_SECRET`과 같아야 합니다.

## SQL

```sql
create extension if not exists pg_net;

create or replace function public.notify_schedule_feedback()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.type is distinct from '일정' then
    return new;
  end if;

  perform net.http_post(
    url := 'https://ggebdrlvzrgoyumlrnxe.supabase.co/functions/v1/telegram-obal-alert',
    body := jsonb_build_object(
      'type', 'INSERT',
      'table', TG_TABLE_NAME,
      'schema', TG_TABLE_SCHEMA,
      'record', to_jsonb(new),
      'old_record', null
    ),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-webhook-secret', '여기에_FEEDBACK_WEBHOOK_SECRET과_같은_값'
    ),
    timeout_milliseconds := 5000
  );

  return new;
end;
$$;

drop trigger if exists trg_notify_schedule_feedback on public.feedback;

create trigger trg_notify_schedule_feedback
after insert on public.feedback
for each row
execute function public.notify_schedule_feedback();
```

## 확인

1. 확장 프로그램에서 종류 `일정`으로 제보를 등록합니다.
2. `feedback` 테이블에 행이 생성되는지 확인합니다.
3. Telegram 알림이 도착하지 않으면 Supabase Edge Function logs와 `net._http_response`를 확인합니다.

