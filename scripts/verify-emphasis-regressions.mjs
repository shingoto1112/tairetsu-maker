import { readFile,writeFile,unlink,mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
const out='C:/Users/shing/AppData/Local/Temp/claude/c--Users-shing-OneDrive--------ChatGPT-------/e5aa9c38-eb07-490c-ac06-62f047c4c161/scratchpad/shots-emphasis';
await mkdir(out,{recursive:true});
const names=['test-horizontal-counting-browser','test-horizontal-grid-browser','test-horizontal-grid-operations-browser','test-build22-browser','test-app-storage-browser','test-horizontal-grid-collaboration-browser','test-collaboration-ui-browser','test-shared-session-app-browser','test-collaboration-lifecycle-browser','check-collab-v2'].filter(name=>process.argv.length<=2||process.argv.slice(2).includes(name));
const results=[];
for(const name of names){
 const source='scripts/'+name+'.mjs',temporary='scripts/emphasis-run-'+name+'.mjs';
 let text=await readFile(source,'utf8');text=text.replaceAll('127.0.0.1:5193','127.0.0.1:5196').replaceAll('/scratchpad/shots-grid','/scratchpad/shots-emphasis/regression-grid').replaceAll('output/playwright/build22',out+'/regression-build22');
 await writeFile(temporary,text);const log=[];console.log('START '+name);
 try{const exitCode=await new Promise(resolve=>{const child=spawn(process.execPath,[temporary],{env:{...process.env,REPOSITORY_TEST_ORIGIN:'http://127.0.0.1:5196',ROUND12_SHOT_DIR:out+'/regression-collaboration'},stdio:['ignore','pipe','pipe']});child.stdout.on('data',d=>log.push(d.toString()));child.stderr.on('data',d=>log.push(d.toString()));child.on('exit',resolve);});await writeFile(path.join(out,name+'.log'),log.join(''));results.push({name,exitCode});console.log('RESULT '+name+' '+exitCode);if(exitCode)console.log(log.join('').slice(-1800));}finally{await unlink(temporary);}
}
await writeFile(path.join(out,'regression-results.json'),JSON.stringify(results,null,2));if(results.some(r=>r.exitCode))process.exitCode=1;
