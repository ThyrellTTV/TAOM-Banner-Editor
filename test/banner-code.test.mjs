import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {saveBannerSource} from '../source-store.mjs';
import {decode,encode} from '../public/banner-code.mjs';
import {loadLibrary,replaceBannerAttribute} from '../library.mjs';
const root=path.resolve(import.meta.dirname,'..');
const config=JSON.parse(await fs.readFile(path.join(root,'config.json'),'utf8'));
const library=await loadLibrary(config.modulePath,config.gamePath);
test('all real module XML and XSLT banners round-trip without changing a value',()=>{
  assert.ok(library.banners.length>200);
  assert.ok(library.banners.some(b=>b.name==='Gondor'));
  assert.ok(library.banners.some(b=>b.format==='xslt-attribute'));
  for(const banner of library.banners)assert.equal(encode(decode(banner.code)),banner.code,banner.key);
});
test('rejects malformed and partial banner codes',()=>{
  for(const code of ['', '1.2.3', '11.1.1.1528.1528.764.764.0.2.0','11.1.1.1528.1528.764.764.0.0.NaN','11.1.1.1528.1528.764.764.0.0.0.'])assert.throws(()=>decode(code));
});
test('preserves negative scales, signed rotations, and codes above the ordinary layer cap',()=>{
  const code=Array.from({length:60},()=> '503.172.171.-500.350.764.764.1.1.-90').join('.');
  assert.equal(encode(decode(code)),code);
});
test('changes only the requested banner code in every real source format',async()=>{
  for(const banner of library.banners){
    const original=await fs.readFile(path.join(config.modulePath,banner.source),'utf8');
    const layers=decode(banner.code);layers.at(-1).x+=1;const code=encode(layers);
    const modified=replaceBannerAttribute(original,banner,code,banner.code);
    assert.notEqual(modified,original,banner.key);
    assert.equal(modified.replace(code,banner.code),original,banner.key);
    assert.throws(()=>replaceBannerAttribute(original,banner,code,'stale code'),/changed on disk/,banner.key);
  }
});
test('source reference diagnostics preserve unknown IDs without silently substituting them',()=>{
  const icons=new Set(library.icons.map(i=>i.id)),backgrounds=new Set(library.backgrounds.map(i=>i.id)),colors=new Set(library.colors.map(i=>i.id));
  const missing=new Set(),missingSymbols=new Set();
  for(const b of library.banners)decode(b.code).forEach((l,i)=>{if(!(i?icons:backgrounds).has(l.meshId))missingSymbols.add(l.meshId);for(const id of [l.colorId,l.colorId2])if(!colors.has(id))missing.add(id);});
  // These are pre-existing references absent from the installed Native + TAOM palette.
  // Preserving them is deliberate: loading a banner must not silently recolour it.
  console.log('Existing unresolved palette references:',[...missing].sort((a,b)=>a-b).join(', ')||'none');
  console.log('Existing unresolved symbol references:',[...missingSymbols].join(', ')||'none');
  assert.ok(library.colors.every(c=>/^#[0-9a-f]{6}$/i.test(c.hex)));
  for(const id of missingSymbols){const b=library.banners.find(b=>decode(b.code).some(l=>l.meshId===id));assert.equal(encode(decode(b.code)),b.code);}
});
test('disk save backs up exact original bytes, preserves formatting and rejects stale writes',async()=>{
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'taom-banner-store-'));
  try{
    for(const sample of [library.banners.find(b=>b.source.endsWith('.xml')),library.banners.find(b=>b.format==='xslt-attribute')]){
      const entry=structuredClone(sample),modulePath=path.join(temp,'module');
      const destination=path.join(modulePath,entry.source);await fs.mkdir(path.dirname(destination),{recursive:true});
      const original=await fs.readFile(path.join(config.modulePath,entry.source));await fs.writeFile(destination,original);
      const layers=decode(entry.code);layers.at(-1).x+=17;const newCode=encode(layers),oldCode=entry.code;
      const result=await saveBannerSource({root:temp,modulePath,library:{banners:[entry]},data:{key:entry.key,code:newCode,expectedCode:oldCode}});
      assert.deepEqual(await fs.readFile(result.backup),original);
      const updated=await fs.readFile(destination,'utf8');assert.equal(updated.replace(newCode,oldCode),original.toString('utf8'));
      assert.equal(entry.code,newCode);
      await assert.rejects(saveBannerSource({root:temp,modulePath,library:{banners:[entry]},data:{key:entry.key,code:oldCode,expectedCode:oldCode}}),/changed on disk/);
      assert.equal(await fs.readFile(destination,'utf8'),updated);
    }
  } finally {
    const resolved=path.resolve(temp);
    assert.equal(path.dirname(resolved),path.resolve(os.tmpdir()));
    assert.ok(path.basename(resolved).startsWith('taom-banner-store-'));
    await fs.rm(resolved,{recursive:true,force:true});
  }
});
