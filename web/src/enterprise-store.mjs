// Enterprise persistence. Called by authenticated adapters; all monetary writes use
// BEGIN IMMEDIATE and actual account/card state. No legacy player import.
import {readTownMap,storeTownMap} from "./town-storage.mjs";
import {RESIDENTIAL_LOTS} from "./housing.mjs";
import {settleBankInterestInTransaction,recordBankEntry,refreshBankTaxSnapshot} from "./banking.mjs";
import {requireClassroomCreditCard} from "./legacy-credit.mjs";
import {quoteExtraBuilding,emptyEmployee,employeeCap,projectEmployee,trainEmployees,projectEnterpriseIncome} from "./enterprise-source.mjs";
const labels={branch:"分店",operation:"運營公司",corporation:"股份有限公司",resale:"持有物販賣店"};
const safe=n=>{if(!Number.isSafeInteger(n)||n<0)throw Error("企業資產超出安全範圍");return n;};
export function initEnterpriseTables(db){
 db.exec([
 "CREATE TABLE IF NOT EXISTS enterprise_buildings(house_id INTEGER PRIMARY KEY REFERENCES houses(id) ON DELETE CASCADE,owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,kind TEXT NOT NULL CHECK(kind IN ('branch','operation','corporation','resale')),UNIQUE(owner_user_id,kind));",
 "CREATE TABLE IF NOT EXISTS enterprise_employees(owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,kind TEXT NOT NULL CHECK(kind IN ('operation','corporation')),slot INTEGER NOT NULL CHECK(slot>=0),data_json TEXT NOT NULL,PRIMARY KEY(owner_user_id,kind,slot));",
 "CREATE TABLE IF NOT EXISTS enterprise_officers(owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,officer_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,joined_at INTEGER NOT NULL,PRIMARY KEY(owner_user_id,officer_user_id));",
 "CREATE TABLE IF NOT EXISTS enterprise_income_days(owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,day TEXT NOT NULL,result_json TEXT NOT NULL,PRIMARY KEY(owner_user_id,day));",
 "CREATE TABLE IF NOT EXISTS enterprise_receipts(user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,request_id TEXT NOT NULL,args_json TEXT NOT NULL,result_json TEXT NOT NULL,PRIMARY KEY(user_id,request_id));"
 ].join("\n"));
}
function tx(db,fn){db.exec("BEGIN IMMEDIATE");try{const r=fn();db.exec("COMMIT");return r;}catch(e){db.exec("ROLLBACK");throw e;}}
function character(db,id){const c=db.prepare("SELECT * FROM characters WHERE user_id=?").get(id);if(!c)throw Error("請先建立角色");return c;}
function receipt(db,id,requestId,args,fn){
 if(typeof requestId!=="string"||!/^[A-Za-z0-9_-]{8,96}$/.test(requestId))throw Error("無效請求識別碼");
 const signature=JSON.stringify(args),prior=db.prepare("SELECT * FROM enterprise_receipts WHERE user_id=? AND request_id=?").get(id,requestId);
 if(prior){if(prior.args_json!==signature)throw Error("請求識別碼衝突");return {...JSON.parse(prior.result_json),replayed:true};}
 const result=fn();
 db.prepare("INSERT INTO enterprise_receipts VALUES(?,?,?,?)").run(id,requestId,signature,JSON.stringify(result));
 return {...result,replayed:false};
}
function employees(db,id,kind){return db.prepare("SELECT data_json FROM enterprise_employees WHERE owner_user_id=? AND kind=? ORDER BY slot").all(id,kind).map(r=>JSON.parse(r.data_json));}
function writeEmployees(db,id,kind,rows){const q=db.prepare("INSERT INTO enterprise_employees VALUES(?,?,?,?) ON CONFLICT(owner_user_id,kind,slot) DO UPDATE SET data_json=excluded.data_json");rows.forEach((e,i)=>q.run(id,kind,i,JSON.stringify(e)));}
function officers(db,id){return db.prepare("SELECT officer_user_id FROM enterprise_officers WHERE owner_user_id=? ORDER BY joined_at,officer_user_id").all(id).map(r=>r.officer_user_id);}
function ownedKinds(db,id){return db.prepare("SELECT COALESCE(e.kind,'home') kind FROM houses h LEFT JOIN enterprise_buildings e ON h.id=e.house_id WHERE h.owner_user_id=? ORDER BY h.id").all(id).map(r=>r.kind);}
function assets(db,c){const term=db.prepare("SELECT term_balance FROM bank_accounts WHERE user_id=?").get(c.user_id)?.term_balance??0;
 const loan=db.prepare("SELECT daily_payment,remaining_payments FROM bank_loans WHERE user_id=?").get(c.user_id);
 const n=BigInt(c.money)+BigInt(c.bank)+BigInt(term)-BigInt(loan?.daily_payment??0)*BigInt(loan?.remaining_payments??0);
 return safe(Number(n<0n?0n:n));
}
export function buildExtraEnterprise(db,rules,catalog,userId,{kind,image,row,column,payment,cardSourceLine=null,requestId,now,today}){
 return tx(db,()=>receipt(db,userId,requestId,["build",kind,image,row,column,payment,cardSourceLine],()=>{
  let c=character(db,userId);
  if(!Number.isInteger(row)||row<0||row>11||!Number.isInteger(column)||column<0||column>15)throw Error("無效位置");
  if(!["cash","credit"].includes(payment))throw Error("無效付款方式");
  settleBankInterestInTransaction(db,userId,today,now);c=character(db,userId);
  if(payment==="credit")requireClassroomCreditCard(db,userId,cardSourceLine,now);
  const quote=quoteExtraBuilding(rules,catalog,{townId:c.town_id,image,kind,existingKinds:ownedKinds(db,userId),assets:assets(db,c),stats:JSON.parse(c.stats_json)});
  const map=readTownMap(db,c.town_id),offset=row*16+column,raw=map.tiles[offset];
  if(!RESIDENTIAL_LOTS.includes(raw))throw Error("選定位置不是可建造的空地");
  const field=payment==="cash"?"money":"bank";
  if(c[field]<quote.total)throw Error("建造費不足");
  const id=db.prepare("SELECT MAX(COALESCE((SELECT MAX(id) FROM houses),0),COALESCE((SELECT MAX(house_id) FROM house_events),0))+1 AS id").get().id;
  const name=c.name+"的"+labels[kind];
  db.prepare("INSERT INTO houses(id,owner_user_id,town_id,row_num,column_num,name,image,interior_rank,purchase_price,original_plot,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)").run(id,userId,c.town_id,row,column,name,image,3,quote.total,raw,now);
  db.prepare("INSERT INTO enterprise_buildings VALUES(?,?,?)").run(id,userId,kind);
  if(["operation","corporation"].includes(kind)&&!employees(db,userId,kind).length)writeEmployees(db,userId,kind,[emptyEmployee(rules)]);
  if(kind==="corporation")db.prepare("INSERT OR IGNORE INTO enterprise_officers VALUES(?,?,?)").run(userId,userId,now);
  const tiles=[...map.tiles];tiles[offset]="webhouse_"+id+"="+raw;
  storeTownMap(db,c.town_id,{tiles,originalName:map.originalName,originalRecord:map.fields?map.fields.join("<>")+"\n":""},"web-edited");
  const balance=c[field]-quote.total;
  db.prepare("UPDATE characters SET "+field+"=? WHERE user_id=?").run(balance,userId);
  if(payment==="credit")recordBankEntry(db,userId,"ordinary","企業建造",quote.total,0,balance,now);
  db.prepare("INSERT INTO house_events(user_id,house_id,event_type,town_id,row_num,column_num,house_name,image,amount,created_at) VALUES(?,?,'built',?,?,?,?,?,?,?)").run(userId,id,c.town_id,row,column,name,image,quote.total,now);
  refreshBankTaxSnapshot(db,userId,today);
  return {houseId:id,quote};
 }));
}
function visit(db,userId,houseId){
 const c=character(db,userId);
 const h=db.prepare("SELECT h.*,e.kind FROM houses h JOIN enterprise_buildings e ON e.house_id=h.id WHERE h.id=?").get(houseId);
 if(!h||!["operation","corporation"].includes(h.kind)||h.town_id!==c.town_id)throw Error("找不到本城企業");
 const owner=h.owner_user_id,memberIds=h.kind==="corporation"?officers(db,owner):[owner];
 return {h,owner,memberIds,c};
}
export function enterpriseOverview(db,rules,jobs,userId,houseId){
 const {h,owner,memberIds}=visit(db,userId,houseId);
 const rows=employees(db,owner,h.kind);
 return {houseId,kind:h.kind,owner:userId===owner,canTrain:memberIds.includes(userId),employeeLimit:employeeCap(rules,h.kind,memberIds.length),employees:rows,officerIds:memberIds,
 income:projectEnterpriseIncome({[h.kind]:rows,ownerId:owner,officerIds:memberIds},jobs)};
}
export function mutateEnterprise(db,rules,jobs,userId,{houseId,action,indices=[],stat=null,amount=null,payment="cash",cardSourceLine=null,requestId,now,today}){
 return tx(db,()=>receipt(db,userId,requestId,[houseId,action,indices,stat,amount,payment,cardSourceLine],()=>{
  const {h,owner,memberIds}=visit(db,userId,houseId);
  let rows=employees(db,owner,h.kind),cap=employeeCap(rules,h.kind,memberIds.length);
  // Original visit recalculates and persists jobs for every employee, even for a visitor.
  if(action==="open"){rows=rows.map(e=>projectEmployee(e,jobs));writeEmployees(db,owner,h.kind,rows);return {count:rows.length};}
  if(!memberIds.includes(userId))throw Error("沒有企業教育權限");
  if(action==="hire"){
   if(userId!==owner)throw Error("只有企業屋主可增員");
   if(rows.length>=cap)throw Error("員工已達上限");
   rows=[...rows,emptyEmployee(rules)].map(e=>projectEmployee(e,jobs));
   writeEmployees(db,owner,h.kind,rows);return {count:rows.length};
  }
  if(action==="train-all"&&h.kind==="corporation")indices=rows.map((_,i)=>i);
  else if(action!=="train"||indices.length!==1||!indices.every(i=>i<cap))throw Error("無效企業教育操作或員工已超過現任役員名額");
  settleBankInterestInTransaction(db,userId,today,now);
  if(payment==="credit")requireClassroomCreditCard(db,userId,cardSourceLine,now);
  const c=character(db,userId);
  const result=trainEmployees(rules,jobs,{kind:h.kind,employees:rows,indices,actorStats:JSON.parse(c.stats_json),cash:c.money,bank:c.bank,payment,creditValid:payment==="credit",stat,amount,nowSeconds:Math.floor(now/1000)});
  if(h.kind==="corporation"&&action==="train")result.employees[indices[0]].lastTrainedBy=c.name;
  writeEmployees(db,owner,h.kind,result.employees);
  db.prepare("UPDATE characters SET money=?,bank=?,stats_json=? WHERE user_id=?").run(result.cash,result.bank,JSON.stringify(result.actorStats),userId);
  if(payment==="credit"&&result.cost)recordBankEntry(db,userId,"ordinary","員工教育",result.cost,0,result.bank,now);
  refreshBankTaxSnapshot(db,userId,today);
  return {cost:result.cost,gain:result.gain,consumed:result.consumed};
 }));
}
// Called inside the authoritative daily settlement transaction, AFTER interest/loan/tax.
// Independent per company, no recursive recipient daily settlement. Retained source
// files can still generate income after building sale (baikyku_syoumetu=no).
export function settleEnterpriseIncomeInTransaction(db,jobs,ownerId,today,now){
 const prior=db.prepare("SELECT result_json FROM enterprise_income_days WHERE owner_user_id=? AND day=?").get(ownerId,today);
 if(prior)return {...JSON.parse(prior.result_json),replayed:true};
 character(db,ownerId);
 const operation=employees(db,ownerId,"operation"),corporation=employees(db,ownerId,"corporation");
 if(!operation.length&&!corporation.length)return null;
 const result=projectEnterpriseIncome({operation,corporation,ownerId,officerIds:officers(db,ownerId).filter(id=>db.prepare("SELECT 1 FROM characters WHERE user_id=?").get(id))},jobs);
 const credit=(id,amount,action)=>{
  const c=character(db,id),balance=safe(c.bank+amount);
  db.prepare("UPDATE characters SET bank=? WHERE user_id=?").run(balance,id);
  recordBankEntry(db,id,"ordinary",action,0,amount,balance,now);
  // An officer who has not personally settled today keeps the old tax base.
  // Crediting a company payout is not a town login and must not silently skip Monday tax.
  const account=db.prepare("SELECT last_interest_day FROM bank_accounts WHERE user_id=?").get(id);
  if(id===ownerId||account?.last_interest_day>=today)refreshBankTaxSnapshot(db,id,today);
 };
 if(operation.length)credit(ownerId,result.operating,"運營公司收入");
 if(corporation.length){credit(ownerId,result.corporate,"股份有限公司收入");for(const o of result.officers)credit(o.userId,o.amount,"役員公司收入");}
 db.prepare("INSERT INTO enterprise_income_days VALUES(?,?,?)").run(ownerId,today,JSON.stringify(result));
 return {...result,replayed:false};
}
