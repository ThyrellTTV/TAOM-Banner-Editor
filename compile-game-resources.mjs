import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readConfig} from './configuration.mjs';
import {buildGameDeployment,installGameDeployment} from './game-deployment.mjs';
const root=path.dirname(fileURLToPath(import.meta.url)),args=process.argv.slice(2);
const value=flag=>{const i=args.indexOf(flag);return i<0?undefined:args[i+1];};
const file=path.resolve(value('--config')||process.env.BANNER_STUDIO_CONFIG||path.join(root,'config.json'));
try{
 const {config,error}=await readConfig(root,file);if(error)throw new Error(error);
 const batchId=value('--install-build'),material=value('--material');if(!batchId&&!material)throw new Error('Use --material <registered atlas> to build a review, or --install-build <deploy-batch> to deploy a reviewed build.');
 const result=batchId?await installGameDeployment({config,root,batchId}):await buildGameDeployment({config,root,material});
 console.log(JSON.stringify({batchId:result.batchId,status:result.status,directory:result.directory,material:result.material,thumbnails:result.thumbnails,sheets:result.sheets,changedFiles:result.changedFiles,targets:result.targets},null,2));
 if(result.status==='review')console.log('Review deployment.json, then run: node compile-game-resources.mjs --config "'+file+'" --install-build '+result.batchId);
}catch(error){console.error(error.message);process.exitCode=1;}
