import {loadOsakaNpcCatalog} from "./osaka-challenge-core.mjs";
import {RECONSTRUCTED_OSAKA_NPCS,OSAKA_RECONSTRUCTION_VERSION} from "./osaka-npc-reconstruction.mjs";

export const OSAKA_NPC_POLICIES=Object.freeze(["auto","original-only"]);
export function resolveOsakaNpcCatalog(root,policy="auto"){
  if(!OSAKA_NPC_POLICIES.includes(policy))throw new Error("OSAKA_NPC_POLICY 必須為 auto 或 original-only");
  let original;
  try{original=loadOsakaNpcCatalog(root);}
  catch{
    // Existing malformed or unreadable files are an administrator error, not a missing-file fallback.
    return {available:false,npcs:[],missing:[],source:"unavailable",sourceVersion:null,sourceInvalid:true,policy};
  }
  if(original.available||policy==="original-only")return {...original,policy};
  // All ten reconstructed opponents form one independent pool; never mix partial original data.
  return {available:true,npcs:RECONSTRUCTED_OSAKA_NPCS,missing:original.missing,
    source:"reconstructed",sourceVersion:OSAKA_RECONSTRUCTION_VERSION,policy};
}
