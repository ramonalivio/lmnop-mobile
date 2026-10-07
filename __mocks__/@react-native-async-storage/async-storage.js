const store = new Map();

const AsyncStorage = {
  getItem: jest.fn(async key => (store.has(key) ? store.get(key) : null)),
  removeItem: jest.fn(async key => {
    store.delete(key);
  }),
  setItem: jest.fn(async (key, value) => {
    store.set(key, value);
  }),
};

module.exports = {
  __esModule: true,
  default: AsyncStorage,
  ...AsyncStorage,
};
