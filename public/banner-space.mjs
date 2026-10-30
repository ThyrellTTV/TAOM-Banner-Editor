// BannerVisual.GetMeshMatrix uses this space. The 512-unit editable area is
// a central guide; BannerBuilder's IsNineGrid=true tableau displays all 1528.
export const BANNER_SIZE=1528;
export const BANNER_CENTRE=BANNER_SIZE/2;
export const EDITABLE_GUIDE_SIZE=512;
export function bannerViewport(width,height,span=BANNER_SIZE){
  if(![width,height,span].every(value=>Number.isFinite(value)&&value>0))throw new Error('Invalid banner viewport.');
  const scale=Math.min(width,height)/span;
  return {scale,left:width/2-BANNER_CENTRE*scale,top:height/2-BANNER_CENTRE*scale,span};
}
export function canvasToBanner(x,y,width,height,span=BANNER_SIZE){
  const view=bannerViewport(width,height,span);
  return {x:(x-view.left)/view.scale,y:(y-view.top)/view.scale};
}
export function bannerToCanvas(x,y,width,height,span=BANNER_SIZE){
  const view=bannerViewport(width,height,span);
  return {x:x*view.scale+view.left,y:y*view.scale+view.top};
}
