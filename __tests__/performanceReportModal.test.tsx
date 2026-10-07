import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Text, View } from 'react-native';
import { PerformanceReportModal } from '../speech/PerformanceReportModal';
import { submitPerformanceReport } from '../speech/performanceReports';
jest.mock('../speech/performanceReports', () => ({
  submitPerformanceReport: jest.fn(),
}));
test('discloses audio playback before consent, then shows progress and success without opening a browser', async () => {
  let root!: renderer.ReactTestRenderer;
  const onClose = jest.fn();
  let finish!: (url: string) => void;
  jest
    .mocked(submitPerformanceReport)
    .mockImplementation(async (_, progress) => {
      progress('Uploading…', 0.5);
      return new Promise(resolve => {
        finish = resolve;
      });
    });
  await act(async () => {
    root = renderer.create(
      <PerformanceReportModal visible token="session" onClose={onClose} />,
    );
  });
  expect(submitPerformanceReport).not.toHaveBeenCalled();
  const text = root.root
    .findAllByType(Text)
    .map(node => node.props.children)
    .join(' ');
  expect(text).toContain('Ramon can play and listen to your audio');
  expect(text).toContain('one hour old');
  await act(async () => {
    root.root.findByProps({ accessibilityLabel: 'Confirm sharing performance report' }).props.onPress();
  });
  expect(submitPerformanceReport).toHaveBeenCalledTimes(1);
  expect(
    root.root
      .findAllByType(View)
      .find(node => node.props.accessibilityRole === 'progressbar')!.props
      .accessibilityValue.now,
  ).toBe(50);
  await act(async () => {
    finish('https://test/report');
  });
  expect(
    root.root
      .findAllByType(Text)
      .map(node => node.props.children)
      .join(' '),
  ).toContain('Ramon has been emailed');
  await act(async () => {
    root.unmount();
  });
});
