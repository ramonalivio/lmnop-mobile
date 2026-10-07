import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { AppState, Modal, TextInput, type AppStateStatus } from 'react-native';
import {
  VoiceReplacement,
  SelectableTranscript,
  replaceSelection,
  selectionAction,
  expandWordSelection,
} from '../speech/VoiceReplacement';
import { createSpeechToTextSession } from '../speech/speechToText';

jest.mock('../speech/speechToText', () => ({
  createSpeechToTextSession: jest.fn(),
}));
jest.mock('../speech/RecordingIndicator', () => ({
  RecordingIndicator: () => null,
}));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: require('react-native').View,
  SafeAreaProvider: require('react-native').View,
}));

const selection = { source: 'Patient denies chest pain.', start: 15, end: 25 };
let callbacks: any;
let tree: Renderer.ReactTestRenderer;
const session = {
  prepare: jest.fn(),
  start: jest.fn(),
  stop: jest.fn(),
  dispose: jest.fn(),
  setText: jest.fn(),
};
const onClose = jest.fn();
const waitForRelease = jest.fn();
const value = { confirmed: 'shortness of breath', provisional: '' };
const button = (name: string) =>
  tree.root.findAllByProps({
    accessibilityLabel: name === 'Cancel' ? 'Cancel replacement' : name,
  })[0];
async function mount() {
  await act(async () => {
    tree = Renderer.create(
      <VoiceReplacement
        selection={selection}
        waitForRelease={waitForRelease}
        onClose={onClose}
      />,
    );
  });
}
beforeEach(() => {
  jest.clearAllMocks();
  waitForRelease.mockResolvedValue(undefined);
  session.prepare.mockResolvedValue(undefined);
  session.start.mockImplementation(async next => {
    callbacks = next;
    next.onStatus('listening');
  });
  session.stop.mockResolvedValue(value);
  session.dispose.mockResolvedValue(value);
  jest.mocked(createSpeechToTextSession).mockReturnValue(session as any);
});
afterEach(async () => {
  if (tree) await act(async () => tree.unmount());
});

test('replaces exactly the selected occurrence and preserves surrounding punctuation', () => {
  expect(replaceSelection(selection, ' shortness of breath ')).toBe(
    'Patient denies shortness of breath.',
  );
  expect(
    replaceSelection({ source: 'pain then pain', start: 10, end: 14 }, 'cough'),
  ).toBe('pain then cough');
});

test('waits for the original recognizer to release and ignores modal dismiss requests', async () => {
  let release!: () => void;
  waitForRelease.mockReturnValueOnce(
    new Promise<void>(resolve => {
      release = resolve;
    }),
  );
  await mount();
  expect(session.prepare).not.toHaveBeenCalled();
  await act(async () => {
    release();
  });
  expect(session.prepare).toHaveBeenCalledTimes(1);
  expect(button('Apply replacement').props.disabled).toBe(true);
  await act(async () => tree.root.findByType(Modal).props.onRequestClose());
  expect(onClose).not.toHaveBeenCalled();
});

test('live preview does not commit; Apply commits only after stop and disposal', async () => {
  await mount();
  await act(async () => button('Start replacement recording').props.onPress());
  await act(async () =>
    callbacks.onTranscript({ confirmed: '', provisional: 'shortness' }),
  );
  expect(onClose).not.toHaveBeenCalled();
  expect(button('Apply replacement').props.disabled).toBe(true);
  await act(async () => button('Stop replacement recording').props.onPress());
  let disposed!: () => void;
  session.dispose.mockReturnValueOnce(
    new Promise<void>(resolve => {
      disposed = resolve;
    }),
  );
  let closing!: Promise<void>;
  await act(async () => {
    closing = button('Apply replacement').props.onPress();
  });
  expect(onClose).not.toHaveBeenCalled();
  await act(async () => {
    disposed();
    await closing;
  });
  expect(onClose).toHaveBeenCalledWith('Patient denies shortness of breath.');
});

test('Cancel discards even a live replacement and releases recording', async () => {
  await mount();
  await act(async () => button('Start replacement recording').props.onPress());
  await act(async () => callbacks.onTranscript(value));
  await act(async () => button('Cancel').props.onPress());
  expect(session.dispose).toHaveBeenCalledTimes(1);
  expect(onClose).toHaveBeenCalledWith(null);
});

