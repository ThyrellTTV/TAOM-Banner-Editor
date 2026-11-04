export const RESOLUTIONS=[1024,2048,4096];
export const BLEND_MODES=['no_alpha_blend','modulate','add_alpha','multiply','add','max','factor','add_modulate_combined','no_alpha_blend_no_write','modulate_no_write','gbuffer_alpha_blend','gbuffer_alpha_blend_with_vt_resolve'];
const choice=(value,fallback,values,label)=>{const selected=value??fallback;if(!values.includes(selected))throw new Error('Choose a valid '+label+'.');return selected;};
const boolean=(value,fallback,label)=>{if(value!==undefined&&typeof value!=='boolean')throw new Error('Invalid '+label+'.');return value??fallback;};
const flags=value=>{if(!Array.isArray(value)||value.length>64||value.some(v=>typeof v!=='string'||!(/^[a-z][a-z0-9_]{0,79}$/).test(v)))throw new Error('Resource flags must be lowercase names, one per line.');return [...new Set(value)];};
export function normalizeResourceSettings(input={}){
 if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('Invalid resource compilation settings.');
 const material=input.material??{};if(!material||typeof material!=='object'||Array.isArray(material))throw new Error('Invalid material settings.');
 const template=material.template??'';if(typeof template!=='string'||template&&!/^[-a-z0-9_]{1,160}$/i.test(template))throw new Error('Choose a registered material template.');
 const alphaTest=Number(material.alphaTest??127/255);if(!Number.isFinite(alphaTest)||alphaTest<0||alphaTest>1)throw new Error('Material alpha cutoff must be between 0 and 1.');
 return {
  newAtlasSize:choice(Number(input.newAtlasSize??2048),2048,RESOLUTIONS,'new PSD resolution'),
  atlasSize:choice(Number(input.atlasSize??0),0,[0,...RESOLUTIONS],'compiled atlas resolution'),
  atlasFormat:choice(input.atlasFormat,'rgba8',['rgba8','bc1','bc3','bc7'],'atlas texture format'),
  guiFormat:choice(input.guiFormat,'rgba8',['rgba8','bc3','bc7'],'thumbnail sheet texture format'),
  mipmaps:boolean(input.mipmaps,false,'atlas mipmap setting'),
  quality:choice(input.quality,'balanced',['fast','balanced','best'],'compression quality'),
  textureFlags:input.textureFlags==null?null:flags(input.textureFlags),
  material:{template,override:boolean(material.override,false,'material override setting'),blendMode:choice(material.blendMode,'modulate',BLEND_MODES,'material blend mode'),alphaTest,flags:flags(material.flags??['two_sided']),shaderFlags:flags(material.shaderFlags??['alpha_test']),vertexFlags:flags(material.vertexFlags??[])}
 };
}
