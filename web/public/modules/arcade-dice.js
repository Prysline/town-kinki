// 骰子畫面與操作；全域 state、API、時鐘及通知仍由 app 擁有。
export function createArcadeDiceUI({getState,replaceState,api,render,notify,el,text,money,browserGameNow}){
  let pendingArcadeDice=null;
  let arcadeDiceSubmitting=false;
  async function submitArcadeDice(guess,stake){
    if(arcadeDiceSubmitting)return;
    if(!window.confirm("確認下注 "+money(stake)+"，猜兩顆骰子總和是"+
        (guess==="even"?"偶數":"奇數")+"嗎？猜中增加下注額，猜錯扣除同額。"))return;
    const key=guess+":"+stake;
    if(!pendingArcadeDice||pendingArcadeDice.key!==key)
      pendingArcadeDice={key,requestId:crypto.randomUUID()};
    arcadeDiceSubmitting=true;
    el("arcade-dice-submit").disabled=true;
    try{
      replaceState(await api("arcade/dice/play",{
        guess,stake,requestId:pendingArcadeDice.requestId
      }));
      const result=getState().arcadeDiceResult;
      pendingArcadeDice=null;
      render();
      notify(result.replayed?
        "這局骰子遊戲已結算，不會重複扣款或領獎。":
        "骰子結果："+result.dieOne+" ＋ "+result.dieTwo+" ＝ "+result.total+
        "（"+(result.total%2===0?"偶數":"奇數")+"）。"+
        (result.won?"猜中了，獲得 ":"猜錯了，扣除 ")+money(result.stake)+"。");
    }catch(error){notify(error.message,true);}
    finally{
      arcadeDiceSubmitting=false;
      if(getState()?.character)renderArcadeDice();
    }
  }

  function renderArcadeDice(){
    if(!getState()?.character)return;
    const info=getState().arcadeDice??{};
    const available=info.available===true;
    const remain=Math.max(0,(info.readyAt??0)-browserGameNow());
    text("arcade-dice-status",!available?
      "目前城鎮沒有遊樂中心；可使用單機地圖編輯器放置。":
      remain>0?"骰子遊戲冷卻中，還需 "+Math.ceil(remain/1000)+" 秒（單機可快轉遊戲時間）。":
        "遊樂中心已開放，現在可以擲骰。");
    const stake=el("arcade-dice-stake"),previous=stake.value;
    stake.replaceChildren();
    for(const amount of info.rates??[]){
      const option=document.createElement("option");
      option.value=String(amount);
      option.textContent=money(amount);
      stake.append(option);
    }
    if((info.rates??[]).some(x=>String(x)===previous))stake.value=previous;
    const guess=el("arcade-dice-guess"),submit=el("arcade-dice-submit");
    function update(){
      const amount=Number(stake.value);
      const valid=(info.rates??[]).includes(amount);
      const affordable=valid&&amount<=getState().character.money;
      text("arcade-dice-quote",!valid?"請選擇原版下注額。":
        "下注 "+money(amount)+"｜猜中增加 "+money(amount)+"，猜錯扣除同額"+
        (!affordable?"｜現金不足":""));
      submit.disabled=arcadeDiceSubmitting||!available||remain>0||!affordable;
    }
    stake.onchange=update;guess.onchange=update;
    submit.onclick=()=>{
      const value=guess.value,amount=Number(stake.value);
      if((value==="odd"||value==="even")&&(info.rates??[]).includes(amount)&&
         available&&remain<=0&&amount<=getState().character.money)
        submitArcadeDice(value,amount);
    };
    update();
    const history=el("arcade-dice-history");history.replaceChildren();
    const rounds=info.history??[];
    const newest=rounds[0];
    text("arcade-dice-result",newest?
      "最近一次："+newest.dieOne+" ＋ "+newest.dieTwo+" ＝ "+newest.total+
      "，"+(newest.won?"獲勝 +":"失敗 −")+money(newest.stake):"尚無擲骰紀錄。");
    if(!rounds.length){
      const empty=document.createElement("p");empty.className="small";
      empty.textContent="尚未進行骰子遊戲。";history.append(empty);
    }else{
      const list=document.createElement("ol");list.className="health-event-list";
      for(const round of rounds){
        const li=document.createElement("li");
        li.textContent=new Date(round.playedAt).toLocaleString("zh-TW")+
          "｜猜"+(round.guess==="even"?"偶數":"奇數")+
          "｜"+round.dieOne+" + "+round.dieTwo+" = "+round.total+
          "｜"+(round.won?"獲勝 +":"失敗 −")+money(round.stake);
        list.append(li);
      }
      history.append(list);
    }
  }
  return {renderArcadeDice};
}
