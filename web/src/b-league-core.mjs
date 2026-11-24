// battle.cgi::bb / kougekibb / iryoku_hanteibb; no browser-controlled outcomes.
import {randomInt} from "node:crypto";
export const ARENA_SYMBOL="Ｂリーグ";
export const ARENA_RANKS=Object.freeze(["s","a","b","c","d"]);
export const DEFAULT_NAMES=Object.freeze({"武器":"素手","防具":"洋服","魔法":"念力","御守":"先祖の霊"});
export const DROP_NAMES=Object.freeze(["薬草","上薬草","特薬草","秘伝薬草"]);
const safe=n=>Number.isSafeInteger(n)&&n>=0;
function integer(s){if(!/^\d+$/.test(s)||!safe(Number(s)))throw new Error("怪物數值無效");return Number(s);}
export function parseArenaCatalog(source){
  const monsters=[];
  for(const [i,line] of source.split(/\r?\n/).entries()){
    if(!line.trim())continue;
    const f=line.split("<>");
    if(i===0&&f[0]==="ランク")continue;
    if(!ARENA_RANKS.includes(f[0])||f.length<11||!f[2])throw new Error("怪物資料格式錯誤");
    const drops=[integer(f[5]),integer(f[6])];
    if(drops.some((n,j)=>DROP_NAMES[n]!==f[7+j]))throw new Error("原版怪物獎品不符");
    const brainEnergy=integer(f[9]),bodyEnergy=integer(f[10]);
    if(!brainEnergy||!bodyEnergy)throw new Error("怪物能量無效");
    monsters.push(Object.freeze({sourceLine:i+1,rank:f[0],originalId:f[1],name:f[2],money:integer(f[4]),drops:Object.freeze(drops),brainEnergy,bodyEnergy}));
  }
  if(ARENA_RANKS.some(rank=>!monsters.some(m=>m.rank===rank)))throw new Error("怪物難度資料不完整");
  return Object.freeze(monsters);
}
export function defaultGear(type){return {type,name:DEFAULT_NAMES[type],power:0,accuracy:50,uses:null,level:1,experience:0,id:null};}
function draw(rng,n){
  if(!Number.isSafeInteger(n)||n<1)throw new Error("戰鬥亂數範圍無效");
  const x=rng(n);
  if(!Number.isInteger(x)||x<0||x>=n)throw new Error("戰鬥亂數無效");
  return x;
}
function validateGear(g,type){
  if(g.type!==type||![g.power,g.accuracy,g.experience].every(safe)||!safe(g.level)||g.level<1||
      (g.id!=null&&(!safe(g.id)||!safe(g.uses))))throw new Error("裝備戰鬥資料無效");
}
export function simulateArena({player,monster,equipped=[],defaults={},rng=randomInt}){
  if(![player.bodyEnergy,player.brainEnergy,player.speed,player.money,player.kpoint,monster.bodyEnergy,monster.brainEnergy,monster.money].every(safe))
    throw new Error("戰鬥能力或資產無效");
  const p={bodyEnergy:player.bodyEnergy,brainEnergy:player.brainEnergy};
  const m={bodyEnergy:monster.bodyEnergy,brainEnergy:monster.brainEnergy};
  const initial={player:{...p},monster:{...m}};
  const gear={},storedDefaults={},changed=new Map();
  for(const type of Object.keys(DEFAULT_NAMES)){
    const fallback={...defaultGear(type),...defaults[type]};
    validateGear(fallback,type);
    storedDefaults[type]=fallback;
    const owned=equipped.find(x=>x.type===type);
    gear[type]=owned?{...owned}:fallback;
    validateGear(gear[type],type);
  }
  let playerTurn=player.speed>monster.bodyEnergy;
  let outcome="draw",defeatedEnergy=null;
  const rounds=[];
  for(let turn=1;turn<=50;turn++){
    const mental=draw(rng,2)===0, energy=mental?"brainEnergy":"bodyEnergy";
    const type=playerTurn?(mental?"魔法":"武器"):(mental?"御守":"防具");
    const g=gear[type],roll=draw(rng,100)+1;
    const before={...g};
    let base=0,damage=0,used=false,broken=false,leveled=false;
    if(playerTurn){
      // Perl rand(0) behaves as rand(1); +1 gives 1.
      base=draw(rng,Math.max(1,Math.trunc(p[energy]/10)))+1;
      if(roll<g.accuracy){damage=base+g.power;used=true;}
    }else{
      base=Math.trunc(m[energy]/10);
      if(roll>=g.accuracy){damage=Math.max(0,base-g.power);used=true;}
    }
    if(used){
      if(g.id!=null)g.uses=Math.max(0,g.uses-1);
      g.experience++;
      if(g.experience>=g.level*10){
        g.level++;g.experience=0;g.power+=g.level;leveled=true;
        if(draw(rng,g.level)===0)g.accuracy+=g.level;
      }
      if(g.id!=null){
        broken=g.uses===0;
        changed.set(g.id,{...g,broken});
        if(broken){storedDefaults[type]=defaultGear(type);gear[type]=storedDefaults[type];}
      }
      validateGear(g,type);
    }
    if(!safe(damage))throw new Error("戰鬥傷害超出安全範圍");
    const target=playerTurn?m:p;
    target[energy]-=damage;
    rounds.push({turn,actor:playerTurn?"player":"monster",energy,type,gear:before.name,roll,base,damage,used,broken,leveled,player:{...p},monster:{...m}});
    // Original precedence: monster body, monster brain, player body, player brain.
    if(m.bodyEnergy<=0){outcome="win";defeatedEnergy="bodyEnergy";break;}
    if(m.brainEnergy<=0){outcome="win";defeatedEnergy="brainEnergy";break;}
    if(p.bodyEnergy<=0){outcome="loss";defeatedEnergy="bodyEnergy";break;}
    if(p.brainEnergy<=0){outcome="loss";defeatedEnergy="brainEnergy";break;}
    playerTurn=!playerTurn;
  }
  p.bodyEnergy=Math.max(0,p.bodyEnergy);p.brainEnergy=Math.max(0,p.brainEnergy);
  const dropIndex=monster.drops[draw(rng,10)===0?1:0];
  const special=draw(rng,5)===0;
  let money=player.money,kpoint=player.kpoint,drop=null;
  if(outcome==="win"){money+=monster.money;kpoint+=special?3:1;if(special)drop=dropIndex;}
  else if(outcome==="loss"){money=special?Math.trunc(money/2):Math.max(0,money-monster.money);}
  else if(special)money+=monster.money;
  // Web safety: no negative cash; keep the actual change in the receipt.
  if(!safe(money)||!safe(kpoint))throw new Error("戰鬥結算超出安全範圍");
  return {initial,monster: {...monster},rounds,outcome,defeatedEnergy,special,
    player:{...p,money,kpoint},moneyDelta:money-player.money,kpointDelta:kpoint-player.kpoint,
    drop,changedGear:[...changed.values()],defaults:storedDefaults};
}
export function rollArena(catalog,rank,player,options={}){
  if(!ARENA_RANKS.includes(rank))throw new Error("無效的鬥技場難度");
  const pool=catalog.filter(m=>m.rank===rank),rng=options.rng??randomInt;
  if(!pool.length)throw new Error("找不到原版怪物");
  return simulateArena({player,monster:pool[draw(rng,pool.length)],...options,rng});
}
