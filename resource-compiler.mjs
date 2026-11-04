import fs from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {xxhash64} from 'hash-wasm';

const TEXTURE='c974cbcb-5f1c-49f6-9a32-2b5b6c92c2e8',MATERIAL='1db01393-6902-4f19-83ba-b37a39830717';
const SOURCE_INFO='8ab981a7-6ba0-4908-9606-91ad341d19a9',IMPORT_SETTINGS='7c475be2-7c8d-431d-b0e1-53218d047fb9';
const PIXELS='70ee4e2c-79e4-4b2d-8d54-d53ecd2a559c';
const u32=n=>{const b=Buffer.alloc(4);b.writeUInt32LE(n);return b;};
const u64=n=>{const b=Buffer.alloc(8);b.writeBigUInt64LE(BigInt(n));return b;};
const string=s=>{const b=Buffer.from(s,'utf8');return Buffer.concat([u32(b.length),b]);};
const strings=items=>Buffer.concat([u32(items.length),...items.map(string)]);
export const guidBytes=value=>{const b=Buffer.from(value.replaceAll('-',''),'hex');if(b.length!==16)throw new Error('Invalid resource GUID.');return Buffer.concat([Buffer.from(b.subarray(0,4)).reverse(),Buffer.from(b.subarray(4,6)).reverse(),Buffer.from(b.subarray(6,8)).reverse(),b.subarray(8)]);};
export const guidString=b=>`${b.readUInt32LE(0).toString(16).padStart(8,'0')}-${b.readUInt16LE(4).toString(16).padStart(4,'0')}-${b.readUInt16LE(6).toString(16).padStart(4,'0')}-${b.subarray(8,10).toString('hex')}-${b.subarray(10,16).toString('hex')}`;
const checksum=async b=>BigInt('0x'+await xxhash64(b));
const replace=(data,start,end,value)=>Buffer.concat([data.subarray(0,start),value,data.subarray(end)]);
class Reader{
 constructor(data){this.data=data;this.offset=0;}
 take(n){if(!Number.isSafeInteger(n)||n<0||this.offset+n>this.data.length)throw new Error('Truncated resource data.');const b=this.data.subarray(this.offset,this.offset+n);this.offset+=n;return b;}
 uint(){return this.take(4).readUInt32LE();}
 ulong(){const n=this.take(8).readBigUInt64LE();if(n>BigInt(Number.MAX_SAFE_INTEGER))throw new Error('Resource field is too large.');return Number(n);}
 str(){return this.take(this.uint()).toString('utf8');}
 strings(){const n=this.uint();if(n>1024)throw new Error('Invalid resource flags.');return Array.from({length:n},()=>this.str());}
}
// The editable, single-resource TPAC layout used by the installed 1.5.6 editor.
// Unknown metadata fields are preserved rather than reconstructed from guesses.
export function readResource(data){
 const r=new Reader(data);if(r.take(4).toString()!=='TPAC'||r.uint()!==2)throw new Error('Expected an editable v2 TPAC.');
 const packageId=guidString(r.take(16));if(r.uint()!==1)throw new Error('Resource compilation requires a single-resource editable TPAC template.');
 const dataOffset=r.uint()+36;r.take(4);const type=guidString(r.take(16)),id=guidString(r.take(16)),version=r.uint(),name=r.str();
 const metadata=Buffer.from(r.take(r.ulong())),metadataChecksum=r.take(8).readBigUInt64LE(),count=r.uint();if(count>32)throw new Error('Too many resource data segments.');
 const segments=[];for(let i=0;i<count;i++){const offset=r.ulong(),actual=r.ulong(),stored=r.ulong(),owner=guidString(r.take(16)),type=guidString(r.take(16)),hash=r.take(8).readBigUInt64LE(),flags=r.uint(),format=r.take(1)[0];if(offset<dataOffset||offset+stored>data.length)throw new Error('Invalid resource segment range.');segments.push({actual,owner,type,hash,flags,format,data:Buffer.from(data.subarray(offset,offset+stored))});}
 if(r.uint()!==0||r.offset!==dataOffset)throw new Error('Unsupported resource dependencies or header layout.');
 return {packageId,type,id,version,name,metadata,metadataChecksum,segments};
}
export async function writeResource(p){
 const metadataSize=u64(p.metadata.length),hash=await checksum(Buffer.concat([metadataSize,p.metadata]));
 const headerSize=72+string(p.name).length+8+p.metadata.length+8+4+p.segments.length*69+4;let offset=headerSize;
 const records=p.segments.map(s=>{const record=Buffer.concat([u64(offset),u64(s.actual),u64(s.data.length),guidBytes(s.owner),guidBytes(s.type),u64(s.hash),u32(s.flags),Buffer.from([s.format])]);offset+=s.data.length;return record;});
 return Buffer.concat([Buffer.from('TPAC'),u32(2),guidBytes(p.packageId),u32(1),u32(headerSize-36),u32(0),guidBytes(p.type),guidBytes(p.id),u32(p.version),string(p.name),metadataSize,p.metadata,u64(hash),u32(records.length),...records,u32(0),...p.segments.map(s=>s.data)]);
}
export function unpackSegment(s){
 if(s.format===0){if(s.data.length!==s.actual)throw new Error('Incorrect raw segment size.');return Buffer.from(s.data);}
 if(s.format!==1||s.actual>1024*1024)throw new Error('Unsupported template segment compression.');
 const source=s.data,out=Buffer.alloc(s.actual);let i=0,o=0;
 const length=base=>{let n=base;if(base===15){let b;do{if(i>=source.length)throw new Error('Invalid LZ4 length.');b=source[i++];n+=b;}while(b===255);}return n;};
 while(i<source.length){const token=source[i++],literal=length(token>>>4);if(i+literal>source.length||o+literal>out.length)throw new Error('Invalid LZ4 literals.');source.copy(out,o,i,i+literal);i+=literal;o+=literal;if(i===source.length)break;if(i+2>source.length)throw new Error('Invalid LZ4 offset.');const distance=source.readUInt16LE(i);i+=2;const match=length(token&15)+4;if(!distance||distance>o||o+match>out.length)throw new Error('Invalid LZ4 match.');for(let j=0;j<match;j++)out[o+j]=out[o+j-distance];o+=match;}
 if(o!==out.length)throw new Error('Incomplete template segment.');return out;
}
export function textureLayout(metadata){
 const r=new Reader(metadata);if(r.uint()!==3)throw new Error('This compiler supports Bannerlord texture metadata version 3.');r.take(20);const sourceStart=r.offset,source=r.str(),sourceEnd=r.offset,sourceHash=r.offset;r.take(13);const flagsStart=r.offset,flags=r.strings(),flagsEnd=r.offset;r.take(5);const width=r.offset;r.take(4);const height=r.offset;r.take(8);const mipmaps=r.offset;r.take(1);const arrays=r.offset;r.take(2);const formatStart=r.offset,format=r.str(),formatEnd=r.offset;
 return {sourceStart,sourceEnd,source,sourceHash,flagsStart,flagsEnd,flags,width,height,mipmaps,arrays,formatStart,formatEnd,format};
}
export function materialLayout(metadata){
 const r=new Reader(metadata);if(r.uint()!==0)throw new Error('Unsupported material metadata version.');r.take(24);const flagsStart=r.offset,flags=r.strings(),flagsEnd=r.offset;r.take(4);const vertexStart=r.offset,vertexFlags=r.strings(),vertexEnd=r.offset,blendStart=r.offset,blendMode=r.str(),blendEnd=r.offset,shaderStart=r.offset,shader=guidString(r.take(16)),n=r.uint();if(n>64)throw new Error('Invalid material texture bindings.');let diffuse=-1;
 for(let i=0;i<n;i++){const slot=r.uint();if(slot===0)diffuse=r.offset;r.take(16);}
 const alphaOffset=r.offset,alphaTest=r.take(4).readFloatLE(),shaderFlagsStart=r.offset,shaderFlags=r.strings(),shaderFlagsEnd=r.offset;
 return {flagsStart,flagsEnd,flags,vertexStart,vertexEnd,vertexFlags,blendStart,blendEnd,blendMode,shaderStart,shader,diffuse,alphaOffset,alphaTest,shaderFlagsStart,shaderFlagsEnd,shaderFlags};
}
export async function validateResource(p){
 if(await checksum(Buffer.concat([u64(p.metadata.length),p.metadata]))!==p.metadataChecksum)throw new Error('Template metadata checksum is invalid.');
 for(const s of p.segments)if(await checksum(unpackSegment(s))!==s.hash)throw new Error('Template segment checksum is invalid.');
}
export async function compileTexture({template,existing,name,moduleId,sourceRelative,sourceBytes,rgba,width,height,sourceWidth=width,sourceHeight=height,encoded,textureFlags=null}){
 if(!/^[-a-z0-9_]{1,160}$/i.test(name)||!/^[-a-z0-9_.]{1,160}$/i.test(moduleId))throw new Error('Invalid resource or module name.');
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<8||height<8||width>4096||height>4096||width%4||height%4||rgba.length!==width*height*4)throw new Error('Texture must have RGBA pixels and dimensions divisible by four, up to 4096.');
 const base=readResource(template);await validateResource(base);if(base.type!==TEXTURE)throw new Error('A texture template is required.');
 const previous=existing?readResource(existing):null;if(previous){await validateResource(previous);if(previous.type!==TEXTURE||previous.name!==name)throw new Error('Existing texture identity does not match.');}
 const p=previous||base,l=textureLayout(p.metadata);if(p.metadata.readUInt16LE(l.arrays)!==1)throw new Error('Texture arrays are not supported by this compiler.');
 const packageId=previous?.packageId||randomUUID(),id=previous?.id||randomUUID(),sourceHash=await checksum(sourceBytes);
 p.packageId=packageId;p.id=id;p.name=name;
 const pixels=encoded?.data??rgba,mipCount=encoded?.mipCount??1,format=encoded?.format??'R8G8B8A8_UNORM';
 if(!['R8G8B8A8_UNORM','DXT1','DXT5','BC7'].includes(format)||!Number.isInteger(mipCount)||mipCount<1||mipCount>Math.floor(Math.log2(Math.max(width,height)))+1)throw new Error('Invalid encoded texture format or mip count.');
 let expectedBytes=0;for(let i=0;i<mipCount;i++){const w=Math.max(1,width>>i),h=Math.max(1,height>>i);expectedBytes+=format==='R8G8B8A8_UNORM'?w*h*4:Math.ceil(w/4)*Math.ceil(h/4)*(format==='DXT1'?8:16);}if(pixels.length!==expectedBytes)throw new Error('Encoded texture byte count does not match its format and mip levels.');
 p.metadata.writeBigUInt64LE(sourceHash,l.sourceHash);p.metadata.writeUInt32LE(width,l.width);p.metadata.writeUInt32LE(height,l.height);p.metadata[l.mipmaps]=mipCount;
 p.metadata=replace(p.metadata,l.formatStart,l.formatEnd,string(format));
 if(textureFlags!==null)p.metadata=replace(p.metadata,l.flagsStart,l.flagsEnd,strings(textureFlags));
 p.metadata=replace(p.metadata,l.sourceStart,l.sourceEnd,string('$BASE/Modules/'+moduleId+'/'+sourceRelative.replaceAll('\\','/')));
 const settings=p.segments.find(s=>s.type===IMPORT_SETTINGS);if(!settings)throw new Error('Template texture import settings are missing.');
 const settingsData=unpackSegment(settings),settingsHash=await checksum(settingsData);
 const info=Buffer.concat([u32(sourceWidth),u32(sourceHeight),u32(1),u32(1),u32(1),string('B8G8R8A8_UNORM'),u64(sourceBytes.length)]);
 if(p.segments.some(s=>![SOURCE_INFO,IMPORT_SETTINGS].includes(s.type)))throw new Error('Template has unsupported texture segments.');
 p.segments=[{type:SOURCE_INFO,owner:id,actual:info.length,hash:await checksum(info),flags:0,format:0,data:info},{type:IMPORT_SETTINGS,owner:id,actual:settingsData.length,hash:settingsHash,flags:settings.flags,format:0,data:settingsData}];
 // The record itself is not LZ-compressed. GPU blocks/mips are described by
 // texture metadata; one array slice is stored from largest mip to smallest.
 const record=Buffer.concat([guidBytes(id),guidBytes(id),guidBytes(PIXELS),u64(165),u64(pixels.length),u64(pixels.length),Buffer.from([0]),u64(sourceHash),u64(settingsHash),Buffer.alloc(51),Buffer.from([250,250,250,250,0])]);
 if(record.length!==145)throw new Error('Incorrect texture runtime record size.');
 const rdc=Buffer.concat([Buffer.from('RDC0'),u32(0),u32(1),u64(145),record,pixels]);
 const tpac=await writeResource(p);await validateResource(readResource(tpac));
 return {name,id,packageId,tpac,rdc,width,height,format,mipCount,rdcName:packageId.toUpperCase()+'.rdc'};
}
export async function compileMaterial({template,existing,name,textureId,templateTextureId,settings}){
 const previous=existing?readResource(existing):null;if(previous)await validateResource(previous);
 const p=readResource(settings?.template?template:existing||template);await validateResource(p);if(p.type!==MATERIAL||p.segments.length)throw new Error('Expected a simple banner material template.');
 if(previous&&(previous.name!==name||previous.type!==MATERIAL))throw new Error('Existing material identity does not match.');
 // Locate the diffuse slot through the actual material metadata fields.
 const layout=materialLayout(p.metadata),diffuse=layout.diffuse;
 if(diffuse<0)throw new Error('Banner material template has no diffuse texture.');
 if(!existing&&templateTextureId&&guidString(p.metadata.subarray(diffuse,diffuse+16))!==templateTextureId)throw new Error('Banner material template has an unexpected diffuse binding.');
 p.id=previous?.id||randomUUID();p.packageId=previous?.packageId||randomUUID();p.name=name;guidBytes(textureId).copy(p.metadata,diffuse);
 if(settings?.override){
  p.metadata.writeFloatLE(settings.alphaTest,layout.alphaOffset);
  for(const [start,end,data] of [[layout.shaderFlagsStart,layout.shaderFlagsEnd,strings(settings.shaderFlags)],[layout.blendStart,layout.blendEnd,string(settings.blendMode)],[layout.vertexStart,layout.vertexEnd,strings(settings.vertexFlags)],[layout.flagsStart,layout.flagsEnd,strings(settings.flags)]])p.metadata=replace(p.metadata,start,end,data);
 }
 const tpac=await writeResource(p);await validateResource(readResource(tpac));return {name,id:p.id,packageId:p.packageId,tpac};
}
export async function readEditableResource(file){return readResource(await fs.readFile(file));}
