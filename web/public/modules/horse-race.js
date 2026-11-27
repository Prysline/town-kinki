// GM-02: original source assets and 3 second automatic go, no client-side race RNG.
// The app remains the owner of the authenticated state and API transport.
export const HORSE_ROUND_MS=3000;
export const HORSE_IMAGES=Object.freeze({
  "◇ダンスパートナー":"danpa.gif","◇エアグルーヴ":"groove.gif","◇ビワハヤヒデ":"hayahide.gif",
  "◇イシノサンデー":"ishisun.gif","◇ジャングルポケット":"junpoke.gif","◇マンハッタンカフェ":"manhattan.gif",
  "◇ノーリーズン":"noreason.gif","◇オグリキャップ":"oguri.gif","◇サクラプレジデント":"sakura_predi.gif",
  "◇エアシャカール":"shakur.gif","◇ビワハイジ":"heidi.gif","◇ナリタブライアン":"brian.gif",
  "◇テイエムオーシャン":"tm_ocean.gif","◇トウカイテイオー":"tokai_teio.gif","◇ローマンエンパイア":"roman.gif"
});
export function horseBetSummary(tickets,cash){
  if(!Array.isArray(tickets)||tickets.length!==6||tickets.some(n=>!Number.isSafeInteger(n)||n<0))
    return {cost:0,reason:"馬券張數須為非負整數"};
  const total=tickets.reduce((sum,n)=>sum+n,0),cost=total*500;
  if(!Number.isSafeInteger(cost))return {cost:0,reason:"馬券張數超出安全範圍"};
  return {cost,reason:total===0?"尚未購買馬券":cash<cost?"現金不足":
    total>200?"最多購買200張馬券":tickets.filter(n=>n>0).length>2?"最多投注兩匹馬":null};
}
export function createHorseRaceUI({getState,request,money,applyState}){
  const el=id=>document.getElementById(id);
  const owner=()=>{const s=getState();return s?.character&&s?.user?JSON.stringify([s.mode,s.user.username,s.character.name]):null;};
  let ownerKey=null,visible=false,busy=false,timer=null,timerKey=null,pending=null,halted=false,error="",cardKey=null;
  const cancel=()=>{if(timer!==null)clearTimeout(timer);timer=null;timerKey=null;};
  const node=(tag,text)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;return e;};
  function readTickets(){return [...el("horse-race-card").querySelectorAll("input")].map(i=>i.value===""?0:Number(i.value));}
  function updateBet(){
    const s=getState();
    const summary=horseBetSummary(readTickets(),s?.character?.money??0);
    el("horse-race-cost").textContent="購買金額："+money(summary.cost)+(summary.reason?"｜"+summary.reason:"");
    el("horse-race-start").disabled=busy||Boolean(summary.reason)||!s?.horseRace?.available;
  }
  function drawCard(race){
    const key=race?race.id:null;
    if(cardKey===key)return;
    cardKey=key;const target=el("horse-race-card");target.replaceChildren();
    if(!race)return;
    race.card.forEach((horse,i)=>{
      const row=node("label");row.className="horse-race-bet-row";
      const title=node("span",horse.name+"｜"+horse.odds+" 倍");
      const input=node("input");input.type="number";input.min="0";input.max="200";input.step="1";
      input.value="0";input.name="horse-"+i;input.setAttribute("aria-label",horse.name+" 馬券張數");
      input.addEventListener("input",updateBet);
      row.append(title,input);target.append(row);
    });
  }
  function renderRank(rankings){
    const target=el("horse-race-ranking");target.replaceChildren();
    if(!rankings.length){target.append(node("p","目前沒有已完成的賽事紀錄。"));return;}
    const table=node("table"),head=node("thead"),header=node("tr");
    for(const value of ["居民","總損益","總投入","總獲得"])header.append(node("th",value));
    head.append(header);table.append(head);const body=node("tbody");
    for(const rank of rankings){
      const row=node("tr");
      for(const value of [rank.name,money(rank.profit),money(rank.spent),money(rank.won)])row.append(node("td",value));
      body.append(row);
    }
    table.append(body);target.append(table);
  }
  function renderTracks(race){
    const target=el("horse-race-tracks");target.replaceChildren();
    for(const horse of race.horses){
      const row=node("div");row.className="horse-race-lane";
      row.append(node("span",horse.name+"｜"+horse.odds+" 倍｜"+horse.tickets+" 張"));
      const track=node("div");track.className="horse-race-track";
      const course=node("div");course.className="horse-race-course";
      const progress=node("progress");progress.max=400;progress.value=horse.distance;
      progress.setAttribute("aria-label",horse.name+" 賽程");course.append(progress);
      const file=HORSE_IMAGES[horse.name];
      if(file){const image=node("img");image.src="/legacy-assets/uma/"+file;image.alt="";image.width=30;image.height=30;
        image.style.left=Math.max(0,Math.min(100,horse.distance/400*100))+"%";course.append(image);}
      track.append(course,node("span",horse.distance+" / 400"));row.append(track);target.append(row);
    }
  }
  function schedule(race){
    const key=ownerKey+":"+race.id+":"+race.turn;
    if(timerKey===key&&timer!==null)return;
    cancel();timerKey=key;
    timer=setTimeout(()=>{
      timer=null;timerKey=null;
      const latest=getState()?.horseRace?.active;
      if(!visible||busy||halted||!latest||latest.id!==race.id||latest.turn!==race.turn||owner()!==ownerKey)return;
      void send("step",{raceId:race.id,expectedTurn:race.turn});
    },HORSE_ROUND_MS);
  }
  function render(show=visible){
    const nextOwner=owner();
    if(nextOwner!==ownerKey){
      cancel();ownerKey=nextOwner;cardKey=null;pending=null;halted=false;error="";busy=false;
      for(const id of ["horse-race-card","horse-race-tracks","horse-race-ranking","horse-race-result","horse-race-error","horse-race-active-error","horse-race-active-status"])
        el(id).replaceChildren();
      el("horse-race-bets").hidden=true;
    }
    visible=Boolean(show&&ownerKey);
    const s=getState(),info=s?.horseRace,active=info?.active;
    el("horse-race-active-screen").hidden=!(visible&&active);
    if(!visible){cancel();return;}
    if(active){
      el("horse-race-active-status").textContent="第 "+active.turn+" 回合｜已購買 "+money(active.cost)+" 馬券";
      el("horse-race-active-error").textContent=error;
      el("horse-race-retry").hidden=!halted;el("horse-race-retry").disabled=busy;
      renderTracks(active);
      if(!busy&&!halted)schedule(active);else cancel();
      return;
    }
    cancel();
    const race=info?.latest;
    const available=Boolean(info?.available);
    el("horse-race-status").textContent=available?(info.busy?"目前已有賽事進行；請稍後再開始。":"請確認名單及購買張數。"):"所在城鎮沒有賽馬場。單機可透過街區編輯器配置原版競馬設施。";
    el("horse-race-quote").disabled=busy||!available;
    el("horse-race-quote").textContent=race?.status==="completed"?"再挑戰":"查看出賽名單";
    const quoted=available&&race?.status==="quoted"?race:null;
    drawCard(quoted);el("horse-race-bets").hidden=!quoted;
    if(quoted)updateBet();
    el("horse-race-error").textContent=error;
    const finishers=race?.horses?.filter(h=>h.distance===400)??[];
    el("horse-race-result").textContent=race?.status==="completed"?
      (finishers.length>1?"多匹馬同時抵達，經終點判定。":"")+race.winner+" 獲得第一名｜投入 "+money(race.cost)+"｜"+(race.payout===0?"未獲派彩":"獲得 "+money(race.payout)):
      race?.status==="forfeited"?"原賽事已棄權，馬券費用不退還。":"";
    renderRank(available?info.rankings:[]);
  }
  async function send(action,args){
    if(busy||!visible||!ownerKey)return;
    const expectedOwner=ownerKey,key=JSON.stringify([action,args]);
    if(!pending||pending.key!==key)pending={key,id:crypto.randomUUID()};
    const requestId=pending.id;
    busy=true;halted=false;error="";cancel();render();
    try{
      const next=await request("horse-race/"+action,{...args,requestId});
      if(owner()===expectedOwner&&visible){pending=null;applyState(next);}
    }catch(e){
      if(owner()===expectedOwner&&visible){
        error=e.message||"連線失敗";
        if(e.status>=400&&e.status<500)pending=null;
        if(action==="step")halted=true;
      }
    }finally{
      if(owner()===expectedOwner){busy=false;render();}
    }
  }
  async function retry(){
    if(busy||!visible||!halted)return;
    // If a response was lost, reuse the exact turn and id; server receipts deduplicate.
    const active=getState()?.horseRace?.active;
    if(pending&&active){await send("step",{raceId:active.id,expectedTurn:active.turn});return;}
    const expectedOwner=ownerKey;busy=true;render();
    try{
      const next=await request("state");
      if(owner()===expectedOwner&&visible){halted=false;error="";applyState(next);}
    }catch(e){if(owner()===expectedOwner)error=e.message||"連線失敗";}
    finally{if(owner()===expectedOwner){busy=false;render();}}
  }
  const open=()=>{if(getState()?.horseRace?.available&&!getState()?.horseRace?.active)void send("quote",{});};
  el("horse-race-quote").addEventListener("click",open);
  el("horse-race-bets").addEventListener("submit",event=>{
    event.preventDefault();
    const race=getState()?.horseRace?.latest,tickets=readTickets();
    if(race?.status==="quoted"&&!horseBetSummary(tickets,getState().character.money).reason)
      void send("start",{raceId:race.id,tickets});
  });
  el("horse-race-retry").addEventListener("click",retry);
  return {open,render,isBusy:()=>busy};
}
