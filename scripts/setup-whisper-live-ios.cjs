/* Download separately; verify the pinned Large V3 Q5_0 artifact for local evaluation. Mobile apps download it on demand. */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { pipeline } = require('node:stream/promises');
const name = 'ggml-large-v3-q5_0.bin';
const expected = 'd75795ecff3f83b5faa89d1900604ad8c780abd5739fae406de19f23ecd98ad1';
async function main() {
  if (!process.argv[2]) throw new Error('Usage: node scripts/setup-whisper-live-ios.cjs <model-file>');
  const source = path.resolve(process.argv[2]);
  const hash = crypto.createHash('sha256');
  await pipeline(fs.createReadStream(source), hash);
  if (hash.digest('hex') !== expected) throw new Error('Whisper model checksum mismatch');
  const target = path.resolve(__dirname, '../../../dist/speech-models/whisper-large-v3');
  fs.mkdirSync(target, { recursive: true });
  fs.copyFileSync(source, path.join(target, name));
  fs.copyFileSync(path.resolve(__dirname, '../native/whisper/LICENSE'), path.join(target, 'LICENSE'));
  fs.writeFileSync(path.join(target, 'manifest.json'), JSON.stringify({
    model: 'Whisper Large V3 Q5_0', file: name, sha256: expected,
    repository: 'ggerganov/whisper.cpp', revision: '5359861c739e955e79d9a303bcbc70fb988958b1',
    runtime: 'whisper.rn@0.7.4',
  }, null, 2) + '\n');
  console.log('Verified Whisper Large V3 Q5_0 in the local evaluation cache (not bundled).');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
