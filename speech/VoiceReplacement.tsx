import { RefinementTimer } from './RefinementTimer';
import type { RefinementOptions } from './speechToText';
import { useEffect, useRef, useState, type ComponentRef } from 'react';
import {
  ActivityIndicator,
  AppState,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import {
  SafeAreaProvider,
  SafeAreaView,
  initialWindowMetrics,
} from 'react-native-safe-area-context';
import {
  createSpeechToTextSession,
  type SpeechToTextSession,
  type SpeechTranscript,
} from './speechToText';
import { RecordingIndicator } from './RecordingIndicator';
import { DictationIcon } from './DictationControls';
import { DictationTextInput } from './DictationTextInput';

export type ReplacementSelection = {
  source: string;
  start: number;
  end: number;
};

export function selectionAction(selection: ReplacementSelection | null) {
  if (!selection) return 'append';
  if (selection.end > selection.start) return 'replace';
  return selection.start < selection.source.length ? 'insert' : 'append';
}

export function expandWordSelection(
  text: string,
  range: { start: number; end: number },
) {
  if (range.start === range.end) return range;
  let { start, end } = range;
  for (const match of text.matchAll(/[\p{L}\p{N}]+(?:[-'’][\p{L}\p{N}]+)*/gu)) {
    const left = match.index!;
    const right = left + match[0].length;
    if (start > left && start < right) start = left;
    if (end > left && end < right) end = right;
  }
  return { start, end };
}

export function replaceSelection(
  selection: ReplacementSelection,
  replacement: string,
) {
  return (
    selection.source.slice(0, selection.start) +
    (selection.start === selection.end ? replacement : replacement.trim()) +
    selection.source.slice(selection.end)
  );
}

export function SelectableTranscript({
  text,
  onSelect,
  selection,
  pendingFrom,
  typing = false,
  dark = false,
  onChangeText,
}: {
  pendingFrom?: number;
  typing?: boolean;
  dark?: boolean;
  onChangeText?: (text: string) => void;
  text: string;
  onSelect: (selection: ReplacementSelection | null) => void;
  selection?: ReplacementSelection | null;
}) {
  const input = useRef<ComponentRef<typeof TextInput>>(null);
  useEffect(() => {
    if (!typing) return;
    input.current?.blur();
    const frame = requestAnimationFrame(() => input.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [typing]);
  const touching = useRef(false);
  const latestRange = useRef({ start: text.length, end: text.length });
  const snapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearSnap = () => {
    if (snapTimer.current) clearTimeout(snapTimer.current);
    snapTimer.current = null;
  };
  useEffect(() => {
    touching.current = false;
    return clearSnap;
  }, [text]);
  const scheduleSnap = () => {
    clearSnap();
    if (touching.current) return;
    const next = latestRange.current;
    const expanded = expandWordSelection(text, next);
    if (expanded.start === next.start && expanded.end === next.end) return;
    // Native handle gestures may deliver selection events without view touches.
    // Wait for those events to settle before adjusting either endpoint.
    snapTimer.current = setTimeout(() => {
      snapTimer.current = null;
      latestRange.current = expanded;
      input.current?.setNativeProps({ selection: expanded });
      onSelect({ source: text, ...expanded });
    }, 180);
  };
  const range = selection
    ? { start: selection.start, end: selection.end }
    : { start: text.length, end: text.length };
  return (
    <TextInput
      ref={input}
      accessibilityLabel="Dictation transcript"
      multiline
      scrollEnabled={false}
      value={pendingFrom === undefined ? text : undefined}
      showSoftInputOnFocus={typing}
      autoCorrect={false}
      spellCheck={false}
      autoComplete="off"
      textContentType="none"
      onChangeText={next => {
        if (typing) {
          onChangeText?.(next);
          return;
        }
        // Keep native caret/selection gestures, but reject hardware keyboard edits.
        input.current?.setNativeProps({ text, selection: range });
      }}
      placeholder="No dictation yet."
      autoFocus={!!selection}
      selection={range}
      style={[styles.transcript, dark && styles.darkTranscript, styles.fullHeightTranscript]}
      onTouchStart={() => {
        touching.current = true;
        clearSnap();
      }}
      onTouchEnd={() => {
        touching.current = false;
        scheduleSnap();
      }}
      onTouchCancel={() => {
        touching.current = false;
        clearSnap();
      }}
      onSelectionChange={({ nativeEvent: { selection: nextRange } }) => {
        latestRange.current = nextRange;
        onSelect({ source: text, ...nextRange });
        scheduleSnap();
      }}
    >
      {pendingFrom !== undefined ? (
        <Text>
          {text.slice(0, pendingFrom)}
          <Text style={styles.provisional}>{text.slice(pendingFrom)}</Text>
        </Text>
      ) : null}
    </TextInput>
  );
}

export function VoiceReplacement({
  selection,
  waitForRelease,
  refinement,
  onClose,
}: {
  selection: ReplacementSelection;
  waitForRelease: () => Promise<void>;
  refinement?: RefinementOptions;
  onClose: (text: string | null) => void;
}) {
  const provider = refinement?.provider;
  const pauseMs = refinement?.pauseMs;
  const inserting = selection.start === selection.end;
  const session = useRef<SpeechToTextSession | null>(null);
  const cleanup = useRef(Promise.resolve());
  const draft = useRef<SpeechTranscript>({ confirmed: '', provisional: '' });
  const [transcript, setTranscript] = useState(draft.current);
  const [ready, setReady] = useState(false);
  const [recording, setRecording] = useState(false);
  const [listening, setListening] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refining, setRefining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const preparing = recording && !listening && !busy && !error;
  const closing = useRef(false);
  const active = useRef(false);
  const display = (value: SpeechTranscript) =>
    [value.confirmed, value.provisional].filter(Boolean).join(' ');

  useEffect(() => {
    let mounted = true;
    let foreground = true;
    const prepare = async () => {
      await waitForRelease();
      await cleanup.current;
      if (!mounted || !foreground || session.current || closing.current) return;
      const next = createSpeechToTextSession(
        draft.current.confirmed,
        provider ? { provider, pauseMs } : undefined,
      );
      session.current = next;
      try {
        await next.prepare();
        if (mounted && session.current === next) setReady(true);
      } catch (reason) {
        if (mounted) setError(String(reason));
      }
    };
    const release = () => {
      const current = session.current;
      const beforeRelease = draft.current;
      session.current = null;
      active.current = false;
      if (mounted) {
        setReady(false);
        setRecording(false);
      }
      if (current)
        cleanup.current = current
          .dispose()
          .then(value => {
            if (
              provider !== 'parakeet' &&
              !session.current &&
              draft.current === beforeRelease
            ) {
              draft.current = value;
              if (mounted) setTranscript(value);
            }
          })
          .catch(reason => {
            if (mounted) setError(String(reason));
          });
    };
    prepare().catch(reason => {
      if (mounted) setError(String(reason));
    });
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'background') {
        foreground = false;
        release();
      }
      if (state === 'active') {
        foreground = true;
        prepare().catch(() => undefined);
      }
    });
    return () => {
      mounted = false;
      subscription.remove();
      release();
    };
  }, [waitForRelease, provider, pauseMs]);

  async function start() {
    const current = session.current;
    if (!current || !ready || active.current || closing.current) return;
    active.current = true;
    Keyboard.dismiss();
    setRecording(true);
    setListening(false);
    setError(null);
    try {
      await current.start({
        onRecordingLimit: () => {
          stop().catch(() => undefined);
        },
        onTranscript: value => {
          if (session.current === current) {
            draft.current = value;
            setTranscript(value);
          }
        },
        onStatus: status => {
          if (session.current === current) setListening(status === 'listening');
          if (
            session.current === current &&
            ['idle', 'error', 'permission-denied', 'model-missing'].includes(
              status,
            )
          ) {
            if (
              ['idle', 'error', 'permission-denied', 'model-missing'].includes(
                status,
              )
            ) {
              active.current = false;
              setRecording(false);
            }
            if (status !== 'idle')
              setError(
                status === 'permission-denied'
                  ? 'Microphone access required.'
                  : 'Recording interrupted.',
              );
          }
        },
        onError: message => {
          if (session.current === current) setError(message);
        },
      });
    } catch (reason) {
      setError(String(reason));
    }
  }

  async function stop() {
    const current = session.current;
    if (!current || !active.current) return;
    setBusy(true);
    setRefining(true);
    try {
      const value = await current.stop();
      if (session.current === current) {
        draft.current = value;
        setTranscript(value);
      }
    } catch (reason) {
      setError(String(reason));
    } finally {
      active.current = false;
      setRecording(false);
      setBusy(false);
      setRefining(false);
    }
  }

  const autoStop = useRef(stop);
  autoStop.current = stop;
  useEffect(() => {
    if (!listening || !recording || busy || provider === 'parakeet') return;
    const timeout = setTimeout(() => {
      autoStop.current().catch(() => undefined);
    }, 60000);
    return () => clearTimeout(timeout);
  }, [listening, recording, busy, provider]);

  async function close(apply: boolean) {
    if (
      closing.current ||
      busy ||
      (apply &&
        (active.current || busy || error || !display(draft.current).trim()))
    )
      return;
    closing.current = true;
    setBusy(true);
    const current = session.current;
    session.current = null;
    try {
      await cleanup.current;
      if (current) await current.dispose();
    } catch (reason) {
      setError(String(reason));
      if (apply) {
        closing.current = false;
        setBusy(false);
        setReady(false);
        return;
      }
    }
    onClose(apply ? replaceSelection(selection, display(draft.current)) : null);
  }

  async function clearDraft() {
    if (active.current || busy || closing.current) return;
    setBusy(true);
    await cleanup.current;
    const empty = { confirmed: '', provisional: '' };
    draft.current = empty;
    setTranscript(empty);
    session.current?.setText('');
    setError(null);
    setBusy(false);
  }

  return (
    <Modal
      visible
      transparent={false}
      presentationStyle="fullScreen"
      allowSwipeDismissal={false}
      onRequestClose={() => {}}
    >
      <SafeAreaProvider initialMetrics={initialWindowMetrics}>
        <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
          <SafeAreaView style={styles.page}>
            <KeyboardAvoidingView
              style={styles.keyboard}
              behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            >
              <Text style={styles.title}>
                {inserting ? 'Insert dictation' : 'Replace dictation'}
              </Text>
              <ScrollView
                style={styles.body}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode="on-drag"
              >
                <Text style={styles.label}>
                  {inserting ? 'Insertion point' : 'Selected text'}
                </Text>
                <Text selectable style={styles.original}>
                  {inserting
                    ? `${selection.source.slice(
                        Math.max(0, selection.start - 45),
                        selection.start,
                      )} | ${selection.source.slice(
                        selection.end,
                        selection.end + 45,
                      )}`
                    : selection.source.slice(selection.start, selection.end)}
                </Text>
                <View style={styles.draftToolbar}>
                  <Text style={styles.draftLabel}>
                    {inserting ? 'New text' : 'Replacement'}
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Clear replacement"
                    disabled={recording || busy || !display(transcript).length}
                    onPress={clearDraft}
                    style={[
                      styles.clear,
                      (recording || busy || !display(transcript).length) &&
                        styles.disabled,
                    ]}
                  >
                    <Text style={styles.actionText}>Clear</Text>
                  </Pressable>
                </View>
                {!recording && !busy ? (
                  <DictationTextInput
                    editorId="replacement"
                    multiline
                    accessibilityLabel="Replacement draft"
                    style={styles.transcript}
                    value={display(transcript)}
                    placeholder="No replacement recorded."
                    onChangeText={text => {
                      const next = { confirmed: text, provisional: '' };
                      draft.current = next;
                      setTranscript(next);
                      session.current?.setText(text);
                      setError(null);
                    }}
                  />
                ) : (
                  <Text style={styles.transcript}>
                    {transcript.confirmed || transcript.provisional ? (
                      <>
                        {display({
                          confirmed: transcript.confirmed,
                          provisional: '',
                        })}
                        {transcript.confirmed && transcript.provisional
                          ? ' '
                          : ''}
                        <Text style={styles.provisional}>
                          {transcript.provisional}
                        </Text>
                      </>
                    ) : (
                      'No replacement recorded.'
                    )}
                  </Text>
                )}
              </ScrollView>
              <View style={styles.status}>
                <>
                  {busy ? (
                    <ActivityIndicator size="small" color="#176b5b" />
                  ) : (
                    <RecordingIndicator active={recording && listening} />
                  )}
                </>
                <Text>
                  {busy
                    ? 'Finalizing transcript…'
                    : recording
                    ? listening
                      ? 'Recording'
                      : 'Preparing microphone'
                    : ready
                    ? 'Ready to dictate'
                    : 'Preparing dictation'}
                </Text>
              </View>
              <RefinementTimer active={refining} reset={recording && !busy} />
              {error && (
                <Text accessibilityRole="alert" style={styles.error}>
                  {error}
                </Text>
              )}
              <Pressable
                accessibilityRole="switch"
                accessibilityState={{ checked: recording }}
                accessibilityLabel={
                  preparing
                    ? 'Preparing microphone'
                    : recording
                    ? 'Stop replacement recording'
                    : 'Start replacement recording'
                }
                disabled={!ready || busy || preparing}
                style={[
                  styles.record,
                  recording && styles.stop,
                  (!ready || busy) && styles.disabled,
                  preparing && styles.preparing,
                ]}
                onPress={() => (active.current ? stop() : start())}
              >
                {preparing ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <DictationIcon kind={recording ? 'stop' : 'microphone'} />
                )}
              </Pressable>
              <View style={styles.actions}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Cancel replacement"
                  disabled={closing.current || busy}
                  onPress={() => close(false)}
                  style={[styles.action, busy && styles.disabled]}
                >
                  <Text style={styles.actionText}>Cancel</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={
                    inserting ? 'Apply insertion' : 'Apply replacement'
                  }
                  disabled={
                    recording || busy || !!error || !display(transcript).trim()
                  }
                  onPress={() => close(true)}
                  style={[
                    styles.action,
                    (recording ||
                      busy ||
                      !!error ||
                      !display(transcript).trim()) &&
                      styles.disabled,
                  ]}
                >
                  <Text style={styles.actionText}>
                    {inserting ? 'Apply insertion' : 'Apply replacement'}
                  </Text>
                </Pressable>
              </View>
            </KeyboardAvoidingView>
          </SafeAreaView>
        </TouchableWithoutFeedback>
      </SafeAreaProvider>
    </Modal>
  );
}

const styles = StyleSheet.create({
  keyboard: { flex: 1 },
  page: { flex: 1, backgroundColor: '#fff', padding: 24 },
  title: {
    fontSize: 24,
    fontWeight: '600',
    color: '#233b38',
    marginBottom: 24,
  },
  body: { flex: 1 },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#53615f',
    marginBottom: 12,
  },
  original: {
    fontSize: 20,
    lineHeight: 29,
    color: '#53615f',
    backgroundColor: '#eef4f2',
    padding: 12,
    marginBottom: 28,
  },
  fullHeightTranscript: {
    flexGrow: 1,
  },
  transcript: {
    fontSize: 17,
    lineHeight: 25,
    color: '#293e3c',
    padding: 0,
    textAlignVertical: 'top',
  },
  darkTranscript: { color: '#eef8f3' },
  status: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginVertical: 16,
  },
  error: { color: '#a32626', marginBottom: 12 },
  provisional: { color: '#175b35', backgroundColor: '#d9f2df' },
  draftToolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  draftLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#53615f',
    flexShrink: 1,
  },
  clear: { minHeight: 44, paddingHorizontal: 12, justifyContent: 'center' },
  record: {
    backgroundColor: '#32685e',
    borderRadius: 6,
    minHeight: 58,
    padding: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recordText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  stop: { backgroundColor: '#a3313c' },
  preparing: { backgroundColor: '#a66b12', opacity: 1 },
  actions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    marginTop: 16,
  },
  action: { paddingVertical: 16, flexShrink: 1 },
  actionText: { fontSize: 16, color: '#32685e', fontWeight: '600' },
  disabled: { opacity: 0.4 },
});
