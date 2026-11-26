// Web-only original-data-gap reconstruction. NOT a recovered CGI dataset.
import {STAT_KEYS} from "./engine.mjs";
import {osakaNpcEnergy} from "./osaka-challenge-core.mjs";

export const OSAKA_RECONSTRUCTION_VERSION="web-osaka-npc-v1";
const profiles=[
  ["week","市場阿姨",[27,31,20,30,20,22,21,26,32,30,27,29,25,24,25,33,22]],
  ["week","街坊阿姨",[30,24,22,34,20,25,23,25,28,27,24,25,24,23,31,35,24]],
  ["week","運動阿姨",[21,23,25,23,20,22,21,26,37,34,34,34,32,36,24,26,23]],
  ["week","歌唱阿姨",[28,21,20,25,24,38,30,30,25,26,26,23,22,25,32,30,25]],
  ["week","料理阿姨",[25,25,30,31,21,23,26,24,32,36,23,31,34,26,25,28,24]],
  ["strong","商店街阿姨",[83,94,70,95,66,72,70,73,91,88,78,85,82,77,80,99,70]],
  ["strong","街坊會長阿姨",[96,76,72,105,70,82,76,75,85,86,74,77,78,73,97,108,75]],
  ["strong","健身教練阿姨",[70,75,81,74,68,70,72,80,108,100,100,104,99,108,74,80,70]],
  ["strong","歌唱老師阿姨",[89,72,68,78,80,112,96,88,80,82,79,72,70,78,100,94,78]],
  ["strong","料理師傅阿姨",[80,81,99,95,70,76,82,74,96,105,73,99,106,84,78,88,75]]
];
export const RECONSTRUCTED_OSAKA_NPCS=Object.freeze(profiles.map(([mode,name,values],i)=>{
  if(values.length!==STAT_KEYS.length||!values.every(v=>Number.isSafeInteger(v)&&v>0))
    throw new Error("大阪重建版 NPC 配點錯誤");
  const index=i%5+1;
  const stats=Object.freeze(Object.fromEntries(STAT_KEYS.map((key,j)=>[key,values[j]])));
  return Object.freeze({
    id:"web-osaka-"+mode+"-"+index,mode,index,name,stats,
    source:"reconstructed",sourceVersion:OSAKA_RECONSTRUCTION_VERSION,
    ...osakaNpcEnergy(stats)
  });
}));
