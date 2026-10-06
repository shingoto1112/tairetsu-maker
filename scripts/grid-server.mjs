import { createServer } from 'vite';
const server = await createServer({envFile:false,server:{host:'127.0.0.1',port:5193,strictPort:true},logLevel:'warn'});
await server.listen();console.log('GRID_LOCAL_SERVER http://127.0.0.1:5193');
