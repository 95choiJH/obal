// Resolve CHZZK replay links for authenticated administrators only.
function headers(req: Request) {
  return { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': req.headers.get('origin') || '*',
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
    'Access-Control-Allow-Methods': 'POST, OPTIONS', Vary: 'Origin' };
}
function replayUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.port) throw Error('HTTPS 치지직 다시보기 링크를 입력해 주세요.');
  if (url.hostname !== 'naver.me' && url.hostname !== 'chzzk.naver.com') throw Error('치지직 또는 naver.me 링크만 사용할 수 있습니다.');
  return url;
}
Deno.serve(async (req) => {
  const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: headers(req) });
  if (req.method === 'OPTIONS') return new Response(null, { headers: headers(req) });
  if (req.method !== 'POST') return reply({ error: 'Method not allowed' }, 405);
  const base = Deno.env.get('SUPABASE_URL') || '';
  const key = Deno.env.get('SUPABASE_ANON_KEY') || '';
  const auth = req.headers.get('authorization') || '';
  const authHeaders = { apikey: key, Authorization: auth };
  try {
    const userResponse = await fetch(base + '/auth/v1/user', { headers: authHeaders });
    if (!userResponse.ok) return reply({ error: '로그인이 필요합니다.' }, 401);
    const user = await userResponse.json();
    const adminResponse = await fetch(base + '/rest/v1/admin_users?select=user_id&user_id=eq.' + encodeURIComponent(user.id), { headers: authHeaders });
    if (!adminResponse.ok || !(await adminResponse.json()).length) return reply({ error: '관리자 권한이 필요합니다.' }, 403);
    const body = await req.json();
    let url = replayUrl(String(body.url || ''));
    for (let step = 0; url.hostname === 'naver.me' && step < 5; step++) {
      const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(8000) });
      const location = response.headers.get('location');
      await response.body?.cancel();
      if (!location) throw Error('단축 링크의 원본 주소를 확인할 수 없습니다.');
      url = replayUrl(new URL(location, url).href);
    }
    const match = url.hostname === 'chzzk.naver.com' && url.pathname.match(/^\/video\/([0-9]+)\/?$/);
    if (!match) throw Error('개별 다시보기 영상 링크를 입력해 주세요.');
    const videoNo = match[1];
    const detailResponse = await fetch('https://api.chzzk.naver.com/service/v3/videos/' + videoNo + '?dt=' + crypto.randomUUID().slice(0, 5), { signal: AbortSignal.timeout(8000) });
    if (!detailResponse.ok) throw Error('영상 정보를 확인할 수 없습니다.');
    const detail = (await detailResponse.json()).content;
    if (!detail) throw Error('영상 정보를 확인할 수 없습니다.');
    if (body.channelId && detail.channel?.channelId !== body.channelId) throw Error('다른 채널의 영상입니다.');
    const rawStart = String(detail.liveOpenDate || '');
    const local = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}$/.test(rawStart);
    const parsed = new Date(local ? rawStart.replace(' ', 'T') + '+09:00' : rawStart);
    return reply({ url: 'https://chzzk.naver.com/video/' + videoNo, videoNo,
      startedAt: Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString(), title: String(detail.videoTitle || '') });
  } catch (error) { return reply({ error: String((error as Error).message || error) }, 400); }
});
