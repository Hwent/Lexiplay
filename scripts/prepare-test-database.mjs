import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
if(process.env.TEST_DATABASE_URL){
  const url=new URL(process.env.TEST_DATABASE_URL);
  if(!url.pathname.startsWith('/lexiplay_test_'))throw new Error('Use a disposable lexiplay_test_* database.');
  const script=resolve(dirname(fileURLToPath(import.meta.url)),'migrate-local-collections.mjs');
  const result=spawnSync(process.execPath,[script],{env:{...process.env,DATABASE_URL:url.href},stdio:'inherit',windowsHide:true});
  process.exitCode=result.status??1;
}
