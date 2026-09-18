(() => {
"use strict";
const cfg=OBAENGAL_MOBILE_CONFIG,$=id=>document.getElementById(id);
const state={channel:cfg.defaultChannelId,logs:[],rank:null,visible:5,request:0,loading:false};
const streamerName=cfg.streamerName||"따효니";
$("pageTitle").textContent=streamerName+" 롤 전적";
document.title=streamerName+" 롤 전적 · 오뱅알";
const tiers=["IRON","BRONZE","SILVER","GOLD","PLATINUM","EMERALD","DIAMOND","MASTER","GRANDMASTER","CHALLENGER"];
const names=["아이언","브론즈","실버","골드","플래티넘","에메랄드","다이아몬드","마스터","그랜드마스터","챌린저"];
const positions={TOP:"탑",JUNGLE:"정글",MIDDLE:"미드",BOTTOM:"바텀",UTILITY:"서포터"};
const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const num=v=>v===null||v===undefined||v===""?null:Number.isFinite(Number(v))?Number(v):null;
const metric=(v,d=0)=>num(v)===null?"—":Number(v).toLocaleString("ko-KR",{maximumFractionDigits:d});
const stamp=v=>{const d=new Date(v);return Number.isFinite(d.getTime())?new Intl.DateTimeFormat("ko-KR",{month:"numeric",day:"numeric",hour:"2-digit",minute:"2-digit"}).format(d):"확인 중";};
async function query(table,params){
const url=new URL(cfg.supabaseUrl.replace(/\/+$/,"")+"/rest/v1/"+table);
Object.entries(params).forEach(([k,v])=>url.searchParams.set(k,v));
const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
try{const response=await fetch(url,{headers:{apikey:cfg.supabaseKey,Authorization:"Bearer "+cfg.supabaseKey},signal:controller.signal,cache:"no-store"});if(!response.ok)throw Error("HTTP "+response.status);const rows=await response.json();if(!Array.isArray(rows))throw Error("Invalid response");return rows;}finally{clearTimeout(timer);}
}
function score(row){
const tier=tiers.indexOf(String(row.tier_after||"").toUpperCase()),lp=num(row.lp_after);
if(tier<0||lp===null)return null;
const division=["IV","III","II","I"].indexOf(row.rank_after);
if(tier<7&&division<0)return null;
return tier*400+(tier<7?division*100:0)+lp;
}
function points(logs){
const unique=new Map();
for(const row of logs){const at=row.metadata?.rankCapturedAt;const value=score(row);if(at&&Number.isFinite(Date.parse(at))&&value!==null)unique.set(at,{at,value});}
return [...unique.values()].sort((a,b)=>Date.parse(a.at)-Date.parse(b.at)).slice(-20);
}
function trend(logs){
const data=points(logs);
if(data.length<2)return '<section class="trend"><h2>티어 변화</h2><div class="trend-empty"><strong>기록 수집 중</strong><span>수집 시점의 티어 기록이 2개 이상 쌓이면<br>변화를 표시합니다.</span></div><div class="trend-bottom"><span>과거 LP를 추정하지 않습니다.</span><span>'+data.length+'개 기록</span></div></section>';
const lo=Math.min(...data.map(p=>p.value)),hi=Math.max(...data.map(p=>p.value)),range=Math.max(hi-lo,40),center=(hi+lo)/2;
const coords=data.map((p,i)=>({x:8+i/(data.length-1)*304,y:48-(p.value-center)/range*64}));
const line=coords.map(p=>p.x.toFixed(1)+","+p.y.toFixed(1)).join(" "),last=coords.at(-1),delta=data.at(-1).value-data[0].value;
return '<section class="trend"><h2>티어 변화</h2><svg viewBox="0 0 320 96" role="img" aria-label="수집된 티어 변화 '+esc(delta)+'점"><path d="M8 48H312" stroke="var(--line)" stroke-dasharray="3 4"/><polyline points="'+line+'" fill="none" stroke="var(--green)" stroke-width="2.5" stroke-linejoin="round"/><circle cx="'+last.x+'" cy="'+last.y+'" r="4" fill="var(--green)"/></svg><div class="trend-bottom"><span>'+esc(stamp(data[0].at))+' — '+esc(stamp(data.at(-1).at))+'</span><span>'+data.length+'개 기록</span></div></section>';
}
function rankHtml(rank){
if(!rank)return '<section class="rank-card"><h2>현재 티어</h2><p class="account">티어 정보를 아직 수집하지 못했습니다.</p></section>';
const tier=String(rank.latest_tier||"").toUpperCase(),index=tiers.indexOf(tier),title=index<0?"티어 확인 중":names[index]+(index<7?" "+(rank.latest_rank||""):"");
const bounds={IRON:[1280,720,543,297,196,119],BRONZE:[1280,720,522,276,238,156],SILVER:[1280,720,509,245,262,183],GOLD:[1280,720,509,231,259,222],PLATINUM:[2560,1440,1017,443,527,454],EMERALD:[2560,1440,990,460,584,434],DIAMOND:[1280,720,484,262,314,189],MASTER:[1280,720,491,236,300,221],GRANDMASTER:[1280,720,485,242,311,224],CHALLENGER:[1280,720,480,216,322,243]}[tier];
const emblem=index<0?"":'<svg class="emblem" viewBox="'+bounds.slice(2).join(" ")+'" aria-hidden="true"><image href="https://raw.communitydragon.org/latest/plugins/rcp-fe-lol-static-assets/global/default/ranked-emblem/emblem-'+tier.toLowerCase()+'.png" width="'+bounds[0]+'" height="'+bounds[1]+'"/></svg>';
return '<section class="rank-card"><h2>현재 티어</h2><div class="rank-top">'+emblem+'<div><p class="account">'+esc(rank.riot_game_name)+'<span> #'+esc(rank.riot_tag_line)+'</span></p><p class="tier">'+esc(title)+'</p><p class="lp">'+metric(rank.latest_league_points)+' LP</p></div></div><p class="season">시즌 '+metric(rank.latest_wins)+'승 '+metric(rank.latest_losses)+'패 · '+esc(stamp(rank.latest_rank_updated_at))+' 기준</p></section>';
}
function summary(logs){
const completed=logs.filter(r=>typeof r.win==="boolean"),wins=completed.filter(r=>r.win).length,kills=completed.reduce((s,r)=>s+(num(r.kills)||0),0),deaths=completed.reduce((s,r)=>s+(num(r.deaths)||0),0),assists=completed.reduce((s,r)=>s+(num(r.assists)||0),0);
return '<div class="stats"><div class="stat"><span>최근 승률</span><strong>'+(completed.length?Math.round(wins/completed.length*100)+"%":"—")+'</strong><small>'+wins+'승 '+(completed.length-wins)+'패</small></div><div class="stat"><span>평균 KDA</span><strong>'+(completed.length?(deaths?((kills+assists)/deaths).toFixed(2):"Perfect"):"—")+'</strong><small>완료 경기 기준</small></div><div class="stat"><span>조회 경기</span><strong>'+logs.length+'</strong><small>최근 최대 100경기</small></div></div>';
}
function rowHtml(r){
const result=r.win===true?"승리":r.win===false?"패배":"진행 중",tone=r.win===false?" loss":r.win===true?"":" pending";
const championId=num(r.champion_id),icon=championId&&championId>0?'<img class="champion-icon" src="https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/champion-icons/'+championId+'.png" alt="" loading="lazy">':'<span class="champion-icon"></span>';
const duration=num(r.game_duration_seconds),minutes=duration!==null?Math.floor(duration/60)+"분":"시간 확인 중";
const stats=[["챔피언 피해량",metric(r.damage_to_champions)],["CS / 분",metric(r.cs_per_minute,1)],["골드 / 분",metric(r.gold_per_minute,1)],["킬 관여율",num(r.kill_participation)===null?"—":metric(r.kill_participation,1)+"%"],["시야 점수",metric(r.vision_score)],["게임 시간",minutes]];
return '<details class="match'+tone+'"><summary>'+icon+'<div><p class="champion-name">'+esc(r.champion_name||"챔피언 확인 중")+'</p><p class="match-meta">'+esc(positions[r.team_position]||r.team_position||"포지션 확인 중")+' · '+esc(minutes)+'<br>'+esc(stamp(r.game_start_at))+'</p></div><div class="result"><strong>'+result+'</strong><p>'+metric(r.kills)+' / '+metric(r.deaths)+' / '+metric(r.assists)+'</p><small>상세 기록 ⌄</small></div></summary><dl class="match-details">'+stats.map(([k,v])=>'<div><dt>'+k+'</dt><dd>'+esc(v)+'</dd></div>').join("")+'</dl></details>';
}
function render(){
let list="",date="";
for(const row of state.logs.slice(0,state.visible)){const key=row.schedule_date||"";if(key!==date){date=key;list+='<h3 class="date-label">'+esc(key)+'</h3>';}list+=rowHtml(row);}
const empty='<div class="empty"><strong>아직 표시할 전적이 없습니다.</strong><p>등록 계정의 솔로 랭크 경기가 수집되면 여기에 표시됩니다.</p></div>';
$("content").innerHTML=rankHtml(state.rank)+trend(state.logs)+summary(state.logs)+'<div class="history-heading"><h2>최근 경기</h2><span>'+Math.min(state.visible,state.logs.length)+' / '+state.logs.length+'</span></div>'+ (list||empty)+(state.visible<state.logs.length?'<button class="more" id="more" type="button">더보기 <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m6 9 6 6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>':state.logs.length?'<p class="end">'+(state.logs.length===100?"최근 100경기를 모두 확인했습니다.":"조회한 전적을 모두 확인했습니다.")+'</p>':"");
$("more")?.addEventListener("click",()=>{state.visible+=5;render();$("more")?.focus({preventScroll:true});});
$("content").setAttribute("aria-busy","false");
}
async function load(){
const request=++state.request,channel=state.channel;
state.loading=true;$("refreshBtn").disabled=true;$("content").setAttribute("aria-busy","true");$("status").className="status";$("status").textContent="최신 전적을 확인하고 있습니다.";$("updatedLabel").textContent="최신 데이터를 확인하고 있습니다.";
try{
const [accounts,logs]=await Promise.all([query("lol_streamer_rank_public",{select:"*",channel_id:"eq."+channel,limit:"1"}),query("lol_match_logs",{select:"*",channel_id:"eq."+channel,queue_id:"eq.420",order:"game_start_at.desc,id.desc",limit:"100"})]);
if(request!==state.request)return;
state.rank=accounts.find(r=>r.channel_id===channel)||null;
const seen=new Set();state.logs=logs.filter(r=>r.match_id&&!seen.has(r.match_id)&&seen.add(r.match_id));
render();$("updatedLabel").textContent="전적 조회 "+stamp(new Date());$("status").textContent="조회 "+stamp(new Date())+" · 전적은 경기 종료 후 수집되며 반영이 지연될 수 있습니다.";
}catch(error){if(request!==state.request)return;$("updatedLabel").textContent="전적을 불러오지 못했습니다.";$("status").className="status error";$("status").textContent="전적을 불러오지 못했습니다. 연결 상태를 확인하고 새로고침해 주세요.";if(!state.logs.length&&!state.rank)$("content").innerHTML='<div class="empty"><strong>연결을 확인해 주세요.</strong><p>오른쪽 위 새로고침으로 다시 조회할 수 있습니다.</p></div>';$("content").setAttribute("aria-busy","false");}
finally{if(request===state.request){state.loading=false;$("refreshBtn").disabled=false;}}
}
$("refreshBtn").addEventListener("click",load);
document.addEventListener("visibilitychange",()=>{if(!document.hidden&&!state.loading)load();});
setInterval(()=>{if(!document.hidden&&!state.loading)load();},60000);
if("serviceWorker" in navigator)navigator.serviceWorker.register("./service-worker.js").catch(()=>{});
load();
})();