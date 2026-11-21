// 商店與物品欄使用的原版能力摘要；相同增減值合併、不可截斷能力名稱。
// randomizedEffects 是原版「ランダム品」：每一項各自獨立抽選，而不是固定加成。
export function groupedStatLines(effects,labels,randomizedEffects=false){
  const grouped=new Map();
  for(const [key,value] of Object.entries(effects??{})){
    if(!Number.isFinite(value)||value===0)continue;
    const change=randomizedEffects?" +0～+"+value:
      (value>0?" +"+value:" "+value);
    if(!grouped.has(change))grouped.set(change,[]);
    grouped.get(change).push(labels[key]??key);
  }
  return [...grouped].map(([change,names])=>
    (randomizedEffects?"每項獨立隨機":"能力")+change+"："+names.join("、"));
}
