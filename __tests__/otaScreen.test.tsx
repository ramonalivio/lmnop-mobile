import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { AppState, BackHandler, Modal, Text } from 'react-native';
import { HotUpdater } from '@hot-updater/react-native';
import { withOtaUpdates } from '../src/withOtaUpdates';
jest.mock('@hot-updater/react-native', () => ({
  HotUpdater: { init: jest.fn(), checkForUpdate: jest.fn(), reload: jest.fn() },
  useHotUpdaterStore: () => 0.5,
}));
let tree: Renderer.ReactTestRenderer;
let event: (state: any) => void;
let mounts = 0;
function App() {
  React.useEffect(() => {
    mounts++;
  }, []);
  return <Text>Main app</Text>;
}
beforeEach(() => {
  jest.clearAllMocks();
  mounts = 0;
  (globalThis as any).__DEV__ = false;
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_, listener) => {
    event = listener;
    return { remove: jest.fn() };
  });
  jest
    .spyOn(BackHandler, 'addEventListener')
    .mockReturnValue({ remove: jest.fn() });
  jest.mocked(HotUpdater.checkForUpdate).mockResolvedValue(null);
});
afterEach(async () => {
  if (tree) await act(async () => tree.unmount());
  jest.restoreAllMocks();
  (globalThis as any).__DEV__ = true;
});
async function mount() {
  const Wrapped = withOtaUpdates(App);
  await act(async () => {
    tree = Renderer.create(<Wrapped />);
  });
}
async function resume() {
  await act(async () => {
    event('background');
    event('inactive');
    event('active');
  });
}
test.each([false, true])(
  'resume prompt buttons and mounted app: forced=%s',
  async forced => {
    await mount();
    const updateBundle = jest.fn().mockResolvedValue(true);
    jest
      .mocked(HotUpdater.checkForUpdate)
      .mockResolvedValue({ shouldForceUpdate: forced, updateBundle } as any);
    await resume();
    expect(
      tree.root.findAllByProps({ testID: 'ota-update-screen' }).length,
    ).toBeGreaterThan(0);
    expect(tree.root.findAllByType(Modal)).toHaveLength(0);
    expect(
      tree.root.findAll(
        node =>
          node.props.accessibilityRole === 'button' &&
          typeof node.props.onPress === 'function',
      ),
    ).toHaveLength(forced ? 1 : 2);
    expect(updateBundle).not.toHaveBeenCalled();
    const back = jest
      .mocked(BackHandler.addEventListener)
      .mock.calls.at(-1)![1];
    expect(back({ type: 'hardwareBackPress', timeStamp: 0 })).toBe(true);
    expect(
      tree.root.findAllByProps({ testID: 'ota-update-screen' }).length,
    ).toBeGreaterThan(0);
    expect(tree.root.findAllByType(Modal)).toHaveLength(0);
    if (!forced) {
      await act(async () =>
        tree.root
          .findAll(
            node =>
              node.props.accessibilityRole === 'button' &&
              typeof node.props.onPress === 'function',
          )[1]
          .props.onPress(),
      );
      expect(
        tree.root.findAllByProps({ testID: 'ota-update-screen' }),
      ).toHaveLength(0);
      expect(mounts).toBe(1);
    }
  },
);
test('cold launch waits for download and displays progress without asking', async () => {
  let complete!: (ok: boolean) => void;
  const updateBundle = jest.fn(
    () =>
      new Promise<boolean>(resolve => {
        complete = resolve;
      }),
  );
  jest
    .mocked(HotUpdater.checkForUpdate)
    .mockResolvedValue({ shouldForceUpdate: false, updateBundle } as any);
  await mount();
  expect(mounts).toBe(0);
  expect(
    tree.root.findAll(
      node =>
        node.props.accessibilityRole === 'button' &&
        typeof node.props.onPress === 'function',
    ),
  ).toHaveLength(0);
  expect(JSON.stringify(tree.toJSON())).toContain('50% downloaded');
  await act(async () => complete(true));
  expect(HotUpdater.reload).toHaveBeenCalledTimes(1);
});
test('a system permission dialog does not trigger a resume check', async () => {
  await mount();
  await act(async () => {
    event('inactive');
    event('active');
  });
  expect(HotUpdater.checkForUpdate).toHaveBeenCalledTimes(1);
});
