import { HotUpdater, useHotUpdaterStore } from '@hot-updater/react-native';
import { useEffect, useState, type ComponentType } from 'react';
import {
  ActivityIndicator,
  AppState,
  BackHandler,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import config from '../ota.config.json';
import { OtaController, type OtaState } from './otaController';

export function withOtaUpdates<T extends object>(App: ComponentType<T>) {
  if (__DEV__ || !config.baseURL) return App;
  HotUpdater.init({ baseURL: config.baseURL, requestTimeout: 5000 });
  return function UpdatedApp(props: T) {
    const [state, setState] = useState<OtaState>({
      phase: 'checking',
      forced: false,
    });
    const [started, setStarted] = useState(false);
    const [controller] = useState(
      () =>
        new OtaController(
          () => HotUpdater.checkForUpdate({ updateStrategy: 'fingerprint' }),
          () => HotUpdater.reload(),
          setState,
        ),
    );
    const progress = useHotUpdaterStore(value => value.progress);
    useEffect(() => {
      controller.check(true).catch(() => undefined);
      let backgrounded = AppState.currentState === 'background';
      const subscription = AppState.addEventListener('change', next => {
        if (next === 'background') backgrounded = true;
        if (next === 'active' && backgrounded) {
          backgrounded = false;
          controller.check().catch(() => undefined);
        }
      });
      return () => subscription.remove();
    }, [controller]);
    useEffect(() => {
      if (state.phase === 'idle') setStarted(true);
    }, [state.phase]);
    const visible = state.phase !== 'idle';
    useEffect(() => {
      if (!visible) return;
      const subscription = BackHandler.addEventListener(
        'hardwareBackPress',
        () => true,
      );
      return () => subscription.remove();
    }, [visible]);
    const prompt = state.phase === 'prompt';
    const error = state.phase === 'error';
    const working = !prompt && !error;
    return (
      <View style={styles.root}>
        {started && (
          <View
            style={styles.root}
            pointerEvents={visible ? 'none' : 'auto'}
            accessibilityElementsHidden={visible}
            importantForAccessibility={visible ? 'no-hide-descendants' : 'auto'}
          >
            <App {...props} />
          </View>
        )}
        {visible && (
          <View
            testID="ota-update-screen"
            style={styles.screen}
            accessibilityViewIsModal
          >
            <Text accessibilityRole="header" style={styles.title}>
              {state.phase === 'checking'
                ? 'Checking for updates'
                : state.phase === 'downloading'
                ? 'Downloading update'
                : state.phase === 'restarting'
                ? 'Restarting app'
                : error
                ? 'Update could not finish'
                : state.forced
                ? 'App update required'
                : 'App update available'}
            </Text>
            <Text style={styles.message}>
              {state.phase === 'checking'
                ? 'Please wait a moment.'
                : state.phase === 'downloading'
                ? `${Math.round(
                    Math.max(0, Math.min(1, progress || 0)) * 100,
                  )}% downloaded`
                : state.phase === 'restarting'
                ? 'Opening the updated app…'
                : error
                ? 'Please check your connection and retry.'
                : 'Download the update and restart to continue. Restarting will discard unsaved recordings and edits.'}
            </Text>
            {working ? (
              <ActivityIndicator size="large" color="#176b5b" />
            ) : (
              <>
                <Pressable
                  accessibilityRole="button"
                  style={styles.button}
                  onPress={() => {
                    controller.download().catch(() => undefined);
                  }}
                >
                  <Text style={styles.buttonText}>
                    {error ? 'Retry' : 'Download and restart'}
                  </Text>
                </Pressable>
                {!state.forced && (
                  <Pressable
                    accessibilityRole="button"
                    style={styles.dismiss}
                    onPress={() => controller.dismiss()}
                  >
                    <Text>Not now</Text>
                  </Pressable>
                )}
              </>
            )}
          </View>
        )}
      </View>
    );
  };
}
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#f7faf9' },
  screen: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    justifyContent: 'center',
    padding: 28,
    backgroundColor: '#f7faf9',
  },
  title: {
    fontSize: 26,
    fontWeight: '700',
    color: '#173b32',
    textAlign: 'center',
  },
  message: {
    fontSize: 17,
    color: '#334b44',
    textAlign: 'center',
    marginVertical: 24,
  },
  button: {
    backgroundColor: '#176b5b',
    padding: 18,
    borderRadius: 8,
    alignItems: 'center',
  },
  buttonText: { color: '#fff', fontSize: 17, fontWeight: '600' },
  dismiss: { padding: 20, alignItems: 'center' },
});
