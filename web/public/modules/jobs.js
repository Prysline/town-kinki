// 職業介紹所的顯示、篩選、條件與應徵；app 仍唯一持有狀態與操作入口。
import {displayJobName,displayGameError} from "../game-display-translations.js";

export function createJobsUI({getState,el,text,money,labels,action}){
  // 原版 basic.cgi::job_change 有 17 個能力欄，但只列出實際大於 0 的需求。
  // 不顯示無門檻的能力或「不限」欄位；應徵資格仍在伺服器判定。
  const JOB_REQUIREMENT_KEYS = Object.freeze([
    "kokugo","suugaku","rika","syakai","eigo","ongaku","bijutu",
    "looks","tairyoku","kenkou","speed","power","wanryoku","kyakuryoku",
    "love","unique","etti"
  ]);
  function jobRequirementsPanel(job) {
    const state=getState();
    const details=document.createElement("details");
    details.className="job-requirements";
    details.dataset.jobKey=job.key;
    const demanded=JOB_REQUIREMENT_KEYS.filter(key=>Number(job.requirements?.[key]??0)>0);
    const summary=document.createElement("summary");
    summary.textContent=demanded.length?
      "職業條件｜能力已達 "+demanded.filter(key=>
        Number(state.character.stats[key]??0)>=Number(job.requirements[key])).length+
      "/"+demanded.length+" 項（展開比較目前／要求）":"檢視職業條件與待遇";
    details.append(summary);

    const other=document.createElement("div");
    other.className="job-condition-grid";
    const status=[];
    if(job.bmiMin||job.bmiMax){
      const bmi=(job.bmiMin||"不限")+"～"+(job.bmiMax||"不限");
      const current=state.physique?.bmi;
      status.push(["BMI","目前 "+(Number.isFinite(current)?current:"未取得")+"／要求 "+bmi,
        (job.bmiMin&&current<job.bmiMin)||
        (job.bmiMax&&current>job.bmiMax)]);
    }
    if(job.minHeight>0)
      status.push(["身高","目前 "+state.character.height+" cm／要求 "+
        job.minHeight+" cm 以上",state.character.height<job.minHeight]);
    if(job.gender)
      status.push(["性別",job.gender==="male"?"男":"女",
        state.character.gender!==job.gender]);
    if(job.previousJob)
      status.push(["前置精通",displayJobName(job.previousJob,state.jobs),
        state.character.masteredJob!==job.previousJob]);
    for(const [label,required,missing] of status){
      const row=document.createElement("div");
      row.className="job-condition"+(missing?" job-condition-missing":"");
      row.textContent=label+"："+required;
      other.append(row);
    }
    if(status.length)details.append(other);

    const finance=document.createElement("p");
    finance.className="small job-finance";
    finance.textContent="每次基礎薪資 "+money(job.salary)+
      " · 每 "+job.payEvery+" 次工作發薪 · 升級獎金倍率 ×"+
      job.bonusRate+" · 升薪倍率 ×"+job.raiseRate+
      " · 身體消耗 "+job.bodyCost+" · 頭腦消耗 "+job.brainCost;

    if(demanded.length){
      const requirements=document.createElement("div");
      requirements.className="job-condition-grid job-stats-grid";
      for(const key of demanded){
        const current=Number(state.character.stats[key]??0);
        const required=Number(job.requirements[key]);
        const row=document.createElement("div");
        const met=current>=required;
        row.className="job-condition "+(met?"job-condition-met":"job-condition-missing");
        row.textContent=labels[key]+"｜目前 "+current+" ／ 要求 "+required+
          "｜"+(met?"已達標":"還差 "+(required-current));
        requirements.append(row);
      }
      details.append(requirements);
    }
    details.append(finance);
    return details;
  }
  function renderJobs() {
    const state=getState();
    if (!state?.character) return;
    el("salary-payment").value=state.character.salaryPayment==="bank"?"bank":"cash";
    const target = el("jobs");
    const search = el("job-search").value.trim().toLocaleLowerCase("zh-TW");
    const availableOnly = el("job-filter").value === "available";
    const expanded=new Set([...target.querySelectorAll("details[open][data-job-key]")]
      .map(element=>element.dataset.jobKey));
    const filtered = state.jobs.filter(job =>
      (!availableOnly || !job.reason) && job.name.toLocaleLowerCase("zh-TW").includes(search)
    );
    text("job-count", "顯示：" + filtered.length + " / " + state.jobs.length);
    target.replaceChildren();
    for (const job of filtered) {
      const row = document.createElement("div");
      row.className = "job" + (job.key === state.character.jobId ? " active" : "");
      const meta = document.createElement("div");
      meta.className="job-main";
      const title = document.createElement("span");
      const desc = document.createElement("small");
      // 原版 basic.cgi 的職業名稱後會顯示 (階級 - 1) 顆 *；這不是玩家目前的職業等級。
      const rankStars=job.rank>1?"*".repeat(job.rank-1):"";
      title.textContent = job.name + rankStars + (job.translated ? "" : "（未翻譯）");
      const eligibility=document.createElement("small");
      eligibility.className="job-eligibility"+(job.reason?" locked":"");
      eligibility.textContent=job.key===state.character.jobId?"目前任職中":
        job.reason?(job.previousJob&&job.reason.startsWith("需先精通")?
          "尚未解鎖："+displayGameError(job.reason,state.jobs):"目前未達就職條件："+displayGameError(job.reason,state.jobs)):"可應徵";
      desc.textContent = "薪資 " + money(job.salary) + "／每 " + job.payEvery +
        " 次工作 · 體力 " + job.bodyCost + " · 頭腦 " + job.brainCost;
      const requirements=jobRequirementsPanel(job);
      requirements.open=expanded.has(job.key);
      meta.append(title,eligibility,desc,requirements);
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = job.key === state.character.jobId ? "任職中" : "應徵";
      button.disabled = Boolean(job.reason) || job.key === state.character.jobId;
      button.addEventListener("click", () => action("job", { key:job.key }, "已選擇職業：" + job.name));
      row.append(meta, button);
      target.append(row);
    }
    if (!filtered.length) {
      const empty = document.createElement("p");
      empty.className = "muted";
      empty.textContent = "沒有符合條件的職業。";
      target.append(empty);
    }
  }
  return {renderJobs};
}
