import path from 'node:path';
import os from 'node:os';
export function documentsRoot(){
 if(process.env.OES_RUNS_ROOT&&!path.isAbsolute(process.env.OES_RUNS_ROOT))throw new Error('ABSOLUTE_RUN_DIRECTORY_REQUIRED');
 return path.join(path.dirname(path.resolve(process.env.OES_RUNS_ROOT??path.join(os.homedir(),'.open-estimate','runs'))),'estimate-documents');
}
