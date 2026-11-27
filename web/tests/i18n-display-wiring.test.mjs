import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
import {decodeLegacyText,parseLegacyJobs,jobEligibility} from "../src/engine.mjs";
import {displayJobName,displayGameError,displayBankLedgerAction} from "../public/game-display-translations.js";
import {displayEventDescription} from "../public/event-gift-display-translations.js";
import {displayRetailItemName} from "../public/retail-item-translations.js";
import {SANTA_FIGHT_ITEMS,SANTA_FIGHT_NAMES,RIVER_ITEMS} from "../src/event-santa-fight.mjs";
const read=path=>readFileSync(new URL(path,import.meta.url),"utf8");
const legacy=path=>decodeLegacyText(readFileSync(new URL(path,import.meta.url)));
const app=read("../public/app.js");
const jobsUI=read("../public/modules/jobs.js");
const kana=/[\u3040-\u30ff\u31f0-\u31ff]/;
test("150 職業、99 前置條件與錯誤訊息共用譯名，仍以原名判定精通",()=>{
  const jobs=parseLegacyJobs(legacy("../../dat_dir/job.cgi"));
  assert.equal(jobs.length,150);
  const before=JSON.stringify(jobs);
  const advanced=jobs.filter(job=>job.previousJob);
  assert.equal(advanced.length,99);
  for(const job of jobs)assert.equal(displayJobName(job.originalName,jobs),job.name);
  for(const job of advanced){
    const prerequisite=jobs.find(j=>j.originalName===job.previousJob);
    assert.ok(prerequisite,job.previousJob);
    const reason=jobEligibility({masteredJob:null},job);
    assert.equal(reason,"需先精通："+job.previousJob);
    assert.equal(displayGameError(reason,jobs),"需先精通："+prerequisite.name);
    assert.doesNotMatch(displayGameError(reason,jobs),kana);
  }
  assert.equal(JSON.stringify(jobs),before);
  assert.equal(displayJobName(null,jobs),null);
  assert.equal(displayJobName("未收錄名稱",jobs),"未收錄名稱");
  for(const connection of [
    'status.push(["前置精通",displayJobName(job.previousJob,state.jobs),',
    'state.character.masteredJob!==job.previousJob',
    '"尚未解鎖："+displayGameError(job.reason,state.jobs)'
  ])assert.ok(jobsUI.includes(connection),connection);
  assert.ok(jobsUI.includes('import {displayJobName,displayGameError} from "../game-display-translations.js";'));
  assert.ok(app.includes('const {renderJobs}=createJobsUI({getState:()=>state,el,text,money,labels,action});'));
  for(const connection of [
    'text("mastered-job", displayJobName(c.masteredJob,state.jobs) || "無");',
    'if(error)message=displayGameError(message,state?.jobs);',
    '["credit:"+c.sourceLine,displayRetailItemName(c.name)+"（銀行付款）"]'
  ])assert.ok(app.includes(connection),connection);
});
test("兩則玩家商店錯誤與既有銀行帳簿品名只轉換顯示，玩家名字不改",()=>{
  assert.equal(displayGameError("住宅室內未啟用「お店」內容，無法經營商店"),"住宅室內未啟用「玩家商店」內容，無法經營商店");
  assert.equal(displayGameError("請先在住宅室內設定「お店」欄位"),"請先在住宅室內設定「玩家商店」欄位");
  assert.equal(displayGameError("其他錯誤"),"其他錯誤");
  for(const [prefix,zh] of [["問屋進貨：","問屋進貨："],["問屋退貨：","問屋退貨："],["玩家商店信用付款：","玩家商店信用付款："],["店鋪出售：","店鋪出售："],["百貨信用付款：","百貨信用付款："],["自販機信用付款：","自動販賣機信用付款："]]){
    assert.equal(displayBankLedgerAction(prefix+"クレジットカード"),zh+"信用卡");
  }
  assert.equal(displayBankLedgerAction("教室信用付款（受講料）"),"教室信用付款（學費）");
  assert.equal(displayBankLedgerAction("轉帳給：コンビニ店員"),"轉帳給：コンビニ店員");
  assert.ok(app.includes('displayBankLedgerAction(item.action)'));
});
test("六種聖誕獎品成功、容量不足及舊歷史都用共用品名；河中書名保持原規則",()=>{
  for(const [i,row] of SANTA_FIGHT_ITEMS.entries()){
    const original=row[1],label=SANTA_FIGHT_NAMES[i],zh=displayRetailItemName(original),amount=row[21];
    assert.doesNotMatch(zh,kana);
    assert.equal(displayEventDescription("擊敗聖誕老人，獲得"+label+"（"+original+"），耐久增加 "+amount+" 次。"),"擊敗聖誕老人，獲得"+zh+"，耐久增加 "+amount+" 次。");
    assert.equal(displayEventDescription("擊敗聖誕老人，但持有物已達 25 格，未取得"+label+"。"),"擊敗聖誕老人，但持有物已達 25 格，未取得"+zh+"。");
    assert.equal(displayEventDescription("擊敗聖誕老人，抽中"+label+"。"),"擊敗聖誕老人，抽中"+zh+"。");
  }
  assert.equal(displayRetailItemName("等身大サンタさん人形"),"真人大小聖誕老人玩偶");
  for(const row of RIVER_ITEMS)assert.equal(displayEventDescription("取得《"+row[1]+"》，耐久增加 "+row[21]+" 次。"),"取得《"+displayRetailItemName(row[1])+"》，耐久增加 "+row[21]+" 次。");
  assert.equal(displayEventDescription("玩家自訂（悪魔の笛）"),"玩家自訂（悪魔の笛）");
  assert.ok(app.includes('recent.title+"："+displayEventDescription(recent.description)'));
  assert.ok(app.includes('event.title+"："+displayEventDescription(event.description)'));
});
test("百貨與背包共用效果描述：451 筆原始商品效果全覆蓋，未知代碼保留原文",()=>{
  const start=app.indexOf("function describeOriginalRetailEffect(code){"),end=app.indexOf("function retailEffectDetails(item){",start);
  assert.ok(start>=0&&end>start);
  const describe=runInNewContext(app.slice(start,end)+"\ndescribeOriginalRetailEffect;");
  const rows=legacy("../../dat_dir/syouhin.cgi").split(/\r?\n/).slice(1).filter(line=>line.includes("<>")).map(line=>line.split("<>"));
  assert.equal(rows.length,451);
  for(const row of rows)assert.doesNotMatch(describe(row[9]),kana,row[1]);
  assert.equal(describe("ウエイトアップ,1"),"增加體重 1 kg");
  assert.match(describe("風邪,7,ギフト"),/感冒時改善疾病指數 7.*禮品/);
  assert.match(describe("万能,5,ギフト"),/疾病指數改善 5.*禮品/);
  assert.match(describe("クレジット"),/信用卡付款功能/);
  assert.match(describe("ファ"),/速食/);
  assert.match(describe("食料品"),/食品/);
  assert.match(describe("未確認コード"),/未確認コード.*尚未將此代碼解讀成確定效果/);
  assert.ok(app.includes("lines.push(describeOriginalRetailEffect(info.effectCode))"));
  assert.ok(app.includes("primary.push(describeOriginalRetailEffect(info.effectCode))"));
});
