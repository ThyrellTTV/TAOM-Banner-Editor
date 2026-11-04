import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
import sharp from 'sharp';
const execute=promisify(execFile);
export async function resizeAtlas(rgba,width,size){
 if(size===width)return Buffer.from(rgba);
 if(width%4||size%4)throw new Error('Atlas dimensions must divide into four cells.');
 const cell=width/4,next=size/4,result=Buffer.alloc(size*size*4);
 for(let index=0;index<16;index++){
  const x=index%4,y=Math.floor(index/4),data=await sharp(rgba,{raw:{width,height:width,channels:4}}).extract({left:x*cell,top:y*cell,width:cell,height:cell}).resize(next,next,{kernel:'lanczos3'}).raw().toBuffer();
  for(let row=0;row<next;row++)data.copy(result,((y*next+row)*size+x*next)*4,row*next*4,(row+1)*next*4);
 }
 return result;
}
export async function encodeTexture({root,directory,rgba,width,height,format='rgba8',mipmaps=false,quality='balanced'}){
 const levels=[{width,height,data:rgba}];
 if(mipmaps)while(levels.at(-1).width>1||levels.at(-1).height>1){const previous=levels.at(-1),width=Math.max(1,previous.width>>1),height=Math.max(1,previous.height>>1),data=await sharp(previous.data,{raw:{width:previous.width,height:previous.height,channels:4}}).resize(width,height,{kernel:'lanczos3'}).raw().toBuffer();levels.push({width,height,data});}
 if(format==='rgba8')return {data:Buffer.concat(levels.map(l=>l.data)),mipCount:levels.length,format:'R8G8B8A8_UNORM',levels:levels.map(l=>({width:l.width,height:l.height,bytes:l.data.length}))};
 if(!['bc1','bc3','bc7'].includes(format)||!['fast','balanced','best'].includes(quality))throw new Error('Invalid texture encoding options.');
 const jobDirectory=path.join(directory,'encoding',randomUUID());await fs.mkdir(jobDirectory,{recursive:true});const files=[];
 try{
  const job={format,quality,levels:[]};for(let i=0;i<levels.length;i++){const input=path.join(jobDirectory,i+'.rgba'),output=path.join(jobDirectory,i+'.blocks');await fs.writeFile(input,levels[i].data,{flag:'wx'});files.push(input,output);job.levels.push({width:levels[i].width,height:levels[i].height,input,output});}
  const jobFile=path.join(jobDirectory,'job.json');await fs.writeFile(jobFile,JSON.stringify(job,null,2));
  const executable=path.join(root,'tools/texture-encoder/TextureEncoder.exe'),published=!!await fs.stat(executable).catch(()=>null);
  const result=await execute(published?executable:'dotnet',published?[jobFile]:['run','--project',path.join(root,'texture-encoder/TextureEncoder.csproj'),'--',jobFile],{windowsHide:true,timeout:600000,maxBuffer:4*1024*1024});await fs.writeFile(path.join(jobDirectory,'encoding.log'),result.stdout+result.stderr);
  const buffers=[];for(let i=0;i<levels.length;i++){const data=await fs.readFile(job.levels[i].output),expected=Math.ceil(levels[i].width/4)*Math.ceil(levels[i].height/4)*(format==='bc1'?8:16);if(data.length!==expected)throw new Error('Encoded texture block count is incorrect.');buffers.push(data);}
  return {data:Buffer.concat(buffers),mipCount:levels.length,format:{bc1:'DXT1',bc3:'DXT5',bc7:'BC7'}[format],levels:levels.map((l,i)=>({width:l.width,height:l.height,bytes:buffers[i].length}))};
 }finally{for(const file of files)await fs.unlink(file).catch(error=>{if(error.code!=='ENOENT')throw error;});}
}
