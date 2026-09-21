(()=>{
"use strict";
const api=typeof browser!=="undefined"?browser:chrome;
const ROOT_ID="obal-vod-chat-search-admin";
const MAX_PAGES=5000,MAX_MESSAGES=250000;
let searchRun=0,lastPath="";
function videoNoFromPath(path=location.pathname){const match=String(path).match(/^\/video\/(\d+)(?:\/|$)/);return match?match[1]:""}
function normalizeText(value){return String(value||"").normalize("NFKC").toLocaleLowerCase("ko-KR")}
function formatVodTime(milliseconds){const total=Math.max(0,Math.floor(Number(milliseconds||0)/1000)),hours=Math.floor(total/3600),minutes=Math.floor(total%3600/60),seconds=total%60;return (hours?String(hours).padStart(2,"0")+":":"")+String(minutes).padStart(2,"0")+":"+String(seconds).padStart(2,"0")}
function escapeHtml(value){return String(value??"").replace(/[&<>"']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]))}
function messageKey(chat){return [chat.playerMessageTime,chat.userIdHash,chat.content].join("|")}
function matchesChat(chat,keyword,nickname){return normalizeText(chat.content).includes(normalizeText(keyword))&&(!nickname||normalizeText(chat.nickname).includes(normalizeText(nickname)))}
function seekTo(milliseconds){
  const video=document.querySelector("video");
  if(!video)return false;
  video.currentTime=Math.max(0,Number(milliseconds||0)/1000);
  video.scrollIntoView({behavior:"smooth",block:"center"});
  if(video.paused)video.play().catch(()=>{});
  return true;
}
function send(message){if(typeof browser!=="undefined")return browser.runtime.sendMessage(message);return new Promise(resolve=>chrome.runtime.sendMessage(message,response=>resolve(chrome.runtime.lastError?{ok:false,error:chrome.runtime.lastError.message}:response)))}
function styles(){return `
:host{all:initial;color-scheme:dark;font-family:Arial,"Noto Sans KR",sans-serif}
*{box-sizing:border-box}
button,input{font:inherit}
.launch{position:fixed;right:20px;bottom:22px;z-index:2147483646;border:1px solid #00d88a;background:#101513;color:#00f29a;border-radius:8px;padding:11px 15px;font-size:12px;font-weight:700;box-shadow:0 10px 32px #0008;cursor:pointer}
.panel{position:fixed;right:20px;bottom:72px;z-index:2147483647;width:min(420px,calc(100vw - 24px));max-height:min(720px,calc(100vh - 100px));display:none;flex-direction:column;background:#17191c;color:#f0f1f2;border:1px solid #353940;border-radius:12px;box-shadow:0 24px 70px #000b;overflow:hidden}
.panel.open{display:flex}
.head{display:flex;align-items:center;justify-content:space-between;padding:17px 18px;border-bottom:1px solid #ffffff12}
.head strong{font-size:15px}.head span{display:block;margin-top:5px;color:#9198a1;font-size:10px;font-weight:400}
.close{border:0;background:transparent;color:#aeb4bb;font-size:21px;cursor:pointer}
.form{padding:16px 18px;border-bottom:1px solid #ffffff12}
.field{display:grid;grid-template-columns:1fr 120px;gap:8px}
input{width:100%;border:1px solid #3a3e44;border-radius:6px;background:#101214;color:#fff;padding:10px 11px;font-size:12px;outline:none}
input:focus{border-color:#00d88a}.actions{display:flex;gap:8px;margin-top:9px}
.primary,.cancel{border:0;border-radius:6px;padding:9px 12px;font-size:11px;font-weight:700;cursor:pointer}
.primary{background:#00d88a;color:#07140e;flex:1}.primary:disabled{opacity:.45;cursor:default}
.cancel{display:none;background:#30343a;color:#e2e5e8}.cancel.visible{display:block}
.status{min-height:34px;padding:11px 18px;color:#9ba2aa;font-size:10px;border-bottom:1px solid #ffffff0d}
.status.error{color:#ff8f96}
.results{overflow:auto;padding:0 18px 14px}
.empty{padding:36px 10px;text-align:center;color:#858c94;font-size:11px;line-height:1.8}
.result{display:grid;grid-template-columns:62px minmax(0,1fr);gap:10px;width:100%;padding:14px 0;border:0;border-bottom:1px solid #ffffff0d;background:transparent;color:inherit;text-align:left;cursor:pointer}
.result:hover .time,.result:focus-visible .time{color:#00f29a}
.time{font-family:monospace;color:#78c9aa;font-size:11px}
.message{font-size:12px;line-height:1.55;overflow-wrap:anywhere}.nick{display:block;color:#8e969f;font-size:9px;margin-top:6px}
mark{background:#00d88a33;color:#72f7bd;padding:0}
.foot{padding:10px 18px;color:#707780;font-size:9px;border-top:1px solid #ffffff0d}
@media(max-width:520px){.launch{right:12px;bottom:12px}.panel{right:12px;bottom:62px}.field{grid-template-columns:1fr}}
`}
function highlight(text,keyword){const source=String(text||""),needle=String(keyword||"");if(!needle)return escapeHtml(source);const lower=normalizeText(source),target=normalizeText(needle),at=lower.indexOf(target);if(at<0)return escapeHtml(source);return escapeHtml(source.slice(0,at))+"<mark>"+escapeHtml(source.slice(at,at+needle.length))+"</mark>"+escapeHtml(source.slice(at+needle.length))}
function mount(){
  if(document.getElementById(ROOT_ID)||!videoNoFromPath())return;
  const host=document.createElement("div");host.id=ROOT_ID;document.documentElement.append(host);
  const root=host.attachShadow({mode:"open"});
  root.innerHTML='<style>'+styles()+'</style><button class="launch" type="button">채팅 검색</button><section class="panel" role="dialog" aria-label="다시보기 채팅 검색"><header class="head"><div><strong>다시보기 채팅 검색</strong><span>관리자용 · 현재 VOD</span></div><button class="close" type="button" aria-label="닫기">×</button></header><form class="form"><div class="field"><input class="keyword" required placeholder="채팅 키워드" aria-label="채팅 키워드"><input class="nickname" placeholder="닉네임 선택" aria-label="닉네임 필터"></div><div class="actions"><button class="primary" type="submit">전체 채팅에서 검색</button><button class="cancel" type="button">중단</button></div></form><div class="status">키워드를 입력해 검색하세요.</div><div class="results"><div class="empty">검색 결과를 누르면 영상의 해당 시점으로 이동합니다.</div></div><footer class="foot">채팅은 서버에 저장하지 않고 현재 브라우저에서만 검색합니다.</footer></section>';
  const panel=root.querySelector(".panel"),launch=root.querySelector(".launch"),close=root.querySelector(".close"),form=root.querySelector("form"),cancel=root.querySelector(".cancel"),submit=root.querySelector(".primary"),status=root.querySelector(".status"),results=root.querySelector(".results");
  launch.onclick=()=>{panel.classList.toggle("open");if(panel.classList.contains("open"))root.querySelector(".keyword").focus()};
  close.onclick=()=>panel.classList.remove("open");
  cancel.onclick=()=>{searchRun++;status.textContent="검색을 중단했습니다.";cancel.classList.remove("visible");submit.disabled=false};
  results.onclick=event=>{const button=event.target.closest("[data-seek]");if(button&&!seekTo(button.dataset.seek)){status.textContent="영상 플레이어를 찾지 못했습니다.";status.classList.add("error")}};
  form.onsubmit=async event=>{
    event.preventDefault();const keyword=root.querySelector(".keyword").value.trim(),nickname=root.querySelector(".nickname").value.trim(),videoNo=videoNoFromPath();if(!keyword||!videoNo)return;
    const run=++searchRun,matches=[],seen=new Set();let cursor=0,pages=0,scanned=0;
    submit.disabled=true;cancel.classList.add("visible");status.classList.remove("error");results.innerHTML='<div class="empty">채팅을 불러오는 중입니다.</div>';
    while(run===searchRun&&pages<MAX_PAGES&&scanned<MAX_MESSAGES){
      const response=await send({type:"vodChatPage",videoNo,cursor});
      if(run!==searchRun)return;
      if(!response||!response.ok){status.textContent=response&&response.error||"채팅 요청에 실패했습니다.";status.classList.add("error");break}
      const chats=Array.isArray(response.chats)?response.chats:[];pages++;
      for(const chat of chats){const key=messageKey(chat);if(seen.has(key))continue;seen.add(key);scanned++;if(matchesChat(chat,keyword,nickname))matches.push(chat)}
      status.textContent=scanned.toLocaleString("ko-KR")+"개 채팅 확인 · "+matches.length.toLocaleString("ko-KR")+"개 일치 · "+formatVodTime(cursor);
      const next=response.nextCursor;if(next===null||next<=cursor||(!chats.length&&pages>1))break;cursor=next;
      if(pages%20===0)await new Promise(resolve=>setTimeout(resolve,80));
    }
    if(run!==searchRun)return;
    matches.sort((a,b)=>a.playerMessageTime-b.playerMessageTime);
    results.innerHTML=matches.length?matches.map(chat=>'<button class="result" type="button" data-seek="'+chat.playerMessageTime+'"><span class="time">'+formatVodTime(chat.playerMessageTime)+'</span><span class="message">'+highlight(chat.content,keyword)+'<span class="nick">'+escapeHtml(chat.nickname)+'</span></span></button>').join(""):(scanned?'<div class="empty">입력한 조건과 일치하는 채팅이 없습니다.</div>':'<div class="empty">채팅 데이터를 받지 못했습니다.<br>이 VOD에 채팅 다시보기가 있는지 확인해주세요.</div>');
    status.textContent=scanned?scanned.toLocaleString("ko-KR")+"개 채팅에서 "+matches.length.toLocaleString("ko-KR")+"개를 찾았습니다.":"확인한 채팅이 0개입니다.";
    cancel.classList.remove("visible");submit.disabled=false;
  };
}
function routeCheck(){if(location.pathname===lastPath)return;lastPath=location.pathname;searchRun++;document.getElementById(ROOT_ID)?.remove();mount()}
lastPath=location.pathname;mount();setInterval(routeCheck,1000);
})();
