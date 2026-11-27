// WK-01: source-specific energy maxima. Original CGI uses three different contexts.
// town_maker.cgi::loged_gamen L663–664; basic.cgi::do_work L2883/L2889;
// basic.cgi::onsen L1037–1038. Do not flatten these into one work formula.
const BRAIN_KEYS=Object.freeze(["kokugo","suugaku","rika","syakai","eigo","ongaku","bijutu"]);
function requireContext(context){
  if(!["resident","work","onsen-entry"].includes(context))throw Error("未知的能量上限情境");
}
export function originalBodyEnergyMaximum(stats,context="resident"){
  requireContext(context);
  if(context==="work")return Math.trunc(
    stats.tairyoku/2+stats.kenkou/3+stats.power/5+stats.wanryoku/8+stats.kyakuryoku/8
  );
  return Math.trunc(stats.looks/12+stats.tairyoku/4+stats.kenkou/4+stats.speed/8+
    stats.power/8+stats.wanryoku/8+stats.kyakuryoku/8)+(context==="onsen-entry"?1:0);
}
export function originalBrainEnergyMaximum(stats,context="resident"){
  requireContext(context);
  const divisor=context==="work"?4:6;
  return Math.trunc(BRAIN_KEYS.reduce((sum,key)=>sum+stats[key]/divisor,0))+(context==="onsen-entry"?1:0);
}
