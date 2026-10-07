/**
 * @format
 */

import { AppRegistry, NativeModules, Platform } from 'react-native';
import App from './App';
import WhisperAndroidBench from './experiments/WhisperAndroidBench';
import { name as appName } from './app.json';
import { withOtaUpdates } from './src/withOtaUpdates';

const directDeviceBuild = Platform.OS === 'ios' && NativeModules.AppInfo?.directDeviceBuild === true;
AppRegistry.registerComponent(appName, () => directDeviceBuild ? App : withOtaUpdates(App));
AppRegistry.registerComponent('WhisperAndroidBench', () => WhisperAndroidBench);
