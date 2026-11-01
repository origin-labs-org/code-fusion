import { readdirSync, statSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
const skip = new Set(['node_modules','.git','vendor','archive','.trae','dist','lib']);
function walk(d, out=[]){
  for(const e of readdirSync(d)){
    if(skip.has(e)) continue;
    const p = join(d,e);
    let s; try{s=statSync(p)}catch{continue}
    if(s.isDirectory()) walk(p,out);
    else out.push(p);
  }
  return out;
}
const files = walk('.');
let changed=0;
for(const f of files){
  if(!/\.(md|ts|tsx|js|mjs|cjs|json|yml|yaml|ts|svg|html)$/.test(f)) continue;
  if(f.includes('package-lock.json')) continue;
  let raw; try{raw=readFileSync(f,'utf8')}catch{continue}
  if(!raw.includes('CodeFusion')) continue;
  // Also skip if file is binary? already utf8
  let nxt = raw.replaceAll('CodeFusion','CodeFusion');
  // Also fix Xee_HARNESS variants that became Xee_HARNESS - keep as Xee_HARNESS is fine, but also CodeFusion-HARNESS -> CodeFusion-HARNESS etc already via above
  // CodeFusion already handled, but also ensure not double fix XeeE
  if(nxt!==raw){ writeFileSync(f,nxt,'utf8'); changed++; console.log('patched',f); }
}
console.log('DONE',changed);
