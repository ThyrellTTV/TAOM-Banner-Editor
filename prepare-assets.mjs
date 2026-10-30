import fs from 'node:fs/promises';
import path from 'node:path';
import { readPsd, initializeCanvas } from 'ag-psd';
import sharp from 'sharp';
initializeCanvas(undefined, (width,height) => ({width,height,data:new Uint8ClampedArray(width*height*4)}));
export async function prepareSourceTextures(root, assets, modulePath, icons=[]) {
  // Newly registered PSDs can be previewed before their game material is compiled.
  for(const icon of icons){
    if(icon.source!=='TAOM'||!/^taom_banners_[a-z0-9_]+$/.test(icon.material))continue;
    const material=assets.materials[icon.material];
    if(assets.textures[material?.slots?.['0']])continue;
    const guid='source-'+icon.material;
    assets.materials[icon.material]={...material,name:icon.material,slots:{...material?.slots,'0':guid}};
    assets.textures[guid]??={name:icon.material,images:[]};
  }
  for (const [guid, texture] of Object.entries(assets.textures)) {
    if (texture.images.length || !texture.name.startsWith('taom_banners_')) continue;
    const source = path.join(modulePath, 'AssetSources', 'BannerIcons', texture.name + '.psd');
    try {
      const stat = await fs.stat(source);
      const file = path.join(root, 'cache', 'textures', guid.replaceAll('-','') + '_source.png');
      const cached = await fs.stat(file).catch(() => null);
      if (!cached || cached.mtimeMs < stat.mtimeMs) {
        const psd = readPsd(await fs.readFile(source), { useImageData: true, skipLayerImageData: true, skipThumbnail: true });
        if (!psd.imageData) throw new Error('PSD has no merged image');
        await sharp(Buffer.from(psd.imageData.data), { raw: { width: psd.width, height: psd.height, channels: 4 } }).png().toFile(file);
        console.log('Prepared source artwork: ' + texture.name);
      }
      texture.images = ['/cache/textures/' + path.basename(file)];
      texture.source = source;
    } catch (error) { assets.errors.push(texture.name + ': ' + error.message); }
  }
  return assets;
}
