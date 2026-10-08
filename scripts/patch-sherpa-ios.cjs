const fs = require('node:fs');
const path = require('node:path');

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
