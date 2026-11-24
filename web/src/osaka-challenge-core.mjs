// 原版 obatyan.cgi 與 town_lib.pl::weekobalog/strongobalog。
// 不使用玩家私人檔或虛構的 NPC；來源未齊備時不得啟用正式入口。
import {randomInt} from "node:crypto";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {STAT_KEYS,decodeLegacyText} from "./engine.mjs";

export const OSAKA_MODES=Object.freeze(["week","strong"]);
const ATTACK_INDICES=Object.freeze([1,2,3,4,5,6,7,8,9,11,12,13,14,15,16,17]);
const safe=n=>Number.isSafeInteger(n)&&n>=0;
function draw(rng,n){
  const value=rng(n);
  if(!safe(value)||value>=n)throw new Error("大阪挑戰亂數超出範圍");
  return value;
}
export function parseOsakaRules(source){
  const attackStart=source.indexOf("sub kougekinaiyou {");
  const attackEnd=source.indexOf("sub iryoku_hantei {");
  const prizeStart=source.indexOf("sub get_itm{");
  if(attackStart<0||attackEnd<=attackStart||prizeStart<=attackEnd)throw new Error("大阪原版子程序缺漏");
  const attacks=[...source.slice(attackStart,attackEnd).matchAll(/if\s*\(\$battle_rand\s*==\s*(\d+)\)\s*\{[\s\S]*?&iryoku_hantei\s*\(@_\[0\],(\d+)\)/g)]
    .map(m=>[Number(m[1]),Number(m[2])]);
  if(attacks.length!==16||attacks.some(([attack,index],i)=>attack!==i+1||index!==ATTACK_INDICES[i]))
    throw new Error("大阪原版攻擊對照改變");
  const cash=[...source.slice(0,attackStart).matchAll(/\$kakeru_money\s*=\s*(\d+);/g)].map(m=>Number(m[1]));
  if(cash[0]!==300||cash[1]!==1000||
    !/foreach\s*\(1\.\.50\)/.test(source)||
    !/\$battle_rand\s*=\s*int\(rand\(16\)\)\+1/.test(source)||
    !/\$my_rand\s*=\s*int\(rand\(3\)\)/.test(source)||
    !/\$get_money\s*\*=\s*5/.test(source))
    throw new Error("大阪原版回合或結算規則改變");
  const rows=[...source.slice(prizeStart).matchAll(/'(ゲットアイテム<>[^']+)'/g)]
    .map(m=>{
      const fields=m[1].replace(/\\n$/,"").split("<>");
      if(fields.length===34&&fields[33]==="")fields.pop();
      if(fields.length!==33)throw new Error("大阪獎品欄位無法保存");
      // 兩個「おばちゃんの力」原始欄位有錯位／不明效果。不修成推測效果。
      const usableShape=fields[22]==="回"&&/^\d+$/.test(fields[21])&&
        /^(無|万能,\d+)$/.test(fields[9])&&
        STAT_KEYS.every((_,i)=>/^\d+$/.test(fields[i<7?i+2:i<14?i+3:i+4]));
      return Object.freeze({name:fields[1],rawFields:Object.freeze(fields),usableShape});
    });
  if(rows.length!==8)throw new Error("大阪原版獎品陣列數量改變");
  return Object.freeze({
    attackIndices:ATTACK_INDICES,attackLimit:50,originalDropChoices:3,
    week:Object.freeze({base:300,prizes:Object.freeze(rows.slice(0,4))}),
    strong:Object.freeze({base:1000,prizes:Object.freeze(rows.slice(4,8))})
  });
}
function validateStats(stats){
  if(!stats||!STAT_KEYS.every(key=>safe(stats[key])))throw new Error("大阪戰鬥能力資料無效");
}
export function osakaNpcEnergy(stats){
  validateStats(stats);
  const bodyEnergy=Math.trunc(stats.looks/12+stats.tairyoku/4+stats.kenkou/4+
    stats.speed/8+stats.power/8+stats.wanryoku/8+stats.kyakuryoku/8);
  const brainEnergy=Math.trunc(STAT_KEYS.slice(0,7).reduce((sum,key)=>sum+stats[key]/6,0));
  if(!safe(bodyEnergy)||!safe(brainEnergy))throw new Error("大阪 NPC 能量超出安全範圍");
  return {bodyEnergy,brainEnergy};
}
export function parseOsakaNpcRecord(filename,source){
  if(!/^[ws][1-5]log\.cgi$/.test(filename))throw new Error("只接受原版大阪 NPC 專用檔名");
  if(typeof source!=="string"||!source.trim())throw new Error("大阪 NPC 原始資料為空");
  const lines=source.trimEnd().split(/\r?\n/);
  if(lines.length!==1)throw new Error("大阪 NPC 原始資料行數錯誤");
  const fields=lines[0].split("<>");
  if(fields.length<43||!fields[1]||fields[1].length>100)throw new Error("大阪 NPC 原始欄位不足");
  const stats=Object.fromEntries(STAT_KEYS.map((key,i)=>{
    const value=fields[6+i];
    if(!/^\d+$/.test(value)||!safe(Number(value)))throw new Error("大阪 NPC 原始能力無效");
    return [key,Number(value)];
  }));
  const npc={sourceFile:filename,mode:filename[0]==="w"?"week":"strong",index:Number(filename[1]),name:fields[1],stats:Object.freeze(stats)};
  // 不回傳 ID、密碼、IP、銀行或私人角色欄。
  return Object.freeze({...npc,...osakaNpcEnergy(stats)});
}
export function loadOsakaNpcCatalog(repositoryRoot){
  const npcs=[],missing=[];
  for(const prefix of ["w","s"])for(let index=1;index<=5;index++){
    const filename=prefix+index+"log.cgi";
    try{
      const bytes=readFileSync(join(repositoryRoot,"member","osaka",filename));
      npcs.push(parseOsakaNpcRecord(filename,decodeLegacyText(bytes)));
    }catch(error){
      if(error.code!=="ENOENT")throw error;
      missing.push("member/osaka/"+filename);
    }
  }
  // 不允許以部分池、零能力或其他玩家替代五名原版 NPC。
  return {available:missing.length===0,npcs:missing.length?[]:npcs,missing};
}
export function simulateOsaka({rules,mode,player,npc,rng=randomInt}){
  if(!OSAKA_MODES.includes(mode)||npc.mode!==mode)throw new Error("大阪 NPC 難度不符");
  validateStats(player.stats);validateStats(npc.stats);
  if(![player.bodyEnergy,player.brainEnergy,player.money].every(safe))throw new Error("大阪玩家資產或能量無效");
  const p={bodyEnergy:player.bodyEnergy,brainEnergy:player.brainEnergy},m=osakaNpcEnergy(npc.stats);
  const initial={player:{...p},npc:{...m}};
  let playerTurn=player.stats.speed>npc.stats.speed,outcome="draw",defeatedEnergy=null;
  const rounds=[];
  for(let turn=1;turn<=rules.attackLimit;turn++){
    const attack=draw(rng,16)+1,stat=STAT_KEYS[rules.attackIndices[attack-1]-1];
    const energy=attack<=8||attack===14?"brainEnergy":"bodyEnergy";
    const attacker=playerTurn?player.stats:npc.stats,defender=playerTurn?npc.stats:player.stats;
    const damage=Math.max(0,attacker[stat]-defender[stat]);
    const target=playerTurn?m:p;
    target[energy]-=damage;
    rounds.push({turn,actor:playerTurn?"player":"npc",attack,stat,energy,damage,player:{...p},npc:{...m}});
    if(m.bodyEnergy<=0){outcome="win";defeatedEnergy="bodyEnergy";break;}
    if(m.brainEnergy<=0){outcome="win";defeatedEnergy="brainEnergy";break;}
    if(p.bodyEnergy<=0){outcome="loss";defeatedEnergy="bodyEnergy";break;}
    if(p.brainEnergy<=0){outcome="loss";defeatedEnergy="brainEnergy";break;}
    playerTurn=!playerTurn;
  }
  const base=rounds.length*rules[mode].base;
  // 相容性修正（使用者確認）：obatyan.cgi 兩處 rand(3) 與各四筆獎品及
  // 「準備して有る数」註解不一致。保留原版範圍作來源紀錄，Web 依陣列長度均勻抽選。
  const prizes=rules[mode].prizes;
  const prizeIndex=outcome==="win"?draw(rng,prizes.length):null;
  const originalCashDelta=outcome==="win"?base*5:outcome==="loss"?-base:0;
  // 原版直接扣現金；Web 沿用 B 聯賽非負現金安全界線，另保存原始差額。
  const money=Math.max(0,player.money+originalCashDelta);
  if(!safe(money))throw new Error("大阪挑戰現金超出安全範圍");
  p.bodyEnergy=Math.max(0,p.bodyEnergy);p.brainEnergy=Math.max(0,p.brainEnergy);
  return {mode,npc:{...npc},initial,rounds,outcome,defeatedEnergy,player:{...p,money},
    originalCashDelta,moneyDelta:money-player.money,prizeIndex,
    prize:prizeIndex===null?null:prizes[prizeIndex]};
}
export function rollOsaka({rules,mode,player,catalog,rng=randomInt}){
  if(!OSAKA_MODES.includes(mode)||!catalog.available)throw new Error("大阪原版 NPC 資料尚未完整");
  const pool=catalog.npcs.filter(npc=>npc.mode===mode);
  if(pool.length!==5||new Set(pool.map(npc=>npc.index)).size!==5)
    throw new Error("大阪 NPC 難度池不完整");
  return simulateOsaka({rules,mode,player,npc:pool[draw(rng,5)],rng});
}
