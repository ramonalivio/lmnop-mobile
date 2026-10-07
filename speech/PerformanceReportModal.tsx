import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { submitPerformanceReport } from './performanceReports';

export function PerformanceReportModal({
  visible,
  token,
  onClose,
}: {
  visible: boolean;
  token: string | null;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [fraction, setFraction] = useState(0);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const close = () => {
    if (!busy) {
      setDone(false);
      setError('');
      setMessage('');
      setFraction(0);
      onClose();
    }
  };
  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await submitPerformanceReport(token, (text, value) => {
        setMessage(text);
        setFraction(value);
      });
      setDone(true);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : 'Upload failed. Your recordings are kept so you can retry.',
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={close}
    >
      <View style={styles.backdrop}>
        <View style={styles.card} accessibilityViewIsModal>
          <Text style={styles.title}>
            {done ? 'Report shared' : 'Share performance report with Ramon?'}
          </Text>
          {!done && (
            <Text style={styles.body}>
              This will upload your recorded audio, transcription results,
              device details, model and online/offline mode, timing, CPU, and
              memory data to Cloudflare. Ramon can play and listen to your audio
              in the report. Audio is deleted from this device after successful
              sharing, when you press Clear, or when the app wakes and the
              recording is at least one hour old.
            </Text>
          )}
          {busy && (
            <>
              <Text style={styles.body}>
                Keep the app open while uploading.
              </Text>
              <View
                accessibilityRole="progressbar"
                accessibilityValue={{
                  min: 0,
                  max: 100,
                  now: Math.round(fraction * 100),
                }}
                style={styles.track}
              >
                <View
                  style={[
                    styles.fill,
                    { width: `${Math.round(fraction * 100)}%` },
                  ]}
                />
              </View>
              <Text accessibilityLiveRegion="polite" style={styles.body}>
                {message} {Math.round(fraction * 100)}%
              </Text>
            </>
          )}
          {done && (
            <Text style={styles.body}>
              Ramon has been emailed the report link. The submitted recordings
              have been deleted from this device.
            </Text>
          )}
          {!!error && (
            <Text accessibilityRole="alert" style={styles.error}>
              {error}
            </Text>
          )}
          {!busy && (
            <View style={styles.actions}>
              <Pressable
                accessibilityRole="button"
                onPress={close}
                style={styles.button}
              >
                <Text>{done ? 'Done' : 'Cancel'}</Text>
              </Pressable>
              {!done && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Confirm sharing performance report"
                  onPress={submit}
                  style={[styles.button, styles.primary]}
                >
                  <Text style={styles.white}>
                    {error ? 'Retry upload' : 'Yes, share with Ramon'}
                  </Text>
                </Pressable>
              )}
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}
const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: '#0008',
    justifyContent: 'center',
    padding: 24,
  },
  card: { backgroundColor: '#fff', borderRadius: 18, padding: 24 },
  title: { fontSize: 22, fontWeight: '600', color: '#17352f' },
  body: { fontSize: 15, lineHeight: 23, color: '#40534b', marginTop: 16 },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    flexWrap: 'wrap',
    gap: 12,
    marginTop: 24,
  },
  button: { padding: 12, borderRadius: 8, backgroundColor: '#eef2ee' },
  primary: { backgroundColor: '#27745b' },
  white: { color: '#fff' },
  track: {
    height: 10,
    backgroundColor: '#e3ebe5',
    borderRadius: 5,
    overflow: 'hidden',
    marginTop: 20,
  },
  fill: { height: 10, backgroundColor: '#27745b' },
  error: { color: '#a13636', marginTop: 16 },
});
