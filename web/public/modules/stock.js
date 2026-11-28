const NAMES={A:"大阪股",B:"滋賀股",C:"兵庫股",D:"奈良股",E:"近畿股"};
const KINDS={boom:"景氣上升",recession:"景氣下跌","product-success":"新商品成功","product-failure":"新商品失敗"};
const text=(id,v)=>{document.getElementById(id).textContent=String(v);};
export function createStockUI({api,getState,applyState,money,notify}){
  const el=id=>document.getElementById(id);
  let owner=null,opened=false,busy=false,pending=null;
  function render(){
    const state=getState(),stock=state?.stock;
    const nextOwner=state?.character?.name??null;
    if(owner!==nextOwner){owner=nextOwner;opened=false;pending=null;}
    if(!stock){el("stock-panel").hidden=true;text("stock-ticker","");return;}
    text("stock-ticker",stock.holdings.map(h=>NAMES[h.key]+" "+money(h.price)).join("　"));
    el("stock-panel").hidden=!stock.available;
    if(!stock.available)opened=false;
    el("stock-controls").hidden=!opened;
    el("stock-open").disabled=busy;
    for(const id of ["stock-buy","stock-sell","stock-clear","stock-key","stock-quantity"])el(id).disabled=busy||!opened;
    text("stock-wallet","現金 "+money(state.character.money)+" ／ 普通存款 "+money(state.character.bank));
    text("stock-total","持股市值 "+money(stock.marketValue)+" ／ 累計損益 "+money(stock.cumulativeNet));
    const table=el("stock-holdings");table.replaceChildren();
    for(const h of stock.holdings){
      const tr=document.createElement("tr");
      for(const value of [NAMES[h.key],money(h.price),h.shares,h.remaining,money(h.average),money(h.unrealized),money(h.invested),money(h.recovered),money(h.net)]){
        const td=document.createElement("td");td.textContent=value;tr.append(td);
      }
      table.append(tr);
    }
    const write=(id,rows,format)=>{
      const list=el(id);list.replaceChildren();
      for(const row of rows){const li=document.createElement("li");li.textContent=format(row);list.append(li);}
      if(!rows.length){const li=document.createElement("li");li.textContent="尚無紀錄";list.append(li);}
    };
    write("stock-history",stock.history,r=>r.action==="clear"?"全部持股清算 "+money(r.amount):
      (r.action==="buy"?"買入":"賣出")+" "+NAMES[r.key]+" "+r.quantity+" 股，"+money(r.amount)+"；預估損益 "+money(r.projectedNet));
    write("stock-market-history",stock.marketHistory,r=>r.actorName+"："+KINDS[r.kind]+"，"+r.changes.map(c=>NAMES[c.key]+" "+(c.delta>=0?"+":"")+money(c.delta)+(c.acquired?"（收購整合）":"")).join("、"));
  }
  async function submit(action){
    if(busy||!getState()?.stock?.available||action!=="open"&&!opened)return;
    const key=["buy","sell"].includes(action)?el("stock-key").value:null;
    const quantity=key?Number(el("stock-quantity").value):0;
    if(key&&(!Number.isSafeInteger(quantity)||quantity<0||quantity>200))return notify("請輸入 0 至 200 股。",true);
    if(action==="clear"&&!window.confirm("將按目前行情出售全部持股並清除個人交易紀錄，確定清算？"))return;
    const args={action,key,quantity};
    const signature=JSON.stringify(args);
    if(!pending||pending.signature!==signature||pending.owner!==owner)
      pending={signature,owner,requestId:crypto.randomUUID()};
    busy=true;render();
    try{
      const next=await api("stock/access",{...args,requestId:pending.requestId});
      const result=next.stockResult;pending=null;opened=true;
      applyState(next);
      text("stock-notice",result.expired&&action!=="clear"?"交易已逾時，已重新開啟交易期間，本次未買賣。":
        result.record?(result.record.action==="clear"?"已清算":"交易完成")+"："+money(result.record.amount):"股票交易期間已更新。");
    }catch(e){
      if(e.status>=400&&e.status<500){pending=null;try{applyState(await api("state"));}catch{}}
      text("stock-notice",e.message);notify(e.message,true);
    }finally{busy=false;render();}
  }
  el("stock-open").addEventListener("click",()=>submit("open"));
  el("stock-form").addEventListener("submit",e=>{e.preventDefault();submit(e.submitter?.value==="sell"?"sell":"buy");});
  el("stock-clear").addEventListener("click",()=>submit("clear"));
  return {render,open:()=>submit("open"),close:()=>{opened=false;},leave:()=>{opened=false;render();},busy:()=>busy};
}
