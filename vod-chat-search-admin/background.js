"use strict";
const api=typeof browser!=="undefined"?browser:chrome;
const MAX_VIDEO_NO_LENGTH=20;
function validVideoNo(value){return /^[0-9]{1,20}$/.test(String(value||""))}
function normalizeCursor(value){const number=Number(value);return Number.isFinite(number)&&number>=0?Math.floor(number):0}
function normalizeChat(chat){
  const parse=value=>{if(!value)return{};if(typeof value==="object")return value;try{return JSON.parse(value)}catch(_error){return{}}};
  const profile=parse(chat&&chat.profile),extras=parse(chat&&chat.extras);
  return {
    content:String(chat&&chat.content||""),
    nickname:String(profile.nickname||profile.userNickname||extras.nickname||"알 수 없음"),
    userIdHash:String(chat&&chat.userIdHash||profile.userIdHash||""),
    playerMessageTime:normalizeCursor(chat&&chat.playerMessageTime),
    messageTime:normalizeCursor(chat&&chat.messageTime)
  };
}
async function fetchVodChatPage(videoNo,cursor){
  if(!validVideoNo(videoNo))return{ok:false,error:"올바른 다시보기 번호가 아닙니다."};
  const url="https://api.chzzk.naver.com/service/v1/videos/"+encodeURIComponent(videoNo)+"/chats?count=200&playerMessageTime="+normalizeCursor(cursor);
  for(let attempt=1;attempt<=3;attempt++)try{
    const controller=new AbortController();
    const timeout=setTimeout(()=>controller.abort(),15000);
    let response;
    try{response=await fetch(url,{credentials:"include",signal:controller.signal,headers:{Accept:"application/json","Front-Client-Platform-Type":"PC","Front-Client-Product-Type":"web"}})}finally{clearTimeout(timeout)}
    if((response.status===429||response.status>=500)&&attempt<3){await new Promise(resolve=>setTimeout(resolve,attempt*1000));continue}
    if(!response.ok)return{ok:false,status:response.status,error:response.status===404?"채팅 다시보기를 찾을 수 없습니다.":"채팅 요청 실패 (HTTP "+response.status+")"};
    const payload=await response.json();
    if(payload&&Number(payload.code)&&Number(payload.code)!==200)return{ok:false,error:String(payload.message||"채팅 요청이 거부되었습니다.")};
    const content=payload&&payload.content;
    if(!content)return{ok:false,error:"채팅 데이터가 제공되지 않는 다시보기입니다."};
    const chats=[...(Array.isArray(content.previousVideoChats)?content.previousVideoChats:[]),...(Array.isArray(content.videoChats)?content.videoChats:[])].map(normalizeChat);
    const next=content.nextPlayerMessageTime;
    return{ok:true,chats,nextCursor:next===null||next===undefined?null:normalizeCursor(next)};
  }catch(error){
    if(attempt<3){await new Promise(resolve=>setTimeout(resolve,attempt*1000));continue}
    return{ok:false,error:error&&error.name==="AbortError"?"채팅 서버 응답이 없어 검색을 중단했습니다. 잠시 후 다시 시도해주세요.":"채팅을 불러오지 못했습니다. "+String(error&&error.message||error)}
  }
}
api.runtime.onMessage.addListener((message,_sender,sendResponse)=>{
  if(message&&message.type==="vodChatPage"){
    fetchVodChatPage(message.videoNo,message.cursor).then(sendResponse);
    return true;
  }
});
