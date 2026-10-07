module.exports = {
  createStreamingSTT: jest.fn().mockResolvedValue({
    createStream: jest.fn().mockResolvedValue({
      acceptWaveform: jest.fn().mockResolvedValue(undefined),
      getResult: jest.fn().mockResolvedValue({
        text: '',
        timestamps: [],
        tokens: [],
      }),
      inputFinished: jest.fn().mockResolvedValue(undefined),
      isReady: jest.fn().mockResolvedValue(false),
      processAudioChunk: jest.fn().mockResolvedValue({
        isEndpoint: false,
        result: {
          text: '',
          timestamps: [],
          tokens: [],
        },
      }),
      release: jest.fn().mockResolvedValue(undefined),
      reset: jest.fn().mockResolvedValue(undefined),
    }),
    destroy: jest.fn().mockResolvedValue(undefined),
  }),
};
