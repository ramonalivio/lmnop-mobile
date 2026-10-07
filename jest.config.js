module.exports = {
  preset: '@react-native/jest-preset',
  moduleNameMapper: {
    '^whisper.rn/index$': '<rootDir>/__mocks__/whisper-rn.js',
    '^@react-native-async-storage/async-storage$':
      '<rootDir>/__mocks__/@react-native-async-storage/async-storage.js',
    '^react-native-sherpa-onnx$':
      '<rootDir>/__mocks__/react-native-sherpa-onnx.js',
    '^react-native-sherpa-onnx/audio$':
      '<rootDir>/__mocks__/react-native-sherpa-onnx-audio.js',
    '^react-native-sherpa-onnx/stt$':
      '<rootDir>/__mocks__/react-native-sherpa-onnx-stt.js',
  },
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?)/)',
  ],
};
