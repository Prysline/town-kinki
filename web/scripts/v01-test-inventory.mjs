// Node test reporter: capture actual test source file and case names, not static declaration estimates.
// cd web && node --test --test-reporter ./scripts/v01-test-inventory.mjs tests/*.test.mjs > /tmp/v01-inventory.json
export default async function* (source) {
  const files=new Map(), summary=[];
  for await (const event of source) {
    const d=event.data;
    if(event.type==="test:summary")summary.push(d);
    if(!["test:pass","test:fail"].includes(event.type)||!d.file||d.details?.type==="suite")continue;
    // Node also emits a wrapper file test on file-level failure; preserve its type for diagnosis.
    const file=d.file.replaceAll("\\","/").replace(/^.*\/web\//,"web/");
    if(!files.has(file))files.set(file,[]);
    files.get(file).push({name:d.name,line:d.line,nesting:d.nesting,type:event.type,skip:d.skip??false,todo:d.todo??false});
  }
  yield JSON.stringify({files:[...files].sort(([a],[b])=>a.localeCompare(b)).map(([file,cases])=>({file,count:cases.length,cases})),summary},null,2)+"\n";
}
