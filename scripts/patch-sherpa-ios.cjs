const fs = require('node:fs');
const path = require('node:path');

const wrapper = path.join(
  __dirname,
  '../node_modules/react-native-sherpa-onnx/ios/online_stt/sherpa-onnx-online-stt-wrapper.mm'
);
const original = '        config.model_config.model_type = "zipformer";';
const patched =
  '        config.model_config.model_type = "zipformer2"; // LMNOP bundled streaming transducer';
const withVocabulary = patched + '\n        config.model_config.modeling_unit = "bpe";\n        config.model_config.bpe_vocab = modelDir + "/bpe.vocab";';
const source = fs.readFileSync(wrapper, 'utf8');

if (source.includes(withVocabulary) && !source.includes(original)) {
  console.log('Sherpa iOS Zipformer 2 patch already applied.');
} else if (source.includes(patched) && !source.includes(original)) {
  fs.writeFileSync(wrapper, source.replace(patched, withVocabulary));
} else if (source.split(original).length === 2 && !source.includes(patched)) {
  fs.writeFileSync(wrapper, source.replace(original, withVocabulary));
  console.log('Applied Sherpa iOS Zipformer 2 loader patch.');
} else {
  throw new Error('Sherpa iOS wrapper changed; review the Zipformer 2 patch before building.');
}

const capturePath = path.join(__dirname, '../node_modules/react-native-sherpa-onnx/ios/SherpaOnnx+PcmLiveStream.mm');
const currentCapture = fs.readFileSync(capturePath, 'utf8');
const nativeRateOriginal = '  _pcmLiveCaptureRate = chosenCaptureRate;';
const nativeRatePatched = nativeRateOriginal + '\n  _pcmLiveTargetSampleRate = chosenCaptureRate; // LMNOP let Sherpa resample continuous PCM';
if (!currentCapture.includes(nativeRatePatched)) {
  if (currentCapture.split(nativeRateOriginal).length !== 2) {
    throw new Error('Sherpa capture sample-rate contract changed.');
  }
  fs.writeFileSync(capturePath, currentCapture.replace(nativeRateOriginal, nativeRatePatched));
}

const androidPath = path.join(__dirname, '../node_modules/react-native-sherpa-onnx/android/src/main/java/com/sherpaonnx/SherpaOnnxOnlineSttHelper.kt');
const android = fs.readFileSync(androidPath, 'utf8');
const androidOriginal = '        modelType = "zipformer"';
const androidPatched = '        modelType = "zipformer2",\n        modelingUnit = "bpe",\n        bpeVocab = "$modelDir/bpe.vocab" // LMNOP streaming vocabulary';
if (!android.includes(androidPatched)) {
  if (android.split(androidOriginal).length !== 2) {
    throw new Error('Sherpa Android transducer configuration changed.');
  }
  fs.writeFileSync(androidPath, android.replace(androidOriginal, androidPatched));
}

const capture = fs.readFileSync(capturePath, 'utf8');
const rateOriginal = '    chosenCaptureRate = kPcmLiveCaptureRates[r];';
const ratePatched = '    chosenCaptureRate = r == 0 ? (int)session.sampleRate : kPcmLiveCaptureRates[r]; // LMNOP hardware rate first';
if (capture.includes(ratePatched)) {
  console.log('Sherpa hardware capture rate patch already applied.');
} else if (capture.split(rateOriginal).length === 2) {
  fs.writeFileSync(capturePath, capture.replace(rateOriginal, ratePatched));
} else {
  throw new Error('Sherpa PCM capture changed; review the hardware rate patch.');
}