test('a failed final decode cannot apply an unfinished replacement', async () => {
  await mount();
  await act(async () => button('Start replacement recording').props.onPress());
  await act(async () => callbacks.onTranscript(value));
  session.stop.mockRejectedValueOnce(new Error('Decode failed'));
  await act(async () => button('Stop replacement recording').props.onPress());
  expect(button('Apply replacement').props.disabled).toBe(true);
  await act(async () => button('Apply replacement').props.onPress());
  expect(onClose).not.toHaveBeenCalled();
  await act(async () => button('Cancel').props.onPress());
  expect(onClose).toHaveBeenCalledWith(null);
});

test('typed replacement is synchronized and can be applied without recording', async () => {
  await mount();
  await act(async () =>
    tree.root
      .findByProps({ accessibilityLabel: 'Replacement draft' })
      .props.onChangeText('shortness of breath'),
  );
  expect(session.setText).toHaveBeenCalledWith('shortness of breath');
  expect(button('Apply replacement').props.disabled).toBe(false);
  await act(async () => button('Apply replacement').props.onPress());
  expect(onClose).toHaveBeenCalledWith('Patient denies shortness of breath.');
  expect(session.start).not.toHaveBeenCalled();
});

test('Clear empties only the replacement draft and disables Apply', async () => {
  await mount();
  expect(button('Clear replacement').props.disabled).toBe(true);
  await act(async () =>
    tree.root
      .findByProps({ accessibilityLabel: 'Replacement draft' })
      .props.onChangeText('New draft'),
  );
  expect(button('Clear replacement').props.disabled).toBe(false);
  await act(async () => button('Clear replacement').props.onPress());
  expect(session.setText).toHaveBeenLastCalledWith('');
  expect(
    tree.root.findByProps({ accessibilityLabel: 'Replacement draft' }).props
      .value,
  ).toBe('');
  expect(button('Apply replacement').props.disabled).toBe(true);
  expect(onClose).not.toHaveBeenCalled();
});

test('Clear cannot discard a recording while it is active', async () => {
  await mount();
  await act(async () => button('Start replacement recording').props.onPress());
  await act(async () =>
    callbacks.onTranscript({ confirmed: '', provisional: 'Pending phrase' }),
  );
  expect(button('Clear replacement').props.disabled).toBe(true);
  await act(async () => button('Clear replacement').props.onPress());
  expect(session.setText).not.toHaveBeenCalled();
});

test('overlay does not announce Recording until capture reports listening', async () => {
  session.start.mockImplementationOnce(async next => {
    callbacks = next;
    next.onStatus('initializing');
  });
  await mount();
  await act(async () => button('Start replacement recording').props.onPress());
  expect(JSON.stringify(tree.toJSON())).toContain('Preparing microphone');
  await act(async () => callbacks.onStatus('listening'));
  expect(JSON.stringify(tree.toJSON())).not.toContain('Preparing microphone');
  expect(JSON.stringify(tree.toJSON())).toContain('Recording');
});

test('backgrounding releases capture without dismissing or applying', async () => {
  let change!: (state: AppStateStatus) => void;
  const listener = jest
    .spyOn(AppState, 'addEventListener')
    .mockImplementation((_type, handler) => {
      change = handler;
      return { remove: jest.fn() };
    });
  try {
    await mount();
    await act(async () =>
      button('Start replacement recording').props.onPress(),
    );
    await act(async () => change('background'));
    expect(session.dispose).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => change('active'));
    expect(createSpeechToTextSession).toHaveBeenLastCalledWith(
      value.confirmed,
      undefined,
    );
  } finally {
    listener.mockRestore();
  }
});

test('selection stays editable without delayed actions and reports collapsed ranges', async () => {
  jest.useFakeTimers();
  const selected = jest.fn();
  try {
    await act(async () => {
      tree = Renderer.create(
        <SelectableTranscript text="one two three" onSelect={selected} />,
      );
    });
    const select = (start: number, end: number) =>
      tree.root.findByType(TextInput).props.onSelectionChange({
        nativeEvent: { selection: { start, end } },
      });
    await act(async () => {
      select(0, 3);
      select(0, 7);
      jest.advanceTimersByTime(700);
    });
    expect(selected).toHaveBeenCalledWith({
      source: 'one two three',
      start: 0,
      end: 7,
    });
    selected.mockClear();
    await act(async () => {
      select(0, 3);
      select(3, 3);
      jest.advanceTimersByTime(700);
    });
    expect(selected).toHaveBeenLastCalledWith({
      source: 'one two three',
      start: 3,
      end: 3,
    });
    selected.mockClear();
    await act(async () => {
      jest.advanceTimersByTime(5000);
    });
    expect(selected).not.toHaveBeenCalled();
  } finally {
    jest.useRealTimers();
  }
});

