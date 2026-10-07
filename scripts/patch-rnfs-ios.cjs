/* eslint-env node, es2020 */
const fs = require('node:fs');
const path = require('node:path');

function patchSource(source) {
  const start = source.indexOf('RCT_EXPORT_METHOD(read:(NSString *)filepath');
  const end = source.indexOf('RCT_EXPORT_METHOD(hash:', start);
  if (start < 0 || end < 0) throw new Error('RNFS read method changed; review the iOS bridge patch.');
  const method = source.slice(start, end);
  if (source.includes('// LMNOP: boxed numeric arguments for React Native interop.')) {
    if (!method.includes('length: (NSNumber *)length') || !method.includes('position: (NSNumber *)position') || !method.includes('[file closeFile]')) throw new Error('RNFS patched method changed; review it.');
    return source;
  }
  const substitutions = [
    ['length: (NSInteger *)length', 'length: (NSNumber *)length'],
    ['position: (NSInteger *)position', 'position: (NSNumber *)position'],
    ['[file seekToFileOffset: (int)position];', '[file seekToFileOffset:[position unsignedLongLongValue]];'],
    ['if ((int)length > 0)', 'if ([length unsignedIntegerValue] > 0)'],
    ['[file readDataOfLength: (int)length]', '[file readDataOfLength:[length unsignedIntegerValue]]'],
    ['    resolve(base64Content);', '    [file closeFile];\n    resolve(base64Content);'],
  ];
  let patched = method;
  for (const [before, after] of substitutions) {
    if (patched.split(before).length !== 2) throw new Error('RNFS read implementation changed; review the iOS bridge patch.');
    patched = patched.replace(before, after);
  }
  patched = '// LMNOP: boxed numeric arguments for React Native interop.\n' + patched;
  return source.slice(0, start) + patched + source.slice(end);
}
module.exports = { patchSource };
if (require.main === module) {
  const file = path.resolve(__dirname, '../node_modules/react-native-fs/RNFSManager.m');
  const source = fs.readFileSync(file, 'utf8');
  const patched = patchSource(source);
  if (patched !== source) fs.writeFileSync(file, patched);
  console.log('RNFS iOS numeric read bridge patch verified.');
}
