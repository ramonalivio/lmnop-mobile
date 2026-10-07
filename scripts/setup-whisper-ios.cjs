/* Install the exact Whisper Small English INT8 files evaluated locally. */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const source = process.argv[2];
if (!source)
  throw new Error(
    'Usage: node scripts/setup-whisper-ios.cjs <model-directory>',
  );
const hashes = {
  'small.en-decoder.int8.onnx':
    '710ccf890e10f3faa15f51ec346081a2723c9f3adb6e4da81c6573a5a6f877fb',
  'small.en-encoder.int8.onnx':
    '8bdac288f369aa94ee2194059238c465ed82ea9d47ee8fa4a8c0a891873e462f',
  'small.en-tokens.txt':
    '306cd27f03c1a714eca7108e03d66b7dc042abe8c258b44c199a7ed9838dd930',
};
for (const [name, expected] of Object.entries(hashes)) {
  const bytes = fs.readFileSync(path.join(source, name));
  if (crypto.createHash('sha256').update(bytes).digest('hex') !== expected)
    throw new Error(`Checksum mismatch: ${name}`);
}
const destination = path.resolve(
  __dirname,
  '../ios/LmnopMobile/models/whisper-small-en',
);
fs.mkdirSync(destination, { recursive: true });
for (const name of Object.keys(hashes))
  fs.copyFileSync(path.join(source, name), path.join(destination, name));
console.log('Verified Whisper Small English INT8 assets installed.');
fs.copyFileSync(
  path.resolve(__dirname, '../native/whisper/LICENSE'),
  path.join(destination, 'LICENSE'),
);