test('selection chooses replacement, insertion, or append', () => {
  expect(selectionAction({ source: 'one two', start: 0, end: 3 })).toBe(
    'replace',
  );
  expect(selectionAction({ source: 'one two', start: 4, end: 4 })).toBe(
    'insert',
  );
  expect(selectionAction({ source: 'one two', start: 7, end: 7 })).toBe(
    'append',
  );
  expect(selectionAction(null)).toBe('append');
  expect(replaceSelection({ source: 'ab', start: 1, end: 1 }, 'c')).toBe('acb');
});

test('word taps place the native caret without selecting a word or opening a keyboard', async () => {
  const selected = jest.fn();
  await act(async () => {
    tree = Renderer.create(
      <SelectableTranscript text="one two three" onSelect={selected} />,
    );
  });
  const input = tree.root.findByType(TextInput);
  expect(input.props.showSoftInputOnFocus).toBe(false);
  expect(input.props.contextMenuHidden).toBeUndefined();
  await act(async () => {
    input.props.onTouchStart();
    input.props.onSelectionChange({
      nativeEvent: { selection: { start: 5, end: 5 } },
    });
  });
  expect(selected).toHaveBeenLastCalledWith({
    source: 'one two three',
    start: 5,
    end: 5,
  });
  await act(async () =>
    input.props.onSelectionChange({
      nativeEvent: { selection: { start: 4, end: 13 } },
    }),
  );
  expect(selected).toHaveBeenLastCalledWith({
    source: 'one two three',
    start: 4,
    end: 13,
  });
  expect(
    expandWordSelection('54-year-old male.', { start: 5, end: 13 }),
  ).toEqual({ start: 0, end: 16 });
});

test('applied text can mount focused with the exact replacement pre-selected', async () => {
  const range = {
    source: 'Patient denies shortness of breath.',
    start: 15,
    end: 34,
  };
  await act(async () => {
    tree = Renderer.create(
      <SelectableTranscript
        text={range.source}
        selection={range}
        onSelect={jest.fn()}
      />,
    );
  });
  expect(tree.root.findByType(TextInput).props.selection).toEqual({
    start: 15,
    end: 34,
  });
  expect(tree.root.findByType(TextInput).props.autoFocus).toBe(true);
});

test('drag selection remains native until release, then expands partial boundary words', async () => {
  jest.useFakeTimers();
  const selected = jest.fn();
  try {
    await act(async () => {
      tree = Renderer.create(
        <SelectableTranscript text="one two three" onSelect={selected} />,
      );
    });
    const input = tree.root.findByType(TextInput);
    await act(async () => {
      input.props.onTouchStart();
      input.props.onSelectionChange({
        nativeEvent: { selection: { start: 1, end: 6 } },
      });
      jest.advanceTimersByTime(500);
    });
    expect(selected).toHaveBeenLastCalledWith({
      source: 'one two three',
      start: 1,
      end: 6,
    });
    await act(async () => {
      input.props.onTouchEnd();
      jest.advanceTimersByTime(200);
    });
    expect(selected).toHaveBeenLastCalledWith({
      source: 'one two three',
      start: 0,
      end: 7,
    });
  } finally {
    jest.useRealTimers();
  }
});

test('word snapping preserves whitespace boundaries and collapsed carets', () => {
  expect(expandWordSelection('one two three', { start: 5, end: 5 })).toEqual({
    start: 5,
    end: 5,
  });
  expect(expandWordSelection('one two three', { start: 3, end: 8 })).toEqual({
    start: 3,
    end: 8,
  });
  expect(
    expandWordSelection('Take amlodipine.', { start: 5, end: 10 }),
  ).toEqual({ start: 5, end: 15 });
});

test('microphone denial leaves replacement Record active for another attempt', async () => {
  jest.spyOn(AppState, 'addEventListener').mockReturnValue({ remove: jest.fn() });
  session.start.mockImplementation(async next => next.onStatus('permission-denied'));
  await mount();
  await act(async () => button('Start replacement recording').props.onPress());
  expect(button('Start replacement recording').props.disabled).toBe(false);
  await act(async () => button('Start replacement recording').props.onPress());
  expect(session.start).toHaveBeenCalledTimes(2);
  expect(session.stop).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();
});
