export const FIELDS = ['meshId','colorId','colorId2','width','height','x','y','stroke','mirror','rotation'];
export function decode(code) {
  const text = String(code).trim();
  if (!/^-?\d+(?:\.-?\d+)*$/.test(text)) throw new Error('Use a dot-separated game banner code containing whole numbers.');
  const values = text.split('.').map(Number);
  if (values.length % 10 || values.length < 10) throw new Error('Each layer must contain exactly ten values.');
  if (values.some(n => !Number.isSafeInteger(n) || Math.abs(n) > 2147483647)) throw new Error('A value is outside the game integer range.');
  return Array.from({length: values.length / 10}, (_, i) => {
    const layer = Object.fromEntries(FIELDS.map((key, j) => [key, values[i * 10 + j]]));
    if (![0,1].includes(layer.stroke) || ![0,1].includes(layer.mirror)) throw new Error('Outline and mirror values must be 0 or 1.');
    return layer;
  });
}
export function encode(layers) {
  if (!layers.length) throw new Error('A banner needs a background.');
  const code = layers.flatMap(layer => FIELDS.map(key => Math.trunc(layer[key]))).join('.');
  decode(code);
  return code;
}
export function defaultBanner() { return decode('11.149.166.1528.1528.764.764.1.0.0.10000.172.171.500.500.764.764.0.0.0'); }
