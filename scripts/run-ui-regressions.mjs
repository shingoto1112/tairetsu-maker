// Local dev test server with no .env; existing server ports stay untouched.
import { createServer } from 'vite';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
const server=await createServer({envFile:false,server:{host:'127.0.0.1',port:5378,strictPort:true},logLevel:'warn'});await server.listen();
const names=['test-build22-browser'];
const results=[];
try{
 for(const name of names){
  // Keep relative imports valid and redirect only test-owned loopback servers.
  const target=path.resolve('scripts',`ui-regression-${randomUUID()}.mjs`);
  const source=(await fs.readFile(`scripts/${name}.mjs`,'utf8')).replaceAll('127.0.0.1:5193','127.0.0.1:5378').replaceAll('port: 5183','port: 5379').replaceAll('127.0.0.1:5183','127.0.0.1:5379')
    .replace('const page = await context.newPage();', `await context.route('**/*', route => {
      const target = new URL(route.request().url());
      return target.origin === origin || ['data:', 'blob:'].includes(target.protocol) ? route.continue() : route.abort();
    });
    const page = await context.newPage();`);
  await fs.writeFile(target,source);
  try{
   const code=await new Promise((resolve,reject)=>{const child=spawn(process.execPath,[target],{stdio:'inherit',env:{...process.env,REPOSITORY_TEST_ORIGIN:'http://127.0.0.1:5378'}});child.on('error',reject);child.on('exit',resolve);});
   results.push({name,code});console.log(`REGRESSION ${name}: ${code}`);
  }finally{await fs.unlink(target);}
 }
 await fs.writeFile('docs/ui-regression-results.json',JSON.stringify(results,null,2));
 if(results.some(r=>r.code!==0))process.exitCode=1;
}finally{await server.close();}
