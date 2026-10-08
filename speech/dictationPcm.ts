import { NativeEventEmitter, NativeModules, Platform } from 'react-native';
import type { PcmLiveStreamHandle } from 'react-native-sherpa-onnx/audio';

/** Use the native Android recorder and the Sherpa PCM stream on iOS. */
export function createDictationPcmStream(): PcmLiveStreamHandle {
  if (Platform.OS !== 'android')
    return require('react-native-sherpa-onnx/audio').createPcmLiveStream({
      sampleRate: 16000,
      channelCount: 1,
    });
  const native = NativeModules.DictationAudio;
  if (!native)
    throw new Error('Android microphone module is missing. Rebuild the app.');
  const events = new NativeEventEmitter(native);
  return {
    start: () => native.start(),
    stop: () => native.stop(),
    onData: callback => {
      const subscription = events.addListener('DictationPcm', samples =>
        callback(Float32Array.from(samples as number[]), 16000),
      );
      return () => subscription.remove();
    },
    onError: callback => {
      const subscription = events.addListener('DictationAudioError', message =>
        callback(String(message)),
      );
      return () => subscription.remove();
    },
  };
}
