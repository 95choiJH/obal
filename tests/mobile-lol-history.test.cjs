const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('mobile/lol.js','utf8');
const code=source.slice(source.indexOf('function score('),source.indexOf('function trend('));
const context=vm.createContext({tiers:["IRON","BRONZE","SILVER","GOLD","PLATINUM","EMERALD","DIAMOND","MASTER","GRANDMASTER","CHALLENGER"],num:v=>v===null||v===undefined||v===""?null:Number.isFinite(Number(v))?Number(v):null});
vm.runInContext(code,context);
const row=(at,lp,extra={})=>({tier_after:"DIAMOND",rank_after:"IV",lp_after:lp,metadata:{rankCapturedAt:at},...extra});
test('trend excludes overwritten legacy rows and unknown LP but retains zero LP',()=>{const result=context.points([row("2026-09-18T01:00:00Z",0),row("2026-09-18T02:00:00Z",null),row("",50),row("invalid",10),row("2026-09-18T03:00:00Z",20)]);assert.equal(result.length,2);assert.equal(result[1].value-result[0].value,20)});
test('tier promotion remains continuous across divisions',()=>{assert.equal(context.score(row("",5,{tier_after:"DIAMOND",rank_after:"IV"}))-context.score(row("",95,{tier_after:"EMERALD",rank_after:"I"})),10);assert.equal(context.score(row("",null)),null);assert.equal(context.score(row("",5,{rank_after:"?"})),null)});
test('capture timestamps are ordered and duplicated captures do not create extra points',()=>{const at="2026-09-18T03:00:00Z";const points=context.points([row(at,30),row("2026-09-18T01:00:00Z",0),row(at,30)]);assert.equal(points.length,2);assert.equal(points[0].value,2400);assert.equal(points[1].value,2430)});
