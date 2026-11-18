import { build } from 'vite';
import { mkdir,readFile,readdir,writeFile,rm } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import os from 'node:os';
import path from 'node:path';
const root=process.cwd(),target=path.resolve(root,'verification-emphasis-build');
if(path.dirname(target)!==root||path.basename(target)!=='verification-emphasis-build')throw Error('Unsafe build path');
const out=path.join(os.tmpdir(), 'tairetsu-shots-emphasis');await mkdir(out,{recursive:true});const results=[];
try{for(const flag of [false,true]){
 if(flag)process.env.VITE_COLLABORATION_V2='1';else delete process.env.VITE_COLLABORATION_V2;
 await build({envFile:false,build:{outDir:target,emptyOutDir:true},logLevel:'warn'});
  const html=await readFile(path.join(target,'index.html'),'utf8');const entry=html.split('src="/assets/')[1]?.split('"')[0];if(!entry)throw Error('Main entry not found');const main=[entry];
 for(const name of main){const bytes=await readFile(path.join(target,'assets',name));results.push({collaborationV2:flag,name,bytes:bytes.length,gzipBytes:gzipSync(bytes).length});}
 console.log('BUILD_PASS '+JSON.stringify(results.at(-1)));
 await rm(target,{recursive:true,force:true});
}}finally{await rm(target,{recursive:true,force:true});}
await writeFile(path.join(out,'build-results.json'),JSON.stringify(results,null,2));
