import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { decodeLegacyText, parseLegacyJobs, JOB_ZH_TW } from "../src/engine.mjs";

const source=decodeLegacyText(readFileSync(new URL("../../dat_dir/job.cgi",import.meta.url)));
const sourceLines=source.split(/\r?\n/).slice(1).filter(line=>line.includes("<>"));

test("全部 150 個原版職業名稱都有繁體中文顯示名稱，不修改原始日文鍵",()=>{
  const jobs=parseLegacyJobs(source);
  assert.equal(sourceLines.length,150);
  assert.equal(jobs.length,150);
  assert.equal(Object.keys(JOB_ZH_TW).length,150);
  for(let i=0;i<jobs.length;i++){
    const original=sourceLines[i].split("<>")[1];
    assert.equal(jobs[i].originalName,original);
    assert.equal(jobs[i].name,JOB_ZH_TW[original],original);
    assert.equal(jobs[i].translated,true,original);
    assert.ok(jobs[i].name.trim(),"空白職業顯示名稱："+original);
    assert.equal(jobs[i].key,"legacy-"+(i+2));
  }
});

test("翻譯不變動前置精通所需的原始日文職業名稱",()=>{
  const jobs=parseLegacyJobs(source);
  for(let i=0;i<jobs.length;i++){
    const fields=sourceLines[i].split("<>");
    assert.equal(jobs[i].previousJob,fields[28]||null,fields[1]);
  }
  assert.equal(JOB_ZH_TW["トップ・ガン"],"王牌飛行員");
  assert.equal(JOB_ZH_TW["ブラックジャック"],"怪醫黑傑克");
});

test("新增的原版職業在翻譯表找不到時仍使用原名，不干擾規則",()=>{
  const fields=sourceLines[0].split("<>");
  fields[1]="測試用未知日文職業";
  const [job]=parseLegacyJobs(source.split(/\r?\n/)[0]+"\n"+fields.join("<>"));
  assert.equal(job.originalName,"測試用未知日文職業");
  assert.equal(job.name,"測試用未知日文職業");
  assert.equal(job.translated,false);
});
