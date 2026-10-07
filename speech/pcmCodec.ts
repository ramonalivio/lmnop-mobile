const alphabet =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
export function encodePcm(samples: Float32Array) {
  const bytes = new Uint8Array(samples.length * 2);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < samples.length; i++)
    view.setInt16(
      i * 2,
      Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767),
      true,
    );
  let result = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const value =
      (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    result +=
      alphabet[value >>> 18] +
      alphabet[(value >>> 12) & 63] +
      (i + 1 < bytes.length ? alphabet[(value >>> 6) & 63] : '=') +
      (i + 2 < bytes.length ? alphabet[value & 63] : '=');
  }
  return result;
}
export function decodePcm(value: string) {
  const bytes: number[] = [];
  for (let i = 0; i < value.length; i += 4) {
    const n =
      (alphabet.indexOf(value[i]) << 18) |
      (alphabet.indexOf(value[i + 1]) << 12) |
      (Math.max(0, alphabet.indexOf(value[i + 2])) << 6) |
      Math.max(0, alphabet.indexOf(value[i + 3]));
    bytes.push((n >>> 16) & 255);
    if (value[i + 2] !== '=') bytes.push((n >>> 8) & 255);
    if (value[i + 3] !== '=') bytes.push(n & 255);
  }
  const view = new DataView(Uint8Array.from(bytes).buffer);
  return Float32Array.from(
    { length: bytes.length / 2 },
    (_, i) => view.getInt16(i * 2, true) / 32768,
  );
}
