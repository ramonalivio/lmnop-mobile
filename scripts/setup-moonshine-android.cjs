/* Copy the exact checksum-pinned iOS Moonshine Medium model for Android. */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const mobile = path.resolve(__dirname, '..');
const model = 'moonshine-medium-streaming-en-26-08-21';
const source = path.resolve(process.argv[2] || path.join(mobile, 'ios/LmnopMobile/models', model));
const destination = path.join(mobile, 'android/app/src/main/assets/models', model);
const fixture = require('../test-fixtures/dictation/001/results/lmnop-case001-moonshine-medium-medical.json');
fs.mkdirSync(destination, { recursive: true });
for (const [name, metadata] of Object.entries(fixture.model_files)) {
  const bytes = fs.readFileSync(path.join(source, name));
  if (crypto.createHash('sha256').update(bytes).digest('hex') !== metadata.sha256)
    throw new Error(`Moonshine checksum mismatch: ${name}`);
  fs.writeFileSync(path.join(destination, name), bytes);
}
fs.copyFileSync(path.join(mobile, 'native/moonshine/LICENSE'), path.join(destination, 'LICENSE'));
console.log('Installed verified Moonshine Medium 26-08-21 model for Android (runtime 0.1.5).');
