/* Verify the pinned offline assets before copying them into the iOS build. */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const [archive, sourceModel] = process.argv.slice(2);
if (!archive || !sourceModel) {
  throw new Error(
    'Usage: node scripts/setup-moonshine-ios.cjs <Moonshine.xcframework.zip> <model-directory>',
  );
}
const mobile = path.resolve(__dirname, '..');
const native = path.join(mobile, 'native/moonshine');
const fixture = require('../test-fixtures/dictation/001/results/lmnop-case001-moonshine-medium-medical.json');
function verify(file, expected) {
  const digest = crypto
    .createHash('sha256')
    .update(fs.readFileSync(file))
    .digest('hex');
  if (digest !== expected) throw new Error(`Checksum mismatch: ${file}`);
}
verify(
  archive,
  '6bc7fb4b6d3a470a2ae2d681299975f3ba9d710753786d1cd7e8beabaad066e8',
);
for (const [name, metadata] of Object.entries(fixture.model_files)) {
  verify(path.join(sourceModel, name), metadata.sha256);
}
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'lmnop-moonshine-'));
try {
  execFileSync('unzip', ['-q', path.resolve(archive), '-d', temporary]);
  fs.mkdirSync(path.join(native, 'Frameworks'), { recursive: true });
  fs.cpSync(
    path.join(temporary, 'Moonshine.xcframework'),
    path.join(native, 'Frameworks/Moonshine.xcframework'),
    { recursive: true },
  );
  const destination = path.join(
    mobile,
    'ios/LmnopMobile/models/moonshine-medium-streaming-en-26-08-21',
  );
  fs.mkdirSync(destination, { recursive: true });
  for (const name of Object.keys(fixture.model_files)) {
    const target = path.join(destination, name);
    if (path.resolve(sourceModel, name) !== target)
      fs.copyFileSync(path.join(sourceModel, name), target);
    verify(target, fixture.model_files[name].sha256);
  }
  fs.copyFileSync(
    path.join(native, 'LICENSE'),
    path.join(destination, 'LICENSE'),
  );
  console.log(
    'Verified Moonshine 0.1.5 framework and case-001 model; assets installed. Run pod install in ios.',
  );
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
