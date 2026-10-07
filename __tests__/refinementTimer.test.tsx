import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { RefinementTimer } from '../speech/RefinementTimer';
test('counter starts on Stop, freezes on completion, and resets on next recording', async () => {
  jest.useFakeTimers();
  let tree!: Renderer.ReactTestRenderer;
  try {
    await act(async () => {
      tree = Renderer.create(<RefinementTimer active={false} reset={false} />);
    });
    expect(tree.toJSON()).toBeNull();
    await act(async () => {
      tree.update(<RefinementTimer active reset={false} />);
    });
    await act(async () => {
      jest.advanceTimersByTime(2400);
    });
    expect(JSON.stringify(tree.toJSON())).toContain('2.4');
    await act(async () => {
      tree.update(<RefinementTimer active={false} reset={false} />);
    });
    await act(async () => {
      jest.advanceTimersByTime(2000);
    });
    expect(JSON.stringify(tree.toJSON())).toContain('2.4');
    await act(async () => {
      tree.update(<RefinementTimer active={false} reset />);
    });
    expect(tree.toJSON()).toBeNull();
  } finally {
    if (tree) await act(async () => tree.unmount());
    jest.useRealTimers();
  }
});
