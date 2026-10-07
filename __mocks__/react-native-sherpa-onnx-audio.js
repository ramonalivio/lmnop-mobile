module.exports = {
  createPcmLiveStream: () => ({
    onData: () => () => undefined,
    onError: () => () => undefined,
    start: jest.fn().mockResolvedValue(undefined),
    stop: jest.fn().mockResolvedValue(undefined),
  }),
};
