import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { Modal, TextInput } from 'react-native';
import { TranscriptEditor } from '../speech/TranscriptEditor';
jest.mock('react-native-safe-area-context', () => {
  const { View } = require('react-native');
  return { SafeAreaProvider: View, SafeAreaView: View };
});
test.each([
  { start: 5, end: 5 },
  { start: 5, end: 15 },
])('preserves initial range %j through modal focus', async range => {
  const onDone = jest.fn();
  let tree!: Renderer.ReactTestRenderer;
  await act(() => {
    tree = Renderer.create(
      <TranscriptEditor
        selection={{ source: 'Take amlodipine daily.', ...range }}
        onDone={onDone}
      />,
    );
  });
  expect(tree.root.findAllByType(TextInput)).toHaveLength(0);
  await act(() => tree.root.findByType(Modal).props.onShow());
  const editor = () => tree.root.findByType(TextInput);
  expect(editor().props.autoFocus).toBe(true);
  expect(editor().props.selection).toEqual(range);
  await act(() =>
    editor().props.onSelectionChange({
      nativeEvent: { selection: { start: 0, end: 0 } },
    }),
  );
  expect(editor().props.selection).toEqual(range);
  await act(() =>
    editor().props.onSelectionChange({ nativeEvent: { selection: range } }),
  );
  await act(() =>
    editor().props.onSelectionChange({
      nativeEvent: { selection: { start: 16, end: 21 } },
    }),
  );
  await act(() => tree.root.findByType(Modal).props.onRequestClose());
  expect(onDone).toHaveBeenCalledWith({
    source: 'Take amlodipine daily.',
    start: 16,
    end: 21,
  });
  await act(() => tree.unmount());
});
