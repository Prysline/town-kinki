import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {
  EVENT_ONLY_ITEM_NAMES_ZH_TW,displayEventDescription,displayGiftErrorMessage
} from "../public/event-gift-display-translations.js";
import {displayRetailItemName,displayRetailItemCategory}
  from "../public/retail-item-translations.js";
import {displayOriginalItemComment}
  from "../public/item-comment-translations.js";

const src=path=>readFileSync(new URL(path,import.meta.url),"utf8");
const effects=src("../src/event-effects.mjs");
const app=src("../public/app.js");
const gift=src("../src/gift-shop.mjs");
const html=src("../public/index.html");
const names=[
  ["英文解釈教室","英文解讀教室"],
  ["成り上がり","反敗為勝"],
  ["おばあちゃんの知恵袋","阿嬤的生活智慧"],
  ["フラフープ","呼拉圈"],
  ["谷保天満宮のお守り","谷保天滿宮護身符"],
  ["幸せを呼ぶ香水","招來幸福的香水"],
  ["バイアグラ","威而鋼"],
  ["損害保険","損害保險"],
  ["幸せの星砂","幸福星砂"],
  ["ミグ25","米格-25戰鬥機"]
];

test("原始隨機事件真正嵌入的10種日文道具名全部轉成繁中，事件效果與原始名稱留在後端",()=>{
  const actual=[...new Set([...effects.matchAll(/《([^》]+)》/g)].map(x=>x[1]))];
  assert.deepEqual(actual.sort(),names.map(x=>x[0]).sort());
  assert.equal(Object.keys(EVENT_ONLY_ITEM_NAMES_ZH_TW).length,2);
  for(const [name,zh] of names){
    assert.ok(effects.includes("《"+name+"》"),name);
    const description="使用《"+name+"》後增加 3 點。";
    assert.equal(displayEventDescription(description),"使用《"+zh+"》後增加 3 點。");
    assert.doesNotMatch(displayEventDescription(description),/[\u3040-\u30ff]/,name);
    assert.equal(displayRetailItemName(name),name in EVENT_ONLY_ITEM_NAMES_ZH_TW?name:zh);
  }
  assert.equal(displayEventDescription("擲到《玩家自訂名稱》"),"擲到《玩家自訂名稱》");
  assert.equal(displayEventDescription("空白事件文字"),"空白事件文字");
  assert.equal(displayEventDescription(null),"");
  assert.equal(effects.includes('usedItemName="成り上がり";'),true,
    "原始事件道具鍵仍供遊戲規則使用");
});

test("事件彈窗與歷史、禮品歷史與站內信，都在顯示邊界使用翻譯",()=>{
  assert.ok(app.includes('recent.title+"："+displayEventDescription(recent.description)'));
  assert.ok(app.includes('event.title+"："+displayEventDescription(event.description)'));
  assert.ok(app.includes('displayRetailItemName(event.name)+" ×"'));
  assert.ok(app.includes('displayRetailItemName(mail.giftName)+"」×"'));
  assert.ok(app.includes('displayGiftErrorMessage(error.message)'));
  assert.ok(app.includes('sourceLine:item.sourceLine,quantity:count,name:item.name'));
  assert.ok(app.includes('gift.textContent="禮品：「"+displayRetailItemName(mail.giftName)'));
  assert.ok(app.includes('sourceLine:item.sourceLine,'));
  assert.ok(gift.includes('sender.name+"さんからの贈り物です。"'),
    "後端必須仍保存來源日文後綴，不改原版 33 欄");
  assert.ok(gift.includes('received[29]=oldComment+"\\t"+sender.name+'));
});

test("已收禮品與回收商品的動態分類，以及送禮限制訊息，顯示繁中而不改原始類別",()=>{
  assert.equal(displayRetailItemCategory("ギフト商品"),"已收禮品");
  assert.equal(displayRetailItemCategory("リサイクル"),"回收商品");
  assert.equal(displayRetailItemCategory("ギフト"),"禮品");
  assert.equal(displayRetailItemCategory("自訂分類"),"自訂分類");
  assert.equal(displayGiftErrorMessage("只有已轉換或購入的「ギフト」可以寄送"),
    "只有已轉換或購入的「禮品」可以寄送");
  assert.equal(displayGiftErrorMessage("其他失敗原因"),"其他失敗原因");
  assert.ok(gift.includes('row.category!=="ギフト"'),
    "禮品原始分類鍵仍由後端判斷");
  assert.ok(gift.includes('row.category!=="ギフト"'));
  assert.ok(app.includes('/専門店限定商品|秘伝商品/.test(item.note??"")'),
    "批發限定商品限制仍以原始來源文案判斷");
});

test("收到禮品的原版附註採來源格式翻譯，寄件人與原始文字不改寫",()=>{
  const withNote="※専門店限定商品。\t寄件人さんからの贈り物です。";
  assert.equal(displayOriginalItemComment(withNote),
    "※專賣店限定商品。｜來自「寄件人」的禮物。");
  assert.equal(displayOriginalItemComment("\t寄件人さんからの贈り物です。"),
    "來自「寄件人」的禮物。");
  assert.equal(displayOriginalItemComment("測試備註\t原名ABCさんからの贈り物です。"),
    "測試備註｜來自「原名ABC」的禮物。");
  assert.equal(displayOriginalItemComment("測試備註\t寄件人さん的其他敘述"),
    "測試備註\t寄件人さん的其他敘述");
  assert.equal(displayOriginalItemComment("※専門店限定商品。"),"※專賣店限定商品。");
  assert.equal(displayOriginalItemComment("未知備註"),"未知備註");
});

test("玩家可見的地圖建築與說明區無假名，建築代碼與原始 API 識別仍保持原樣",()=>{
  assert.doesNotMatch(html,/[\u3040-\u30ff]/);
  for(const term of ["D5 優惠券兌換所","D7 釣場","D9 遊樂中心",
    "已收禮品","回收商店","自動販賣機","活力牛奶"]){
    assert.ok(html.includes(term),term);
  }
  for(const japanese of ["原版ギフト類別","原版「ギフト屋」","原版「リサイ」","「ゲーセン」遊樂中心"]){
    assert.ok(!app.includes(japanese),japanese);
  }
  assert.ok(app.includes('if(cell.key==="ギフト屋")renderGiftShop();'));
  assert.ok(app.includes('if(cell.key==="リサイ")renderRecycle();'));
  assert.ok(app.includes('const restricted=shop?.category==="スーパー"'));
});
