import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildAtlases} from './atlas-builder.mjs';
import {readConfig,configPaths} from './configuration.mjs';
const root=path.dirname(fileURLToPath(import.meta.url));
const argv=process.argv.slice(2),options={},inputs=[];
for(let i=0;i<argv.length;i++){
  if(argv[i]==='--help'){console.log('node build-atlas.mjs --faction <name> --type alpha --input <folder> [--config <settings.json>] [--padding 0] [--outline 0] [--mode alpha|light-on-dark|dark-on-light] [--number 3] [--no-install] [file.png ...]');process.exit(0);}
  if(argv[i]==='--no-install'){options.install=false;continue;}
  if(argv[i].startsWith('--')){const key=argv[i].slice(2);if(!['faction','type','input','padding','outline','mode','number','output','config'].includes(key)||!argv[i+1])throw new Error('Unknown or missing option: '+argv[i]);options[key]=argv[++i];}else inputs.push(argv[i]);
}
try{
  const {config,error}=await readConfig(root,options.config?path.resolve(options.config):undefined);if(error)throw new Error(error);
  if(!config.gamePath)throw new Error('Set up the module and game folders in the editor first, or supply --config.');
  const p=configPaths(config,root);
  if(options.input){const folder=path.resolve(options.input);const names=(await fs.readdir(folder,{withFileTypes:true})).filter(f=>f.isFile()&&/\.png$/i.test(f.name)).map(f=>f.name).sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));inputs.push(...names.map(f=>path.join(folder,f)));}
  const files=await Promise.all(inputs.map(async file=>({name:path.basename(file),data:await fs.readFile(path.resolve(file))})));
  const result=await buildAtlases({files,faction:options.faction,category:options.type,modulePath:config.modulePath,gamePath:config.gamePath,outputDirectory:options.output?path.resolve(options.output):path.join(p.data,'atlas-builds'),sourceDirectory:p.atlasSources,registryFile:p.registry,nativeRegistryFile:p.nativeRegistry,thumbnailDirectory:p.thumbnails,atlasPrefix:config.atlasPrefix,groupLabel:config.moduleName,atlasSize:config.resourceSettings.newAtlasSize,install:options.install!==false,padding:Number(options.padding||0),outline:Number(options.outline||0),mode:options.mode||'alpha',startIndex:options.number?Number(options.number):undefined});
  console.log(JSON.stringify({directory:result.directory,registration:result.registration,atlases:result.atlases.map(a=>({name:a.name,groupId:a.groupId,images:a.cells.length,iconIds:a.cells.map(c=>c.iconId),psd:a.installedPath||path.join(result.directory,a.psd),warnings:a.cells.flatMap(c=>c.warnings.map(w=>c.source+': '+w))}))},null,2));
}catch(error){console.error(error.message);process.exitCode=1;}
