(() => {
"use strict";
const isLol=document.body.dataset.view==="lol";
const header=document.querySelector("[data-mobile-header]");
header.innerHTML='<a class="brand" href="./index.html" aria-label="오뱅알 홈"><img class="brand-icon" src="../icons/icon48.png" alt=""></a><div class="topbar-actions"><p class="topbar-updated" id="updatedLabel">최신 데이터를 확인하고 있습니다.</p><button class="icon-button" type="button" id="infoBtn" aria-label="소식 및 정보" title="소식 및 정보"'+(isLol?' hidden':'')+'><span aria-hidden="true">i</span></button><button class="icon-button" type="button" id="refreshBtn" aria-label="새로고침" title="새로고침"><span aria-hidden="true">↻</span></button></div>';
const tabs=document.querySelector("[data-mobile-tabs]");
if(isLol && tabs) tabs.innerHTML='<a href="index.html"'+(!isLol?' aria-current="page"':'')+'>방송 일정</a><a href="lol.html"'+(isLol?' aria-current="page"':'')+'>롤 전적</a>';
})();