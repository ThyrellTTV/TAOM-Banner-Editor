import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import {readPsd,writePsdBuffer} from 'ag-psd';
import {normalizeConfig,configPaths,workspaceSignature,assetFingerprint} from '../../configuration.mjs';
import {writeAtlasPage} from '../../atlas-builder.mjs';
import {loadLibrary} from '../../library.mjs';
import {prepareSourceTextures} from '../../prepare-assets.mjs';
import {extractCell} from '../../atlas-manager.mjs';
export async function makeWorkspace(temp,name='ExampleMod'){
  const root=path.resolve(import.meta.dirname,'../..'),config=normalizeConfig({modulePath:path.join(temp,name),gamePath:path.join(temp,'Game'),moduleName:name,
    bannerIconsFile:'Data/symbols.xml',bannerDefinitionPaths:['Data/clans.xml'],nativeBannerIconsFile:'NativeData/icons.xml',nativeAssetDirectory:'NativePackages',
    atlasSourceDirectory:'Artwork/Atlases',thumbnailDirectory:'Interface/Symbols',assetPackagePaths:[],atlasPrefix:'example_symbols',dataDirectory:path.join(temp,name+'Data')},root),p=configPaths(config,root);
  for(const dir of [path.dirname(p.registry),path.dirname(p.nativeRegistry),p.nativeAssets,p.atlasSources,p.thumbnails,path.join(p.data,'cache','textures')])await fs.mkdir(dir,{recursive:true});
  await fs.writeFile(p.registry,'<base><BannerIconData><BannerIconGroup id="100" name="Example Alpha"><Icon id="10000" material_name="example_symbols_west_alpha_01" texture_index="0"/><Icon id="10002" material_name="example_symbols_west_alpha_01" texture_index="2"/></BannerIconGroup></BannerIconData></base>');
  await fs.writeFile(p.nativeRegistry,'<base><BannerIconData><BannerIconGroup id="1" is_pattern="true" name="Patterns"><Background id="11" mesh_name="pattern"/></BannerIconGroup><BannerColors><Color id="0" hex="0xff16263b"/><Color id="1" hex="0xffddbb55"/><Color id="2" hex="0xffeeeeee"/></BannerColors></BannerIconData></base>');
  const code='11.1.1.1528.1528.764.764.1.0.0.10000.0.0.450.450.610.764.0.0.0.10002.0.0.350.350.920.764.0.0.0';
  await fs.writeFile(p.definitions[0],'<Factions><Faction id="west" name="Western Clan" banner_key="'+code+'"/></Factions>');
  const png=await sharp({create:{width:65,height:93,channels:4,background:'#fff'}}).png().toBuffer();
  const atlas=await writeAtlasPage({name:'example_symbols_west_alpha_01',files:[{name:'first.png',id:10000,textureIndex:0,data:png},{name:'second.png',id:10002,textureIndex:2,data:await sharp(png).resize(110,74).png().toBuffer()}],directory:p.atlasSources});
  for(const id of [10000,10002])await fs.copyFile(path.join(p.atlasSources,'thumbnails',id+'.png'),path.join(p.thumbnails,id+'.png'));
  const source=path.join(p.atlasSources,atlas.psd),psd=readPsd(await fs.readFile(source),{useImageData:true,skipThumbnail:true}),composite=Buffer.from(psd.imageData.data),before=extractCell(composite,2048,0),shifted=Buffer.alloc(before.length);
  for(let i=3;i<shifted.length;i+=4)shifted[i]=255;
  for(let y=0;y<512;y++)for(let x=0;x<512;x++){const sx=x-31,sy=y+17;if(sx>=0&&sx<512&&sy>=0&&sy<512)before.copy(shifted,(y*512+x)*4,(sy*512+sx)*4,(sy*512+sx)*4+4);}
  for(let y=0;y<512;y++)shifted.copy(composite,y*2048*4,y*512*4,(y+1)*512*4);
  psd.children.at(-1).children[0].left+=31;psd.children.at(-1).children[0].top-=17;psd.imageData.data=new Uint8ClampedArray(composite);await fs.writeFile(source,writePsdBuffer(psd,{compress:true,generateThumbnail:false}));
  const assets={modulePath:config.modulePath,gamePath:config.gamePath,materials:{},textures:{},meshes:{pattern:[{positions:[[-1,-1,0],[1,-1,0],[1,1,0],[-1,1,0]],indices:[0,1,2,0,2,3],colors:Array.from({length:4},()=>[255,255,255,255])}]},errors:[]};
  await fs.writeFile(path.join(p.data,'cache','assets.json'),JSON.stringify(assets));await fs.writeFile(path.join(p.data,'cache','workspace.json'),JSON.stringify({signature:workspaceSignature(config),assetFingerprint:await assetFingerprint(config,root)}));
  const library=await loadLibrary(config.modulePath,config.gamePath,config);await prepareSourceTextures(p.data,assets,config.modulePath,library.icons,config);
  return {root,config,p,library,assets,material:atlas.name,source,code};
}
