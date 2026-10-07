import { clearPauseRecoveryRecordings } from './speech/pauseRecovery';
import * as OmiMedModel from './speech/omiMedModel';
import { formatModelBytes } from './speech/offlineModel';
import type { OmiMedModelState } from './speech/omiMedModel';
import { RefinementTimer } from './speech/RefinementTimer';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentRef,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { reportUpdateVersion, updateLabel } from './src/updateVersion';
import {
  ActivityIndicator,
  Animated,
  AppState,
  Keyboard,
  KeyboardAvoidingView,
  Linking,
  Modal,
  NativeModules,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
const {
  downloadOmiMedModel: downloadOfflineModel,
  isOmiMedModelReady: isOfflineModelReady,
  observeOmiMedModel: observeOfflineModel,
  omiMedModelBytes: whisperModelBytes,
} = OmiMedModel;
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { PerformanceReportModal } from './speech/PerformanceReportModal';
import {
  clearPerformanceRecordings,
  pendingPerformanceReports,
  subscribePerformanceReports,
} from './speech/performanceReports';
import { TranscriptEditor } from './speech/TranscriptEditor';
import { DictationControls } from './speech/DictationControls';
import { RecordingIndicator } from './speech/RecordingIndicator';
import { PrescriptionScreen } from './prescription/PrescriptionScreen';
import { HomeScreen } from './home/HomeScreen';
import { SettingsScreen } from './home/SettingsScreen';
import {
  SelectableTranscript,
  selectionAction,
  VoiceReplacement,
  type ReplacementSelection,
} from './speech/VoiceReplacement';
import {
  createSpeechToTextSession,
  type SpeechStatus,
  type SpeechTranscript,
  type SpeechToTextSession,
} from './speech/speechToText';

type Step =
  | 'sign-in'
  | 'home'
  | 'settings'
  | 'prescription-profile'
  | 'dashboard'
  | 'intake-section'
  | 'review'
  | 'questionnaire'
  | 'speech-to-text'
  | 'transcriptions'
  | 'diagnostics'
  | 'prescription'
  | 'ready';

type Question = {
  key: string;
  prompt: string;
  options: string[];
};

type IntakeSection = {
  icon: string;
  key: string;
  number: number;
  title: string;
  fields: string[];
};

type AuthCallback = {
  email: string | null;
  sessionToken: string | null;
  status: string | null;
};

type DriveFolderResponse = {
  driveFolderId: string;
  driveFolderName: string;
  intakeSubmissionJsonId?: string;
  intakeSubmissionJsonName?: string;
  questionnaireCsvId?: string;
  questionnaireCsvName?: string;
  sessionToken?: string;
};

type TranscriptionFile = {
  id: string;
  name: string;
  modifiedTime?: string;
};

type TranscriptionsListResponse = {
  files: TranscriptionFile[];
  sessionToken?: string;
};

type TranscriptionResponse = TranscriptionFile & {
  content: string;
  personName: string;
  sessionToken?: string;
};

type SessionCheckResponse = {
  email: string;
  sessionToken: string;
  status: string;
};

type ApiErrorResponse = {
  error?: string;
  googleError?: string;
  message?: string;
  reason?: string;
  status?: number;
};

type NativeError = {
  code?: string;
};

type CsvFileModule = {
  getQuestionnaireAnswersPath: () => Promise<string | null>;
  readQuestionnaireAnswers: () => Promise<string | null>;
  writeQuestionnaireAnswers: (csvContent: string) => Promise<string>;
};

type AppInfoResponse = {
  versionCode: string;
  versionName: string;
};

type AppInfoModule = {
  getVersion: () => Promise<AppInfoResponse>;
};

type MobileAppVersionPlatform = {
  requiredBuild: number;
  updateUrl: string;
  versionName: string;
};

type MobileAppVersionManifest = {
  android?: MobileAppVersionPlatform;
  ios?: MobileAppVersionPlatform;
  message?: string;
  mode?: string;
};

type RequiredUpdate = {
  currentBuild: number;
  currentVersionName: string;
  message: string;
  requiredBuild: number;
  updateUrl: string;
};

type IosAuthSessionModule = {
  openAuthUrl: (authUrl: string, callbackScheme: string) => Promise<string>;
};

const appName = 'LMNOP';
const mobileAuthBaseUrl = 'https://api.example.invalid';
const mobileAuthStartUrl = `${mobileAuthBaseUrl}/mobile/google/start`;
const mobileAuthCallbackDebugUrl = `${mobileAuthBaseUrl}/mobile/debug/auth-callback`;
const mobileSessionUrl = `${mobileAuthBaseUrl}/mobile/google/session`;
const mobileDriveFolderEnsureUrl = `${mobileAuthBaseUrl}/mobile/google/drive/folder/ensure`;
const mobileIntakeSubmitUrl = `${mobileAuthBaseUrl}/mobile/google/drive/intake/submit`;
const mobileTranscriptionsUrl = `${mobileAuthBaseUrl}/mobile/google/drive/transcriptions`;
const mobileAppVersionUrl = `${mobileAuthBaseUrl}/mobile/app-version.json`;
const sessionTokenStorageKey = 'lmnop.mobileSessionToken';
const answersStorageKey = 'lmnop.questionnaireAnswers';
const intakeAnswersStorageKey = 'lmnop.intakeAnswers';
const AppInfo = NativeModules.AppInfo as AppInfoModule | undefined;
const CsvFile = NativeModules.CsvFile as CsvFileModule;
const IosAuthSession = NativeModules.IosAuthSession as
  | IosAuthSessionModule
  | undefined;

function logAuth(event: string, details?: Record<string, unknown>) {
  console.log(`LMNOP_AUTH ${event}`, details ?? {});
}

function describeAuthCallbackUrl(url: string): Record<string, unknown> {
  try {
    const callbackUrl = new URL(url);
    const sessionToken = callbackUrl.searchParams.get('session_token');

    return {
      hasFragment: callbackUrl.hash.length > 0,
      hashLength: callbackUrl.hash.length,
      host: callbackUrl.hostname,
      path: callbackUrl.pathname,
      protocol: callbackUrl.protocol,
      queryKeys: Array.from(callbackUrl.searchParams.keys()),
      rawLength: url.length,
      status: callbackUrl.searchParams.get('status'),
      tokenLength: sessionToken?.length,
      tokenParts: sessionToken?.split('.').length,
    };
  } catch (error) {
    return {
      errorName: (error as Error).name,
      parseError: true,
      rawLength: url.length,
    };
  }
}

const questions: Question[] = [
  {
    key: 'recordsFor',
    prompt: 'Who are you organizing records for?',
    options: [
      'Myself',
      'A family member',
      'Someone I care for',
      'Multiple people',
    ],
  },
  {
    key: 'organizeFirst',
    prompt: 'What would you like help organizing first?',
    options: [
      'Lab results',
      'Prescriptions / medications',
      'Doctor visit documents',
      'Receipts / bills',
      'Other health documents',
    ],
  },
  {
    key: 'regularMedications',
    prompt: 'Do you currently take any regular medications?',
    options: ['Yes', 'No', 'Not sure', "I'll add this later"],
  },
  {
    key: 'documentFrequency',
    prompt: 'How often do you usually receive new health documents?',
    options: ['Weekly', 'Monthly', 'A few times a year', 'Rarely', 'Not sure'],
  },
  {
    key: 'documentSources',
    prompt: 'Where are your health documents usually found?',
    options: [
      'Google Drive',
      'Gmail attachments',
      'Paper documents',
      'Patient portals',
      'Photos on my phone',
      'Other',
    ],
  },
  {
    key: 'mainGoal',
    prompt: 'What is your main goal?',
    options: [
      'Be ready for doctor visits',
      'Keep family records organized',
      'Track medications',
      'Store lab results',
      'Keep everything in one safe place',
    ],
  },
  {
    key: 'reminders',
    prompt: 'Would you like reminders to add new documents?',
    options: ['Yes', 'No', 'Decide later'],
  },
];

const intakeSections: IntakeSection[] = [
  {
    icon: 'person',
    key: 'personal-demographics',
    number: 1,
    title: 'Personal Demographics & Contact Information',
    fields: [
      'Full legal name, preferred name, and aliases',
      'Date of birth, legal sex assigned at birth, and gender identity',
      'Social Security Number or National ID',
      'Residential address, primary phone number, and email address',
      'Marital status and occupation',
      'Primary language and interpreter need',
    ],
  },
  {
    icon: 'phone',
    key: 'emergency-contacts',
    number: 2,
    title: 'Emergency Contacts & Legal Representatives',
    fields: [
      'Primary and secondary emergency contacts',
      'Contact relationships, phone numbers, and addresses',
      'Legal guardian or healthcare power of attorney details',
      'Guarantor or financially responsible party details',
    ],
  },
  {
    icon: 'shield',
    key: 'insurance-billing',
    number: 3,
    title: 'Insurance & Billing',
    fields: [
      'Primary and secondary insurance carriers',
      'Policy or member ID and group number',
      'Policyholder name, date of birth, and relationship',
      'Employer details for sponsored plans or workers compensation',
    ],
  },
  {
    icon: 'pain',
    key: 'visit-details',
    number: 4,
    title: 'Chief Complaint & Current Visit Details',
    fields: [
      'Primary reason for visit or current symptoms',
      'Symptom start date, time, and progression',
      'Pain rating and pain characteristics',
      'Accident, workplace injury, or trauma relationship',
      'Primary care and referring physician details',
    ],
  },
  {
    icon: 'alert',
    key: 'allergies',
    number: 5,
    title: 'Allergies & Adverse Reactions',
    fields: [
      'Known drug allergies and reaction type',
      'Latex, iodine or contrast dye, adhesive, and food allergies',
    ],
  },
  {
    icon: 'meds',
    key: 'medications',
    number: 6,
    title: 'Medications & Supplements',
    fields: [
      'Prescription medication name, dosage, and frequency',
      'Regular over-the-counter medications',
      'Vitamins, herbal remedies, and dietary supplements',
      'Preferred outpatient pharmacy name and location',
    ],
  },
  {
    icon: 'folder',
    key: 'medical-history',
    number: 7,
    title: 'Past Medical & Surgical History',
    fields: [
      'Chronic conditions',
      'Prior surgeries, hospitalizations, and approximate dates',
      'Implanted devices',
      'Pregnancy, nursing, and last menstrual period when applicable',
    ],
  },
  {
    icon: 'family',
    key: 'family-history',
    number: 8,
    title: 'Family Medical History',
    fields: [
      'Cardiovascular disease or early heart attacks',
      'Cancer type and age of onset',
      'Diabetes, stroke, blood clots, or autoimmune diseases',
      'Genetic disorders or anesthesia reactions',
    ],
  },
  {
    icon: 'group',
    key: 'social-history',
    number: 9,
    title: 'Social & Lifestyle History',
    fields: [
      'Tobacco and nicotine use',
      'Alcohol frequency and typical quantity',
      'Recreational or non-prescribed substance use',
      'Living arrangements and home access considerations',
    ],
  },
  {
    icon: 'clipboard',
    key: 'review-of-systems',
    number: 10,
    title: 'Review of Systems',
    fields: [
      'Constitutional symptoms',
      'Cardiovascular and respiratory symptoms',
      'Gastrointestinal symptoms',
      'Neurological and psychiatric symptoms',
    ],
  },
  {
    icon: 'legal',
    key: 'legal-consent',
    number: 11,
    title: 'Legal & Consent Acknowledgments',
    fields: [
      'Advance directive, living will, or DNR order',
      'General medical examination and treatment consent',
      'HIPAA or privacy practices acknowledgment',
      'Authorized individuals for health information release',
      'Assignment of benefits and financial responsibility',
    ],
  },
];

function App() {
  return (
    <SafeAreaProvider>
      <StatusBar barStyle="dark-content" />
      <AppContent />
    </SafeAreaProvider>
  );
}

function AppContent() {
  const [pendingReports, setPendingReports] = useState(0);
  const [reportModal, setReportModal] = useState(false);
  useEffect(() => {
    let mounted = true;
    const refresh = () => {
      pendingPerformanceReports()
        .then((paths) => {
          if (mounted) setPendingReports(paths.length);
        })
        .catch(() => undefined);
    };
    const wake = () =>
      clearPerformanceRecordings()
        .finally(refresh)
        .catch(() => undefined);
    wake();
    const state = AppState.addEventListener('change', (next) => {
      if (next === 'active') wake();
    });
    const unsubscribe = subscribePerformanceReports(refresh);
    return () => {
      mounted = false;
      unsubscribe();
      state.remove();
    };
  }, []);
  const { width: viewportWidth } = useWindowDimensions();
  const [step, setStep] = useState<Step>('sign-in');
  const dictationPauseMs = 160;
  const [refinementProvider, setRefinementProvider] = useState<'parakeet'>('parakeet');
  const [offlineModel, setOfflineModel] = useState<OmiMedModelState>({
    phase: 'checking',
    progress: 0,
  });
  const [isLiveSpeechModelReady, setIsLiveSpeechModelReady] = useState(false);
  useEffect(() => {
    const unsubscribe = observeOfflineModel((next) => {
      setOfflineModel(next);
      if (
        next.phase === 'ready'
      )
        setRefinementProvider('parakeet');
    });
    isOfflineModelReady().catch(() => undefined);
    return unsubscribe;
  }, []);
  const [speechActivity, setSpeechActivity] = useState('');
  const [speechAudioLevel, setSpeechAudioLevel] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [intakeAnswers, setIntakeAnswers] = useState<Record<string, string>>(
    {},
  );
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [driveFolder, setDriveFolder] = useState<DriveFolderResponse | null>(
    null,
  );
  const [transcriptionFiles, setTranscriptionFiles] = useState<TranscriptionFile[]>([]);
  const [isLoadingTranscriptions, setIsLoadingTranscriptions] = useState(false);
  const [transcriptionsError, setTranscriptionsError] = useState<string | null>(null);
  const [showNewTranscription, setShowNewTranscription] = useState(false);
  const [newTranscriptionFirstName, setNewTranscriptionFirstName] = useState('');
  const [newTranscriptionLastName, setNewTranscriptionLastName] = useState('');
  const [activeTranscriptionName, setActiveTranscriptionName] = useState('');
  const [activeTranscriptionId, setActiveTranscriptionId] = useState<string | null>(null);
  const [transcriptionIsSaved, setTranscriptionIsSaved] = useState(false);
  const [isSavingTranscription, setIsSavingTranscription] = useState(false);
  const [transcriptionSaveError, setTranscriptionSaveError] = useState<string | null>(null);
  const [transcriptionFormError, setTranscriptionFormError] = useState<string | null>(null);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [isRestoringSession, setIsRestoringSession] = useState(true);
  const [isCreatingDriveFolder, setIsCreatingDriveFolder] = useState(false);
  const [signInError, setSignInError] = useState<string | null>(null);
  const [driveFolderError, setDriveFolderError] = useState<string | null>(null);
  const [appVersionLabel, setAppVersionLabel] = useState<string | null>(null);
  const [requiredUpdate, setRequiredUpdate] = useState<RequiredUpdate | null>(
    null,
  );
  const [localCsvPath, setLocalCsvPath] = useState<string | null>(null);
  const [shouldForceConsent, setShouldForceConsent] = useState(false);
  const [selectedIntakeSection, setSelectedIntakeSection] =
    useState<IntakeSection | null>(null);
  const [outgoingIntakeSection, setOutgoingIntakeSection] =
    useState<IntakeSection | null>(null);
  const [sectionWipeDirection, setSectionWipeDirection] = useState<1 | -1>(1);
  const [isSubmittingIntake, setIsSubmittingIntake] = useState(false);
  const [hasReachedReviewBottom, setHasReachedReviewBottom] = useState(false);
  const [intakeSubmitError, setIntakeSubmitError] = useState<string | null>(
    null,
  );
  const [speechTranscript, setSpeechTranscript] = useState<SpeechTranscript>({
    confirmed: '',
    provisional: '',
  });
  const speechScrollRef = useRef<ComponentRef<typeof ScrollView> | null>(null);
  const [speechStatus, setSpeechStatus] = useState<SpeechStatus>('idle');
  const [refinementCanStop, setRefinementCanStop] = useState(false);
  const [speechError, setSpeechError] = useState<string | null>(null);
  const [dictationModelsPreparing, setDictationModelsPreparing] = useState(false);
  const [dictationModelsError, setDictationModelsError] = useState<string | null>(null);
  const [dictationPreparationStep, setDictationPreparationStep] = useState('');
  const sectionWipe = useRef(new Animated.Value(1)).current;
  const handledAuthCallbackUrls = useRef(new Set<string>());
  const speechSessionRef = useRef<SpeechToTextSession | null>(null);
  const [keyboardSelection, setKeyboardSelection] =
    useState<ReplacementSelection | null>(null);
  const [replacement, setReplacement] = useState<ReplacementSelection | null>(
    null,
  );
  const [speechSelection, setSpeechSelection] =
    useState<ReplacementSelection | null>(null);
  const waitForSpeechRelease = useCallback(() => speechCleanupRef.current, []);
  const speechRecordingRef = useRef(false);
  const speechCleanupRef = useRef<Promise<void>>(Promise.resolve());
  const speechTranscriptRef = useRef(speechTranscript);
  speechTranscriptRef.current = speechTranscript;

  const handleUrl = useCallback(async (url: string) => {
    logAuth('handle_url_received', describeAuthCallbackUrl(url));

    const callback = parseAuthCallback(url);

    if (!callback) {
      logAuth('callback_parse_rejected', describeAuthCallbackUrl(url));
      return;
    }

    if (handledAuthCallbackUrls.current.has(url)) {
      logAuth('callback_duplicate_ignored', describeAuthCallbackUrl(url));
      return;
    }

    handledAuthCallbackUrls.current.add(url);
    logAuth('callback_parse_accepted', describeAuthCallbackUrl(url));

    if (callback.status === 'ok') {
      logAuth('callback_status_ok', {
        hasSessionToken: Boolean(callback.sessionToken),
        tokenLength: callback.sessionToken?.length,
        tokenParts: callback.sessionToken?.split('.').length,
      });
      reportAuthCallbackDebug(url, callback).catch(() => undefined);

      if (!callback.sessionToken) {
        setSessionToken(null);
        await AsyncStorage.removeItem(sessionTokenStorageKey);
        setSignInError('Google sign-in did not return a usable session.');
        setStep('sign-in');
        setIsSigningIn(false);
        return;
      }

      logAuth('session_verify_before');
      const verifiedSession = await verifySessionToken(callback.sessionToken);
      logAuth('session_verify_after', {
        ok: Boolean(verifiedSession),
        returnedTokenLength: verifiedSession?.sessionToken.length,
        returnedTokenParts: verifiedSession?.sessionToken.split('.').length,
      });

      if (!verifiedSession) {
        setSessionToken(null);
        await AsyncStorage.removeItem(sessionTokenStorageKey);
        setShouldForceConsent(true);
        setSignInError(
          'Google sign-in could not be verified. Continue with Google again.',
        );
        setStep('sign-in');
        setIsSigningIn(false);
        return;
      }

      await saveSessionToken(verifiedSession.sessionToken);
      setUserEmail(verifiedSession.email);
      setSessionToken(verifiedSession.sessionToken);
      setDriveFolder(null);
      setDriveFolderError(null);
      setSignInError(null);
      setShouldForceConsent(false);
      setStep('home');
      loadTranscriptions(verifiedSession.sessionToken).catch(() => undefined);
    } else if (callback.status === 'cancelled') {
      logAuth('callback_status_cancelled');
      setSessionToken(null);
      AsyncStorage.removeItem(sessionTokenStorageKey).catch(() => undefined);
      setSignInError(
        'Google sign-in was cancelled. You can try again when ready.',
      );
      setStep('sign-in');
    } else {
      logAuth('callback_status_unexpected', { status: callback.status });
      setSessionToken(null);
      AsyncStorage.removeItem(sessionTokenStorageKey).catch(() => undefined);
      setSignInError('Google sign-in did not complete.');
      setStep('sign-in');
    }

    setIsSigningIn(false);
  }, []);

  const checkRequiredUpdate = useCallback(async () => {
    if (!AppInfo?.getVersion) {
      return;
    }

    try {
      const version = await AppInfo.getVersion();
      const currentBuild = Number.parseInt(version.versionCode, 10);

      setAppVersionLabel(
        `v${version.versionName} · Build ${version.versionCode} · Update ${updateLabel}`,
      );

      if (!Number.isFinite(currentBuild)) {
        return;
      }

      const response = await fetch(mobileAppVersionUrl, {
        headers: {
          'cache-control': 'no-cache',
        },
      });

      if (!response.ok) {
        return;
      }

      const manifest = (await response.json()) as MobileAppVersionManifest;
      const platformVersion =
        Platform.OS === 'ios'
          ? manifest.ios
          : Platform.OS === 'android'
          ? manifest.android
          : undefined;
      const requiredBuild = Number(platformVersion?.requiredBuild);

      if (
        platformVersion?.updateUrl &&
        Number.isFinite(requiredBuild) &&
        currentBuild < requiredBuild
      ) {
        setRequiredUpdate({
          currentBuild,
          currentVersionName: version.versionName,
          message:
            manifest.message ?? 'A newer LMNOP build is required to continue.',
          requiredBuild,
          updateUrl: platformVersion.updateUrl,
        });
        return;
      }

      setRequiredUpdate(null);
    } catch (error) {
      console.warn('Required update check failed:', error);
    }
  }, []);

  useEffect(() => {
    checkRequiredUpdate().catch(() => undefined);

    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        checkRequiredUpdate().catch(() => undefined);
      }
    });

    return () => {
      subscription.remove();
    };
  }, [checkRequiredUpdate]);

  useEffect(() => {
    if (!sessionToken) return;
    let reporting = false;
    const report = async () => {
      if (reporting) return;
      reporting = true;
      try {
        await reportUpdateVersion(sessionToken);
      } catch {
        /* Retry next foreground. */
      } finally {
        reporting = false;
      }
    };
    report().catch(() => undefined);
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') report().catch(() => undefined);
    });
    return () => subscription.remove();
  }, [sessionToken]);

  useEffect(() => {
    if (step !== 'speech-to-text' || replacement !== null) {
      return;
    }
    let leaving = false;
    let foreground = AppState.currentState !== 'background';
    const prepare = async () => {
      await speechCleanupRef.current;
      if (leaving || !foreground) {
        return;
      }
      if (speechSessionRef.current) {
        return;
      }
      setDictationModelsError(null);
      setDictationModelsPreparing(true);
      setDictationPreparationStep('Loading Moonshine Medium…');
      const session = createSpeechToTextSession(
        speechTranscriptRef.current.confirmed,
        { provider: refinementProvider, pauseMs: dictationPauseMs },
      );
      speechSessionRef.current = session;
      setIsLiveSpeechModelReady(false);
      (async () => {
        await session.prepare();
      })()
        .then(() => {
          if (leaving || !foreground) return;
          setIsLiveSpeechModelReady(true);
          setDictationModelsPreparing(false);
          setDictationModelsError(null);
          setDictationPreparationStep('');

        })
        .catch((error) => {
          setIsLiveSpeechModelReady(false);
          setDictationModelsPreparing(false);
          setDictationModelsError(
            error instanceof Error
              ? error.message
              : 'Dictation model preparation failed.',
          );
          if (speechSessionRef.current === session) {
            setSpeechError(
              error instanceof Error
                ? error.message
                : 'Speech model preparation failed.',
            );
          }
        });
    };
    const release = () => {
      const session = speechSessionRef.current;
      const beforeRelease = speechTranscriptRef.current;
      speechSessionRef.current = null;
      speechRecordingRef.current = false;
      setIsLiveSpeechModelReady(false);
      setDictationModelsPreparing(false);
      setDictationPreparationStep('');
      setSpeechStatus('idle');
      if (session) {
        speechCleanupRef.current = session
          .dispose()
          .then(transcript => {
            // Legacy online modes may finish a draft during disposal. Never let
            // that snapshot replace a user's intervening edit or a newer session.
            if (!speechSessionRef.current && speechTranscriptRef.current === beforeRelease) {
              speechTranscriptRef.current = transcript;
              setSpeechTranscript(transcript);
            }
          })
          .catch(() => undefined);
      }
    };
    prepare().catch(() => undefined);
    const subscription = AppState.addEventListener('change', (state) => {
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
      leaving = true;
      subscription.remove();
      release();
    };
  }, [step, replacement]);

  useEffect(() => {
    const session = speechSessionRef.current;
    if (session && 'setRefinementProvider' in session) {
      session.setRefinementProvider(
        refinementProvider,
      );
    }
  }, [refinementProvider]);

  useEffect(() => {
    async function restoreSession() {
      try {
        const storedSessionToken = await AsyncStorage.getItem(
          sessionTokenStorageKey,
        );

        if (!storedSessionToken) {
          return;
        }

        const response = await fetch(mobileSessionUrl, {
          headers: {
            authorization: `Bearer ${storedSessionToken}`,
          },
        });

        if (!response.ok) {
          await AsyncStorage.removeItem(sessionTokenStorageKey);
          setSessionToken(null);
          setShouldForceConsent(response.status === 401);
          return;
        }

        const restoredSession = (await response.json()) as SessionCheckResponse;

        if (restoredSession.status !== 'ok') {
          await AsyncStorage.removeItem(sessionTokenStorageKey);
          setSessionToken(null);
          setShouldForceConsent(true);
          return;
        }

        await saveSessionToken(restoredSession.sessionToken);
        await restoreIntakeAnswers();
        await restoreAnswers();
        await restoreCsvPath();
        setUserEmail(restoredSession.email);
        setSessionToken(restoredSession.sessionToken);
        setSignInError(null);
        setShouldForceConsent(false);
        setStep('home');
        loadTranscriptions(restoredSession.sessionToken).catch(() => undefined);
      } catch {
        setSignInError('Could not restore Google sign-in.');
      } finally {
        setIsRestoringSession(false);
      }
    }

    async function restoreAnswers() {
      const csvContent = await CsvFile.readQuestionnaireAnswers();

      if (csvContent) {
        setAnswers(parseQuestionnaireCsv(csvContent));
        return;
      }

      const storedAnswers = await AsyncStorage.getItem(answersStorageKey);

      if (storedAnswers) {
        setAnswers(JSON.parse(storedAnswers) as Record<string, string>);
      }
    }

    async function restoreIntakeAnswers() {
      const storedIntakeAnswers = await AsyncStorage.getItem(
        intakeAnswersStorageKey,
      );

      if (storedIntakeAnswers) {
        setIntakeAnswers(
          JSON.parse(storedIntakeAnswers) as Record<string, string>,
        );
      }
    }

    async function restoreCsvPath() {
      const csvPath = await CsvFile.getQuestionnaireAnswersPath();

      setLocalCsvPath(csvPath);
    }

    restoreSession().catch(() => undefined);

    Linking.getInitialURL().then((url) => {
      if (url) {
        handleUrl(url).catch(() => undefined);
      }
    });

    const subscription = Linking.addEventListener('url', (event) => {
      handleUrl(event.url).catch(() => undefined);
    });

    return () => {
      subscription.remove();
    };
  }, [handleUrl]);

  const canSubmit = useMemo(
    () => questions.every((question) => answers[question.key]),
    [answers],
  );
  const canReviewIntake = useMemo(
    () => isIntakeSectionComplete(intakeSections[0], intakeAnswers),
    [intakeAnswers],
  );
  const completedIntakeSectionCount = useMemo(
    () =>
      intakeSections.filter((section) =>
        isIntakeSectionComplete(section, intakeAnswers),
      ).length,
    [intakeAnswers],
  );
  const selectedIntakeSectionIndex = useMemo(
    () =>
      selectedIntakeSection
        ? intakeSections.findIndex(
            (section) => section.key === selectedIntakeSection.key,
          )
        : -1,
    [selectedIntakeSection],
  );

  async function signInWithBrowser() {
    if (!mobileAuthStartUrl) {
      setSignInError('Browser sign-in is not configured yet.');
      return;
    }

    setIsSigningIn(true);
    setSignInError(null);

    try {
      const callbackUrl = encodeURIComponent('lmnop://auth/callback');
      const forceConsentParam = shouldForceConsent ? '&force_consent=true' : '';
      const authUrl = `${mobileAuthStartUrl}?callback_url=${callbackUrl}${forceConsentParam}`;
      logAuth('signin_start', {
        forceConsent: shouldForceConsent,
        hasIosAuthSession: Boolean(IosAuthSession?.openAuthUrl),
      });

      if (IosAuthSession?.openAuthUrl) {
        logAuth('ios_auth_session_open');
        const authCallbackUrl = await IosAuthSession.openAuthUrl(
          authUrl,
          'lmnop',
        );
        logAuth(
          'ios_auth_session_returned',
          describeAuthCallbackUrl(authCallbackUrl),
        );
        await handleUrl(authCallbackUrl);
        setIsSigningIn(false);
        logAuth('ios_auth_session_complete');
        return;
      }

      logAuth('linking_open_url');
      await Linking.openURL(authUrl);
      setIsSigningIn(false);
    } catch (error) {
      logAuth('signin_error', {
        code: (error as NativeError)?.code,
        message: (error as Error)?.message,
        name: (error as Error)?.name,
      });
      setIsSigningIn(false);
      if ((error as NativeError)?.code === 'auth_session_cancelled') {
        setSignInError(
          'Google sign-in was cancelled. You can try again when ready.',
        );
        return;
      }

      setSignInError('Could not open Google sign-in.');
    }
  }

  async function createDriveFolder() {
    await syncAnswers(answers, true);
  }

  async function syncAnswers(
    nextAnswers: Record<string, string>,
    showReadyWhenDone: boolean,
  ) {
    if (!sessionToken) {
      setDriveFolderError('Google sign-in expired. Please sign in again.');
      return;
    }

    setIsCreatingDriveFolder(true);
    setDriveFolderError(null);

    try {
      const csvContent = buildQuestionnaireCsv(nextAnswers);
      const nextLocalCsvPath = await CsvFile.writeQuestionnaireAnswers(
        csvContent,
      );

      await AsyncStorage.setItem(
        answersStorageKey,
        JSON.stringify(nextAnswers),
      );
      setLocalCsvPath(nextLocalCsvPath);

      const response = await fetch(mobileDriveFolderEnsureUrl, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${sessionToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ answers: nextAnswers, csvContent }),
      });

      if (!response.ok) {
        const errorBody = (await response
          .json()
          .catch(() => null)) as ApiErrorResponse | null;

        if (response.status === 401) {
          await AsyncStorage.removeItem(sessionTokenStorageKey);
          setSessionToken(null);
          setShouldForceConsent(true);
          setStep('sign-in');
          throw new Error(
            'Google sign-in expired. Continue with Google again to reconnect.',
          );
        }

        const errorCode = errorBody?.error ?? 'drive_folder_request_failed';
        const upstreamStatus = errorBody?.status
          ? ` Google status ${errorBody.status}.`
          : '';
        const googleError = errorBody?.googleError
          ? ` ${errorBody.googleError}.`
          : '';
        const googleMessage = errorBody?.message ? ` ${errorBody.message}` : '';

        throw new Error(
          `${errorCode}. Worker status ${response.status}.${upstreamStatus}${googleError}${googleMessage}`,
        );
      }

      const nextDriveFolder = (await response.json()) as DriveFolderResponse;

      if (nextDriveFolder.sessionToken) {
        await saveSessionToken(nextDriveFolder.sessionToken);
        setSessionToken(nextDriveFolder.sessionToken);
      }

      setDriveFolder(nextDriveFolder);
      if (showReadyWhenDone) {
        setStep('ready');
      }
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Could not create the Google Drive folder.';

      setDriveFolderError(message);
    } finally {
      setIsCreatingDriveFolder(false);
    }
  }

  async function loadTranscriptions(token = sessionToken) {
    if (!token) {
      setTranscriptionsError('Google sign-in expired. Please sign in again.');
      return;
    }
    setIsLoadingTranscriptions(true);
    setTranscriptionsError(null);
    try {
      const response = await fetch(mobileTranscriptionsUrl, {
        headers: { authorization: `Bearer ${token}` },
      });
      if (response.status === 401) {
        await AsyncStorage.removeItem(sessionTokenStorageKey);
        setSessionToken(null);
        setShouldForceConsent(true);
        setStep('sign-in');
        throw new Error('Google sign-in expired. Continue with Google to reconnect.');
      }
      const result = (await response.json().catch(() => null)) as
        | (TranscriptionsListResponse & ApiErrorResponse)
        | null;
      if (!response.ok) throw new Error(result?.message ?? result?.error ?? 'Could not load transcriptions from Google Drive.');
      setTranscriptionFiles(result?.files ?? []);
      if (result?.sessionToken) {
        await saveSessionToken(result.sessionToken);
        setSessionToken(result.sessionToken);
      }
    } catch (error) {
      setTranscriptionsError(error instanceof Error ? error.message : 'Could not load transcriptions from Google Drive.');
    } finally {
      setIsLoadingTranscriptions(false);
    }
  }

  async function beginNewTranscription() {
    const cleanNamePart = (value: string) =>
      value.replace(/[\\/\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim();
    const firstName = cleanNamePart(newTranscriptionFirstName);
    const lastName = cleanNamePart(newTranscriptionLastName);
    if (!firstName || !lastName) {
      setTranscriptionFormError('Enter both a first and last name.');
      return;
    }
    const personName = `${firstName} ${lastName}`.replace(/\s+/g, ' ');
    if (!sessionToken) {
      setTranscriptionFormError('Google sign-in expired. Please sign in again.');
      return;
    }
    setIsSavingTranscription(true);
    setTranscriptionFormError(null);
    try {
      const response = await fetch(mobileTranscriptionsUrl, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${sessionToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ firstName, lastName, content: '' }),
      });
      const result = (await response.json().catch(() => null)) as
        | (TranscriptionResponse & ApiErrorResponse)
        | null;
      if (response.status === 401) {
        await AsyncStorage.removeItem(sessionTokenStorageKey);
        setSessionToken(null);
        setShouldForceConsent(true);
        setStep('sign-in');
        throw new Error('Google sign-in expired. Continue with Google to reconnect.');
      }
      if (response.status === 409) {
        throw new Error('A transcription with this name already exists. Open it from the list instead.');
      }
      if (!response.ok || !result) {
        throw new Error(result?.message ?? result?.error ?? 'Could not create this transcription in Google Drive.');
      }
      setActiveTranscriptionName(result.personName);
      setActiveTranscriptionId(result.id);
      setTranscriptionIsSaved(true);
      setTranscriptionFiles((files) => [
        { id: result.id, name: result.name, modifiedTime: result.modifiedTime },
        ...files.filter((file) => file.id !== result.id),
      ]);
      if (result.sessionToken) {
        setSessionToken(result.sessionToken);
        saveSessionToken(result.sessionToken).catch(() => undefined);
      }
    } catch (error) {
      setTranscriptionFormError(error instanceof Error ? error.message : 'Could not create this transcription in Google Drive.');
      return;
    } finally {
      setIsSavingTranscription(false);
    }
    setTranscriptionSaveError(null);
    setSpeechSelection(null);
    setSpeechTranscript({ confirmed: '', provisional: '' });
    speechTranscriptRef.current = { confirmed: '', provisional: '' };
    setShowNewTranscription(false);
    setNewTranscriptionFirstName('');
    setNewTranscriptionLastName('');
    setTranscriptionFormError(null);
    setStep('speech-to-text');
  }

  async function openTranscription(file: TranscriptionFile) {
    if (!sessionToken) return;
    setIsLoadingTranscriptions(true);
    setTranscriptionsError(null);
    try {
      const response = await fetch(`${mobileTranscriptionsUrl}/${encodeURIComponent(file.id)}`, {
        headers: { authorization: `Bearer ${sessionToken}` },
      });
      if (response.status === 401) {
        await AsyncStorage.removeItem(sessionTokenStorageKey);
        setSessionToken(null);
        setShouldForceConsent(true);
        setStep('sign-in');
        throw new Error('Google sign-in expired. Continue with Google to reconnect.');
      }
      const result = (await response.json().catch(() => null)) as
        | (TranscriptionResponse & ApiErrorResponse)
        | null;
      if (!response.ok || !result) throw new Error(result?.message ?? result?.error ?? 'Could not open this transcription.');
      const nextTranscript = { confirmed: result.content ?? '', provisional: '' };
      setSpeechTranscript(nextTranscript);
      speechTranscriptRef.current = nextTranscript;
      setSpeechSelection(null);
      setActiveTranscriptionName(result.personName);
      setActiveTranscriptionId(result.id);
      setTranscriptionIsSaved(true);
      setTranscriptionSaveError(null);
      if (result.sessionToken) {
        setSessionToken(result.sessionToken);
        saveSessionToken(result.sessionToken).catch(() => undefined);
      }
      setStep('speech-to-text');
    } catch (error) {
      setTranscriptionsError(error instanceof Error ? error.message : 'Could not open this transcription.');
    } finally {
      setIsLoadingTranscriptions(false);
    }
  }

  async function saveActiveTranscription() {
      if (!sessionToken || !activeTranscriptionName || !activeTranscriptionId || isSavingTranscription || speechRecordingRef.current) return;
    const [firstName, ...lastNameParts] = activeTranscriptionName.trim().split(/\s+/);
    const lastName = lastNameParts.join(' ');
    if (!firstName || !lastName) {
      setTranscriptionSaveError('A first and last name are required to save this file.');
      return;
    }
    setIsSavingTranscription(true);
    setTranscriptionSaveError(null);
    try {
      const response = await fetch(
          `${mobileTranscriptionsUrl}/${encodeURIComponent(activeTranscriptionId)}`,
        {
          method: 'PUT',
          headers: {
            authorization: `Bearer ${sessionToken}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ firstName, lastName, content: speechTranscriptRef.current.confirmed }),
        },
      );
      if (response.status === 401) {
        await AsyncStorage.removeItem(sessionTokenStorageKey);
        setSessionToken(null);
        setShouldForceConsent(true);
        setStep('sign-in');
        throw new Error('Google sign-in expired. Continue with Google to reconnect.');
      }
      const result = (await response.json().catch(() => null)) as
        | (TranscriptionResponse & ApiErrorResponse)
        | null;
      if (response.status === 409) {
        throw new Error('A file with this name already exists in Google Drive. Open it from Transcriptions to continue editing.');
      }
      if (!response.ok || !result) throw new Error(result?.message ?? result?.error ?? 'Could not save to Google Drive.');
      setActiveTranscriptionId(result.id);
      setActiveTranscriptionName(result.personName);
      setTranscriptionIsSaved(true);
      setTranscriptionFiles((files) => [
        { id: result.id, name: result.name, modifiedTime: result.modifiedTime },
        ...files.filter((file) => file.id !== result.id),
      ]);
      if (result.sessionToken) {
        await saveSessionToken(result.sessionToken);
        setSessionToken(result.sessionToken);
      }
      setTranscriptionSaveError(null);
    } catch (error) {
      setTranscriptionSaveError(error instanceof Error ? error.message : 'Could not save to Google Drive.');
    } finally {
      setIsSavingTranscription(false);
    }
  }

  async function selectAnswer(questionKey: string, option: string) {
    const nextAnswers = {
      ...answers,
      [questionKey]: option,
    };

    setAnswers(nextAnswers);
    await AsyncStorage.setItem(answersStorageKey, JSON.stringify(nextAnswers));

    if (localCsvPath && sessionToken && areAnswersComplete(nextAnswers)) {
      await syncAnswers(nextAnswers, false);
    }
  }

  async function reviewAnswers() {
    const csvContent = await CsvFile.readQuestionnaireAnswers();

    if (csvContent) {
      setAnswers(parseQuestionnaireCsv(csvContent));
      setLocalCsvPath(
        (await CsvFile.getQuestionnaireAnswersPath()) ?? localCsvPath,
      );
    }

    setStep('questionnaire');
  }

  function openIntakeSection(section: IntakeSection) {
    sectionWipe.stopAnimation();
    sectionWipe.setValue(1);
    setOutgoingIntakeSection(null);
    setSelectedIntakeSection(section);
    setStep('intake-section');
  }

  function closeIntakeSection() {
    sectionWipe.stopAnimation();
    sectionWipe.setValue(1);
    setOutgoingIntakeSection(null);
    setSelectedIntakeSection(null);
    setStep('dashboard');
  }

  function goToPreviousIntakeSection() {
    if (selectedIntakeSectionIndex <= 0) {
      return;
    }

    revealIntakeSection(intakeSections[selectedIntakeSectionIndex - 1], -1);
  }

  function goToNextIntakeSection() {
    if (selectedIntakeSectionIndex < 0) {
      return;
    }

    if (selectedIntakeSectionIndex >= intakeSections.length - 1) {
      openIntakeReview();
      return;
    }

    revealIntakeSection(intakeSections[selectedIntakeSectionIndex + 1], 1);
  }

  function revealIntakeSection(section: IntakeSection, direction: -1 | 1) {
    sectionWipe.stopAnimation();
    setSectionWipeDirection(direction);
    setOutgoingIntakeSection(selectedIntakeSection);
    sectionWipe.setValue(0);
    setSelectedIntakeSection(section);
    Animated.timing(sectionWipe, {
      duration: 260,
      toValue: 1,
      useNativeDriver: true,
    }).start(() => {
      setOutgoingIntakeSection(null);
    });
  }

  async function updateIntakeAnswer(
    section: IntakeSection,
    fieldIndex: number,
    value: string,
  ) {
    const nextAnswers = {
      ...intakeAnswers,
      [intakeAnswerKey(section, fieldIndex)]: value,
    };

    setIntakeAnswers(nextAnswers);
    setIntakeSubmitError(null);
    await AsyncStorage.setItem(
      intakeAnswersStorageKey,
      JSON.stringify(nextAnswers),
    );
  }

  function openIntakeReview() {
    if (!canReviewIntake) {
      setIntakeSubmitError(
        'Complete Personal Demographics & Contact Information first.',
      );
      return;
    }

    setIntakeSubmitError(null);
    setHasReachedReviewBottom(false);
    setStep('review');
  }

  async function startSpeechToText() {
    Keyboard.dismiss();
    if (speechRecordingRef.current) {
      return;
    }

    if (!speechSessionRef.current) {
      return;
    }

    const session =
      speechSessionRef.current ??
      createSpeechToTextSession(speechTranscript.confirmed);

    try {
      speechSessionRef.current = session;
      speechRecordingRef.current = true;
      if (activeTranscriptionId) {
        setTranscriptionIsSaved(false);
        setTranscriptionSaveError(null);
      }
      setSpeechStatus('initializing');
      setSpeechError(null);
      setSpeechActivity('');
      await session.start({
        onRecordingLimit: () => {
          stopSpeechToText().catch(() => undefined);
        },
        onAudioLevel: (level) => {
          if (speechSessionRef.current === session) setSpeechAudioLevel(level);
        },
        onActivity: (message) => {
          if (speechSessionRef.current === session) setSpeechActivity(message);
        },
        onError: (message) => {
          if (speechSessionRef.current === session) {
            setSpeechError(message);
          }
        },
        onStatus: (status) => {
          if (speechSessionRef.current === session) {
            setSpeechStatus(status);
            if (['idle', 'error', 'permission-denied', 'model-missing'].includes(status))
              speechRecordingRef.current = false;
          }
        },
        onTranscript: (transcript) => {
          if (speechSessionRef.current === session) {
          speechTranscriptRef.current = transcript;
          setSpeechTranscript(transcript);
          if (activeTranscriptionId) setTranscriptionIsSaved(false);
          }
        },
      });
    } catch {
      setSpeechStatus('error');
    }
  }

  async function retryDictationModelLoad() {
    const session = speechSessionRef.current;
    if (!session || !('prepare' in session)) return;
    setDictationModelsError(null);
    setDictationModelsPreparing(true);
    setDictationPreparationStep('Loading Moonshine Medium…');
    try {
      await session.prepare();
      setDictationModelsPreparing(false);
      setDictationModelsError(null);
      setDictationPreparationStep('');
      setIsLiveSpeechModelReady(true);
      setSpeechError(null);
    } catch (error) {
      setDictationModelsPreparing(false);
      setDictationModelsError(
          error instanceof Error
            ? error.message
          : 'Could not prepare Moonshine Medium.',
      );
    }
  }

  async function stopSpeechToText() {
    const session = speechSessionRef.current;

    if (!session || !speechRecordingRef.current) {
      return;
    }

    setSpeechStatus('finalizing');
    try {
      const transcript = await session.stop();

      if (speechSessionRef.current === session) {
        setSpeechTranscript(transcript);
        setSpeechStatus((status) =>
          status === 'finalizing' ||
          status === 'refining' ||
          status === 'listening' ||
          status === 'initializing'
            ? 'idle'
            : status,
        );
      }
    } catch {
      setSpeechStatus('error');
    }

    if (speechSessionRef.current === session) {
      speechRecordingRef.current = false;
    }
  }

  async function cancelSpeechToText() {
    const session = speechSessionRef.current;
    if (!session || !speechRecordingRef.current) return;
    try {
      const transcript = await session.cancel();
      if (speechSessionRef.current === session) {
        speechTranscriptRef.current = transcript;
        setSpeechTranscript(transcript);
      }
    } catch {
      // Keep the streaming transcript already published by the session.
    }
    if (speechSessionRef.current === session) {
      speechRecordingRef.current = false;
      setSpeechStatus('idle');
      setSpeechActivity('');
    }
  }

  const autoStopRef = useRef(stopSpeechToText);
  autoStopRef.current = stopSpeechToText;
  useEffect(() => {
    if (speechStatus !== 'listening') return;
    const timeout = setTimeout(() => {
      autoStopRef.current().catch(() => undefined);
    }, 60000);
    return () => clearTimeout(timeout);
  }, [speechStatus, refinementProvider]);

  useEffect(() => {
    if (speechStatus !== 'refining') {
      setRefinementCanStop(false);
      return;
    }
    const timeout = setTimeout(() => setRefinementCanStop(true), 5000);
    return () => clearTimeout(timeout);
  }, [speechStatus]);

  async function clearSpeechToText() {
    if (speechRecordingRef.current) {
      return;
    }
    setSpeechTranscript({ confirmed: '', provisional: '' });
    setSpeechSelection(null);
    if (activeTranscriptionId) setTranscriptionIsSaved(false);
    setTranscriptionSaveError(null);
    speechSessionRef.current?.clear();
    setSpeechError(null);
    await clearPauseRecoveryRecordings().catch(() => setSpeechError('Could not delete recovery audio. Press Clear to retry.'));
    await clearPerformanceRecordings(true).catch(() =>
      setSpeechError('Could not delete recorded audio. Press Clear to retry.'),
    );
  }

  async function submitIntake() {
    if (!sessionToken) {
      setIntakeSubmitError('Google sign-in expired. Please sign in again.');
      setStep('sign-in');
      return;
    }

    if (!canReviewIntake) {
      setIntakeSubmitError(
        'Complete Personal Demographics & Contact Information first.',
      );
      setStep('dashboard');
      return;
    }

    setIsSubmittingIntake(true);
    setIntakeSubmitError(null);

    try {
      const response = await fetch(mobileIntakeSubmitUrl, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${sessionToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          sections: buildIntakeSubmissionSections(intakeAnswers),
        }),
      });

      if (!response.ok) {
        const errorBody = (await response
          .json()
          .catch(() => null)) as ApiErrorResponse | null;

        if (response.status === 401) {
          await AsyncStorage.removeItem(sessionTokenStorageKey);
          setSessionToken(null);
          setShouldForceConsent(true);
          setStep('sign-in');
          throw new Error(
            'Google sign-in expired. Continue with Google again to reconnect.',
          );
        }

        const errorCode = errorBody?.error ?? 'intake_submit_request_failed';
        const upstreamStatus = errorBody?.status
          ? ` Google status ${errorBody.status}.`
          : '';
        const googleError = errorBody?.googleError
          ? ` ${errorBody.googleError}.`
          : '';
        const googleMessage = errorBody?.message ? ` ${errorBody.message}` : '';

        throw new Error(
          `${errorCode}. Worker status ${response.status}.${upstreamStatus}${googleError}${googleMessage}`,
        );
      }

      const nextDriveFolder = (await response.json()) as DriveFolderResponse;

      if (nextDriveFolder.sessionToken) {
        await saveSessionToken(nextDriveFolder.sessionToken);
        setSessionToken(nextDriveFolder.sessionToken);
      }

      setDriveFolder(nextDriveFolder);
      setStep('ready');
    } catch (error) {
      setIntakeSubmitError(
        error instanceof Error
          ? error.message
          : 'Could not submit intake to Google Drive.',
      );
    } finally {
      setIsSubmittingIntake(false);
    }
  }

  function renderIntakeSectionForm(section: IntakeSection) {
    return (
      <>
        <View style={styles.sectionFormList}>
          {section.fields.map((field, fieldIndex) => (
            <View key={field} style={styles.sectionFormField}>
              <Text style={styles.sectionFormLabel}>
                {field}
                {section.number === 1 ? ' *' : ''}
              </Text>
              <TextInput
                multiline
                onChangeText={(value) => {
                  updateIntakeAnswer(section, fieldIndex, value).catch(
                    () => undefined,
                  );
                }}
                placeholder="Enter details"
                placeholderTextColor="#8c978f"
                style={styles.sectionFormInput}
                value={
                  intakeAnswers[intakeAnswerKey(section, fieldIndex)] ?? ''
                }
              />
            </View>
          ))}
        </View>
      </>
    );
  }

  function renderIntakeTopNav(action?: { label: string; onPress: () => void }) {
    return (
      <View style={styles.intakeAppBar}>
        <Pressable accessibilityRole="button" onPress={action?.onPress ?? (() => setStep('home'))}>
          <Text style={styles.workspaceBack}>‹  {action ? 'Intake' : 'Home'}</Text>
        </Pressable>
        <Text style={styles.workspaceBrand}>LMNOP</Text>
      </View>
    );
  }

  function renderIntakePageHeader(props: {
    count?: string;
    progress?: number;
    subtitle?: string;
    title: string;
    variant?: 'dashboard' | 'section';
  }) {
    const isSectionHeader = props.variant === 'section';

    return (
      <View
        style={[
          styles.intakeSummary,
          isSectionHeader && styles.intakeSectionSummary,
        ]}
      >
        <View style={styles.intakeSummaryRow}>
          <View style={styles.intakeSummaryTextGroup}>
            <Text
              style={[
                styles.intakeSummaryTitle,
                isSectionHeader && styles.intakeSectionSummaryTitle,
              ]}
            >
              {props.title}
            </Text>
            {props.subtitle && (
              <Text
                style={[
                  styles.intakeSummarySubtitle,
                  isSectionHeader && styles.intakeSectionSummarySubtitle,
                ]}
              >
                {props.subtitle}
              </Text>
            )}
          </View>
          {props.count && (
            <Text style={styles.intakeSummaryCount}>{props.count}</Text>
          )}
        </View>
        {typeof props.progress === 'number' && (
          <View style={styles.progressTrack}>
            <View
              style={[
                styles.progressFill,
                { width: `${Math.max(0, Math.min(1, props.progress)) * 100}%` },
              ]}
            />
          </View>
        )}
      </View>
    );
  }

  function renderTranscriptions() {
    return (
      <View style={styles.transcriptionsPage}>
        <View style={styles.workspaceTopbar}>
          <Pressable accessibilityRole="button" onPress={() => setStep('home')}><Text style={styles.workspaceBack}>‹  Home</Text></Pressable>
          <Text style={styles.workspaceBrand}>LMNOP</Text>
        </View>
        <View style={styles.transcriptionsHeader}>
          <View>
            <Text style={styles.transcriptionsTitle}>Dictation</Text>
            <Text style={styles.transcriptionsSubtitle}>Your notes, ready when you need them.</Text>
          </View>
        </View>
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            setTranscriptionFormError(null);
            setShowNewTranscription(true);
          }}
          style={[styles.newTranscriptionButton, styles.dictationNewButton]}
        >
          <Text style={styles.newTranscriptionButtonText}>＋  New dictation</Text>
        </Pressable>
        <View style={styles.dictationSectionRow}>
          <Text style={styles.dictationSectionTitle}>Saved dictations</Text>
          <Text style={styles.dictationSectionCount}>{transcriptionFiles.length} {transcriptionFiles.length === 1 ? 'file' : 'files'}</Text>
        </View>
        {isLoadingTranscriptions && transcriptionFiles.length === 0 ? (
          <View style={styles.transcriptionsLoading}>
            <ActivityIndicator color="#176b5b" />
            <Text style={styles.transcriptionsSubtitle}>Loading Drive files…</Text>
          </View>
        ) : transcriptionsError ? (
          <View style={styles.transcriptionsEmpty}>
            <Text style={styles.transcriptionsError}>{transcriptionsError}</Text>
            <Pressable style={styles.transcriptionsRetry} onPress={() => loadTranscriptions().catch(() => undefined)}>
              <Text style={styles.transcriptionsRetryText}>Try again</Text>
            </Pressable>
          </View>
        ) : transcriptionFiles.length === 0 ? (
          <View style={styles.transcriptionsEmpty}>
            <Text style={styles.transcriptionsEmptyTitle}>No transcriptions yet</Text>
            <Text style={styles.transcriptionsSubtitle}>Create one to start dictating. Saved files will appear here.</Text>
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.transcriptionsList}>
            {transcriptionFiles.map((file) => (
              <Pressable
                key={file.id}
                accessibilityRole="button"
                onPress={() => openTranscription(file).catch(() => undefined)}
                style={styles.transcriptionFileRow}
              >
                <View style={styles.transcriptionFileIcon}><Text style={styles.transcriptionFileIconText}>▤</Text></View>
                <View style={styles.transcriptionFileDetails}>
                  <Text numberOfLines={1} style={styles.transcriptionFileName}>{file.name.replace(/\.txt$/i, '')}</Text>
                  <Text style={styles.transcriptionFileDate}>
                    {file.modifiedTime ? new Date(file.modifiedTime).toLocaleDateString() : 'Google Drive'}
                  </Text>
                </View>
                <Text style={styles.transcriptionFileChevron}>›</Text>
              </Pressable>
            ))}
          </ScrollView>
        )}
        {isLoadingTranscriptions && transcriptionFiles.length > 0 && (
          <View style={styles.transcriptionsRefreshing}><ActivityIndicator size="small" color="#176b5b" /></View>
        )}
        <Text style={styles.dictationDriveNote}>◇  Saved in Google Drive</Text>
        <Modal
          animationType="fade"
          transparent
          visible={showNewTranscription}
          onRequestClose={() => setShowNewTranscription(false)}
        >
          <View style={styles.transcriptionModalBackdrop}>
            <View style={styles.transcriptionModal}>
              <Text style={styles.transcriptionModalTitle}>New dictation</Text>
              <Text style={styles.transcriptionsSubtitle}>Who is this dictation for?</Text>
              <Text style={styles.transcriptionInputLabel}>First name</Text>
              <TextInput
                autoCapitalize="words"
                autoComplete="given-name"
                onChangeText={setNewTranscriptionFirstName}
                placeholder="First name"
                returnKeyType="next"
                style={styles.transcriptionNameInput}
                value={newTranscriptionFirstName}
              />
              <Text style={styles.transcriptionInputLabel}>Last name</Text>
              <TextInput
                autoCapitalize="words"
                autoComplete="family-name"
                onChangeText={setNewTranscriptionLastName}
                onSubmitEditing={beginNewTranscription}
                placeholder="Last name"
                returnKeyType="done"
                style={styles.transcriptionNameInput}
                value={newTranscriptionLastName}
              />
              {transcriptionFormError && <Text style={styles.transcriptionsError}>{transcriptionFormError}</Text>}
              <Text style={styles.transcriptionFilenamePreview}>
                File name: {`${newTranscriptionFirstName.trim()} ${newTranscriptionLastName.trim()}`.trim() || 'First Last'}.txt
              </Text>
              <View style={styles.transcriptionModalActions}>
                <Pressable onPress={() => setShowNewTranscription(false)} style={styles.transcriptionCancelButton}>
                  <Text style={styles.transcriptionCancelText}>Cancel</Text>
                </Pressable>
                <Pressable disabled={isSavingTranscription} onPress={() => beginNewTranscription().catch(() => undefined)} style={[styles.newTranscriptionButton, isSavingTranscription && styles.buttonDisabled]}>
                  {isSavingTranscription && <ActivityIndicator size="small" color="#ffffff" />}
                  <Text style={styles.newTranscriptionButtonText}>{isSavingTranscription ? 'Creating…' : 'Start dictation'}</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>
      </View>
    );
  }

  function renderSpeechToText() {
    const editAction = selectionAction(speechSelection);
    const hasEditAction = editAction !== 'append';
    const editLabel =
      editAction === 'insert' ? 'Insert at cursor' : 'Replace selected text';
    const wordCount = [speechTranscript.confirmed, speechTranscript.provisional]
      .join(' ')
      .trim()
      .split(/\s+/)
      .filter(Boolean).length;
    const isRecording =
      speechStatus === 'initializing' ||
      speechStatus === 'listening' ||
      speechStatus === 'finalizing' ||
      speechStatus === 'refining';
    const statusText = {
      idle: 'Ready to dictate',
      initializing: 'Preparing microphone',
      listening: 'Recording',
      finalizing: 'Finalizing transcript…',
      refining: 'Refining transcript…',
      'permission-denied': 'Microphone access required',
      'model-missing': 'Dictation unavailable',
      error: 'Recording interrupted',
    }[speechStatus];

    return (
      <View style={styles.speechPage}>
        <PerformanceReportModal
          visible={reportModal}
          token={sessionToken}
          onClose={() => setReportModal(false)}
        />
        <View style={styles.speechHeader}>
          <Pressable accessibilityRole="button" onPress={() => {
            stopSpeechToText().catch(() => undefined);
            setStep('transcriptions');
          }}><Text style={styles.workspaceBack}>‹  Files</Text></Pressable>
          <Text style={styles.workspaceBrand}>LMNOP</Text>
        </View>

        <View style={styles.speechStage}>
          <View style={styles.speechTopbar}>
            <View style={styles.speechTitleGroup}>
              <Text style={styles.speechTitle} numberOfLines={1}>
                {activeTranscriptionName || 'Clinical dictation'}
              </Text>
              <Text style={styles.speechSubtitle}>
                {transcriptionIsSaved ? 'Saved to Google Drive' : 'Draft · Not saved'}
              </Text>
              {appVersionLabel && (
                <Text style={styles.speechSubtitle}>{appVersionLabel}</Text>
              )}
            </View>
            {activeTranscriptionName && (
              <Pressable
                accessibilityRole="button"
                disabled={isSavingTranscription || speechRecordingRef.current || isRecording}
                onPress={() => saveActiveTranscription().catch(() => undefined)}
                style={[styles.transcriptionSaveButton, (isSavingTranscription || isRecording) && styles.buttonDisabled]}
              >
                {isSavingTranscription && <ActivityIndicator size="small" color="#ffffff" />}
                <Text style={styles.transcriptionSaveButtonText}>
                  {isSavingTranscription ? 'Saving…' : transcriptionIsSaved ? 'Save' : 'Save to Drive'}
                </Text>
              </Pressable>
            )}
          </View>
          {transcriptionSaveError && (
            <Text style={styles.transcriptionSaveError}>{transcriptionSaveError}</Text>
          )}
          <View style={styles.speechTranscriptToolbar}>
            <Text style={styles.speechSectionTitle}>Transcript</Text>
            <Text style={styles.speechWordCount}>
              {wordCount} {wordCount === 1 ? 'word' : 'words'}
            </Text>
            <Pressable
              accessibilityLabel="Clear transcript"
              accessibilityRole="button"
              disabled={
                isRecording || (wordCount === 0 && pendingReports === 0)
              }
              style={[
                styles.speechClearButton,
                (isRecording || (wordCount === 0 && pendingReports === 0)) &&
                  styles.buttonDisabled,
              ]}
              onPress={clearSpeechToText}
            >
              <Text style={styles.speechClearText}>Clear</Text>
            </Pressable>
          </View>

          <ScrollView
            ref={speechScrollRef}
            style={styles.speechWords}
            contentContainerStyle={styles.speechWordsContent}
            nestedScrollEnabled
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            onContentSizeChange={() =>
              speechScrollRef.current?.scrollToEnd({ animated: true })
            }
          >
            {!isRecording && !replacement ? (
              <SelectableTranscript
                dark
                pendingFrom={speechTranscript.pendingFrom}
                selection={speechSelection}
                text={speechTranscript.confirmed}
                onSelect={(selection) => {
                  if (!speechRecordingRef.current)
                    setSpeechSelection(selection);
                }}
              />
            ) : speechTranscript.confirmed || speechTranscript.provisional ? (
              <Text style={styles.speechWord}>
                {speechTranscript.pendingFrom !== undefined ? (
                  <>
                    {speechTranscript.confirmed.slice(
                      0,
                      speechTranscript.pendingFrom,
                    )}
                    <Text style={styles.speechProvisional}>
                      {speechTranscript.confirmed.slice(
                        speechTranscript.pendingFrom,
                      )}
                    </Text>
                  </>
                ) : (
                  speechTranscript.confirmed
                )}
                {speechTranscript.confirmed && speechTranscript.provisional
                  ? ' '
                  : ''}
                <Text style={styles.speechProvisional}>
                  {speechTranscript.provisional}
                </Text>
              </Text>
            ) : (
              <Text style={styles.speechPlaceholder}>No dictation yet.</Text>
            )}
          </ScrollView>

          {Platform.OS === 'android' && (
            <Text style={styles.refinementHelp}>
              Moonshine Medium shows live text as you speak.
              Stop replaces this recording with the selected final refinement.
            </Text>
          )}
          {(Platform.OS === 'ios' || Platform.OS === 'android') && (
            <View>
              <Text style={styles.refinementHeading}>
                Offline transcription
              </Text>
              <View style={styles.refinementOptions}>
                {(['parakeet'] as const).map((provider) => (
                  <Pressable
                    key={provider}
                    accessibilityRole="button"
                    accessibilityState={{
                      selected: refinementProvider === provider,
                      disabled:
                        isRecording ||
                        ['checking', 'starting', 'downloading', 'verifying'].includes(
                          offlineModel.phase,
                        ),
                    }}
                    disabled={
                      isRecording ||
                      ['checking', 'starting', 'downloading', 'verifying'].includes(
                        offlineModel.phase,
                      )
                    }
                    onPress={() => {
                      if (
                        provider === 'parakeet' &&
                        offlineModel.phase !== 'ready'
                      ) {
                        downloadOfflineModel().then(async () => {
                          if (await isOfflineModelReady())
                            setRefinementProvider('parakeet');
                        }).catch(() => undefined);
                      } else setRefinementProvider(provider);
                    }}
                    style={[
                      styles.refinementOption,
                      refinementProvider === provider &&
                        styles.refinementSelected,
                    ]}
                  >
                    {['starting', 'downloading', 'verifying'].includes(
                      offlineModel.phase,
                    ) && <ActivityIndicator size="small" />}
                    <Text style={styles.refinementOptionText}>
                      {offlineModel.phase === 'ready'
                        ? 'Omi Med STT · Offline'
                        : offlineModel.phase === 'downloading'
                        ? `Downloading ${Math.round(
                            offlineModel.progress * 100,
                          )}%`
                        : offlineModel.phase === 'verifying'
                        ? 'Verifying…'
                        : offlineModel.phase === 'checking'
                        ? 'Checking…'
                        : offlineModel.phase === 'starting'
                        ? 'Starting download…'
                        : offlineModel.phase === 'error'
                        ? 'Retry download'
                        : (offlineModel.downloadedBytes ?? 0) > 0
                        ? 'Resume download'
                        : 'Download'}
                    </Text>
                    <Text style={styles.refinementDescription}>
                      {offlineModel.phase === 'ready'
                        ? 'Whole recording refined on Stop'
                        : `${formatModelBytes(
                            offlineModel.downloadedBytes ?? 0,
                          )} / ${formatModelBytes(whisperModelBytes)}`}
                    </Text>
                    {offlineModel.phase !== 'ready' && (
                        <View
                          accessibilityRole="progressbar"
                          accessibilityLabel="Offline model download"
                          accessibilityValue={{
                            min: 0,
                            max: whisperModelBytes,
                            now: offlineModel.downloadedBytes ?? 0,
                          }}
                          style={styles.modelProgressTrack}
                        >
                          <View
                            style={[
                              styles.modelProgressFill,
                              {
                                width: `${Math.round(
                                  offlineModel.progress * 100,
                                )}%`,
                              },
                            ]}
                          />
                        </View>
                      )}
                  </Pressable>
                ))}
              </View>
              {offlineModel.error && (
                <Text accessibilityRole="alert" style={styles.speechError}>
                  {offlineModel.error}
                </Text>
              )}
              <Text style={styles.refinementHelp}>
                Final transcription uses the complete recording and stays on this device.
              </Text>
            </View>
          )}

          <Text style={styles.speechLocalLabel}>
            {'Transcription stays on this device · Up to 60 seconds per recording'}
          </Text>

          <View style={styles.speechRecordingArea}>
            <View style={styles.speechStatusRow}>
              <View style={styles.speechRecordingStatus}>
                {speechStatus === 'finalizing' ? (
                  <ActivityIndicator size="small" color="#176b5b" />
                ) : (
                  <RecordingIndicator
                    active={speechStatus === 'listening'}
                    level={speechAudioLevel}
                  />
                )}
                <Text
                  accessibilityLiveRegion="polite"
                  style={[styles.speechStatus, styles.speechStatusLabel]}
                >
                  {statusText}
                </Text>
              </View>
            </View>
            {isRecording &&
              speechStatus !== 'finalizing' &&
              !!speechActivity && (
                <Text
                  accessibilityLiveRegion="polite"
                  style={styles.speechStatus}
                >
                  {speechActivity}
                </Text>
              )}
            <RefinementTimer
              key={refinementProvider}
              active={
                speechStatus === 'finalizing' || speechStatus === 'refining'
              }
              reset={
                speechStatus === 'initializing' || speechStatus === 'listening'
              }
            />
            {pendingReports > 0 && !isRecording && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Share speech performance report"
                onPress={() => setReportModal(true)}
                style={styles.speechProfileButton}
              >
                <Text style={styles.speechLocalLabel}>
                  Share performance report
                </Text>
              </Pressable>
            )}
            {speechError && (
              <Text style={styles.speechError}>{speechError}</Text>
            )}
            <DictationControls
              recording={isRecording}
              cancelAvailable={
                refinementProvider === 'parakeet'
                  ? isRecording &&
                    ['initializing', 'listening'].includes(speechStatus)
                  : speechStatus === 'refining'
              }
              preparing={
                speechStatus === 'initializing' ||
                (!isLiveSpeechModelReady && !speechError)
              }
              showKeyboard={!!speechSelection && !isRecording}
              disabled={
                speechStatus === 'finalizing' ||
                speechStatus === 'refining' ||
                (!isLiveSpeechModelReady && !speechError) ||
                speechStatus === 'model-missing'
              }
              label={
                speechStatus === 'refining'
                  ? 'Refining transcript…'
                  : speechStatus === 'finalizing'
                  ? 'Finalizing transcript…'
                  : speechStatus === 'initializing'
                  ? 'Preparing microphone'
                  : !isLiveSpeechModelReady && !speechError
                  ? 'Preparing live speech model…'
                  : speechError && !isLiveSpeechModelReady
                  ? 'Retry speech model preparation'
                  : isRecording
                  ? 'Stop recording'
                  : hasEditAction
                  ? editLabel
                  : 'Start recording'
              }
              onKeyboard={() => {
                if (speechSelection)
                  setKeyboardSelection({ ...speechSelection });
              }}
              onCancel={() => {
                cancelSpeechToText().catch(() => undefined);
              }}
              cancelLabel={
                refinementProvider === 'parakeet' ? 'Cancel pending speech' : refinementCanStop ? 'Stop Refinement' : 'Cancel refinement'
              }
              onRecord={() => {
                if (
                  speechStatus === 'finalizing' ||
                  speechStatus === 'refining'
                )
                  return;
                Keyboard.dismiss();
                if (speechRecordingRef.current) {
                  stopSpeechToText().catch(() => undefined);
                } else if (speechSelection && hasEditAction) {
                  setReplacement(speechSelection);
                } else {
                  setSpeechSelection(null);
                  startSpeechToText().catch(() => undefined);
                }
              }}
            />
          </View>
        </View>
        {keyboardSelection && (
          <TranscriptEditor
            selection={keyboardSelection}
            onDone={(selection) => {
              const next = { confirmed: selection.source, provisional: '' };
              speechTranscriptRef.current = next;
              setSpeechTranscript(next);
              if (activeTranscriptionId) setTranscriptionIsSaved(false);
              setTranscriptionSaveError(null);
              speechSessionRef.current?.setText(selection.source);
              setSpeechSelection(selection);
              setKeyboardSelection(null);
            }}
          />
        )}
        {replacement && (
          <VoiceReplacement
            selection={replacement}
            waitForRelease={waitForSpeechRelease}
            refinement={{ provider: refinementProvider, pauseMs: dictationPauseMs }}
            onClose={(text) => {
              if (text !== null) {
                const next = { confirmed: text, provisional: '' };
                speechTranscriptRef.current = next;
                setSpeechTranscript(next);
                if (activeTranscriptionId) setTranscriptionIsSaved(false);
                setTranscriptionSaveError(null);
                setSpeechSelection({
                  source: text,
                  start: replacement.start,
                  end:
                    replacement.end + text.length - replacement.source.length,
                });
              }
              setReplacement(null);
            }}
          />
        )}
      </View>
    );
  }

  function renderDiagnostics() {
      return (
        <View style={styles.speechPage}>
          <View style={styles.speechHeader}>
            <Pressable accessibilityRole="button" onPress={() => setStep('settings')}>
              <Text style={styles.workspaceBack}>‹  Settings</Text>
            </Pressable>
            <Text style={styles.workspaceBrand}>LMNOP</Text>
          </View>
          <ScrollView contentContainerStyle={styles.diagnosticsContent}>
            <Text style={styles.diagnosticsTitle}>
              Offline speech refinement
            </Text>
            <View style={styles.diagnosticsCard}>
              <Text style={styles.diagnosticsLabel}>Omi Med STT v1 Q8 GGUF</Text>
              <Text style={styles.diagnosticsValue}>
                CPU · 4 threads · English
              </Text>
              <Text style={styles.diagnosticsDetail}>
                The model is downloaded for offline refinement and runs on the
                CPU. Model by Omi Health, derived from NVIDIA Parakeet TDT v2.
                Weights: CC BY 4.0. Runtime: MIT.
              </Text>
            </View>
            <Text style={styles.diagnosticsDescription}>
              {Platform.OS === 'ios' ? 'iOS' : 'Android'} · {appVersionLabel ?? 'App version unavailable'}
            </Text>
            <Pressable
              accessibilityRole="button"
              style={styles.diagnosticsButton}
              onPress={() => {
                setStep('settings');
              }}
            >
              <Text style={styles.diagnosticsButtonText}>
                Back to Settings
              </Text>
            </Pressable>
          </ScrollView>
        </View>
      );
  }

  function handleReviewScroll(event: {
    nativeEvent: {
      contentOffset: { y: number };
      contentSize: { height: number };
      layoutMeasurement: { height: number };
    };
  }) {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    const bottomThreshold = 24;
    const reachedBottom =
      contentOffset.y + layoutMeasurement.height >=
      contentSize.height - bottomThreshold;

    if (reachedBottom && !hasReachedReviewBottom) {
      setHasReachedReviewBottom(true);
    }
  }

  // Keep the deferred questionnaire path lint-clean while its render block is disabled.
  // eslint-disable-next-line no-void
  void canSubmit;
  // eslint-disable-next-line no-void
  void createDriveFolder;
  // eslint-disable-next-line no-void
  void driveFolderError;
  // eslint-disable-next-line no-void
  void isCreatingDriveFolder;
  // eslint-disable-next-line no-void
  void reviewAnswers;
  // eslint-disable-next-line no-void
  void selectAnswer;

  const incomingSectionWipeStyle = {
    transform: [
      {
        translateX: sectionWipe.interpolate({
          inputRange: [0, 1],
          outputRange: [sectionWipeDirection * viewportWidth, 0],
        }),
      },
    ],
  };
  const outgoingSectionWipeStyle = {
    transform: [
      {
        translateX: sectionWipe.interpolate({
          inputRange: [0, 1],
          outputRange: [0, -sectionWipeDirection * viewportWidth],
        }),
      },
    ],
  };
  const canSubmitReviewedIntake =
    hasReachedReviewBottom && !isSubmittingIntake && canReviewIntake;

  if (requiredUpdate) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={[styles.container, styles.updateRequiredScreen]}>
          <View style={styles.brandMark}>
            <Text style={styles.brandMarkText}>{appName.slice(0, 1)}</Text>
          </View>
          <Text style={styles.eyebrow}>{appName}</Text>
          <Text style={styles.title}>Update required</Text>
          <Text style={styles.copy}>{requiredUpdate.message}</Text>
          <Text style={styles.updateRequiredDetail}>
            Installed build {requiredUpdate.currentBuild}. Required build{' '}
            {requiredUpdate.requiredBuild}.
          </Text>
          <Pressable
            style={styles.primaryButton}
            onPress={() => {
              Linking.openURL(requiredUpdate.updateUrl).catch(() => undefined);
            }}
          >
            <Text style={styles.primaryButtonText}>Download latest build</Text>
          </Pressable>
          <Text style={styles.versionText}>
            v{requiredUpdate.currentVersionName} ({requiredUpdate.currentBuild})
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView
      style={[
        styles.safeArea,
        step !== 'sign-in' && !isRestoringSession && styles.darkSafeArea,
        step === 'speech-to-text' && styles.speechSafeArea,
      ]}
    >
      {!isRestoringSession && step !== 'sign-in' && (
        <StatusBar barStyle="light-content" />
      )}
      <Modal
        animationType="fade"
        transparent
        statusBarTranslucent
        visible={
          step === 'speech-to-text' &&
          (dictationModelsPreparing || !!dictationModelsError)
        }
        onRequestClose={() => undefined}
      >
        <View
          accessibilityViewIsModal
          style={{
            alignItems: 'center',
            backgroundColor: 'rgba(12, 27, 23, 0.62)',
            flex: 1,
            justifyContent: 'center',
            padding: 24,
          }}
        >
          <View
            style={{
              alignItems: 'center',
              backgroundColor: '#ffffff',
              borderRadius: 16,
              gap: 14,
              maxWidth: 420,
              padding: 26,
              width: '100%',
            }}
          >
            {dictationModelsPreparing && (
              <ActivityIndicator size="large" color="#176b5b" />
            )}
            <Text style={{ color: '#203332', fontSize: 19, fontWeight: '700', textAlign: 'center' }}>
              {dictationModelsError ? 'Moonshine Medium needs attention' : 'Preparing dictation'}
            </Text>
            <Text style={{ color: '#526563', fontSize: 14, lineHeight: 21, textAlign: 'center' }}>
              {dictationModelsError
                ? dictationModelsError
                : dictationPreparationStep || 'Loading speech model…'}
            </Text>
            {!!dictationModelsError && (
              <Pressable
                accessibilityRole="button"
                disabled={dictationModelsPreparing}
                onPress={() => retryDictationModelLoad().catch(() => undefined)}
                style={{ backgroundColor: '#176b5b', borderRadius: 8, marginTop: 4, minHeight: 48, justifyContent: 'center', paddingHorizontal: 20 }}
              >
                <Text style={{ color: '#ffffff', fontSize: 14, fontWeight: '700', textAlign: 'center' }}>
                  Retry loading Moonshine Medium
                </Text>
              </Pressable>
            )}
          </View>
        </View>
      </Modal>
      <KeyboardAvoidingView
        style={styles.keyboardContainer}
        enabled={step === 'speech-to-text'}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {!isRestoringSession &&
          step === 'intake-section' &&
          selectedIntakeSection &&
          renderIntakeTopNav({
            label: 'Close',
            onPress: closeIntakeSection,
          })}

        {!isRestoringSession &&
          step === 'review' &&
          renderIntakeTopNav({
            label: 'Close',
            onPress: () => {
              setStep('dashboard');
            },
          })}

        {!isRestoringSession && step === 'home' ? (
          <HomeScreen onSelect={destination => {
            if (destination === 'dictation') {
              setStep('transcriptions');
              loadTranscriptions().catch(() => undefined);
            } else if (destination === 'intake') {
              setStep('dashboard');
            } else {
              setStep(destination);
            }
          }} />
        ) : !isRestoringSession && step === 'settings' ? (
          <SettingsScreen
            email={userEmail}
            onBack={() => setStep('home')}
            onOpenProfile={() => setStep('prescription-profile')}
            onOpenDiagnostics={() => setStep('diagnostics')}
          />
        ) : !isRestoringSession && step === 'prescription-profile' ? (
          <PrescriptionScreen email={userEmail} initialPage="profile" onExit={() => setStep('settings')} />
        ) : !isRestoringSession && step === 'speech-to-text' && activeTranscriptionId ? (
          renderSpeechToText()
        ) : !isRestoringSession && step === 'speech-to-text' ? (
          renderTranscriptions()
        ) : !isRestoringSession && step === 'transcriptions' ? (
          renderTranscriptions()
        ) : !isRestoringSession && step === 'diagnostics' ? (
          renderDiagnostics()
        ) : !isRestoringSession && step === 'prescription' ? (
          <PrescriptionScreen email={userEmail} onExit={() => setStep('home')} />
        ) : (
          <ScrollView
            style={styles.scrollView}
            contentContainerStyle={styles.container}
            onScroll={step === 'review' ? handleReviewScroll : undefined}
            scrollEventThrottle={16}
          >
            {isRestoringSession && (
              <View style={styles.hero}>
                <ActivityIndicator color="#176b5b" />
                <Text style={styles.statusText}>
                  Checking Google sign-in...
                </Text>
              </View>
            )}

            {!isRestoringSession && step === 'sign-in' && (
              <View style={styles.hero}>
                <View style={styles.brandMark}>
                  <Text style={styles.brandMarkText}>
                    {appName.slice(0, 1)}
                  </Text>
                </View>
                <Text style={styles.eyebrow}>{appName}</Text>
                <Text style={styles.title}>
                  Your health documents, ready when you are.
                </Text>
                <Text style={styles.copy}>
                  Keep lab results, prescriptions, receipts, and visit notes
                  organized in a Google Drive folder you control.
                </Text>

                <Pressable
                  style={[
                    styles.primaryButton,
                    isSigningIn && styles.buttonDisabled,
                  ]}
                  disabled={isSigningIn}
                  onPress={signInWithBrowser}
                >
                  <Text style={styles.googleIcon}>G</Text>
                  <Text style={styles.primaryButtonText}>
                    Continue with Google
                  </Text>
                </Pressable>

                {isSigningIn && (
                  <View style={styles.statusRow}>
                    <ActivityIndicator color="#176b5b" />
                    <Text style={styles.statusText}>
                      Opening Google sign-in...
                    </Text>
                  </View>
                )}

                {signInError && (
                  <Text style={styles.errorText}>{signInError}</Text>
                )}

                {appVersionLabel && (
                  <Text style={styles.versionText}>{appVersionLabel}</Text>
                )}
              </View>
            )}

            {!isRestoringSession && step === 'dashboard' && (
              <View style={styles.intakeOverview}>
                <View style={styles.workspaceTopbar}>
                  <Pressable accessibilityRole="button" onPress={() => setStep('home')}>
                    <Text style={styles.workspaceBack}>‹  Home</Text>
                  </Pressable>
                  <Text style={styles.workspaceBrand}>LMNOP</Text>
                </View>
                <Text style={styles.intakeOverviewTitle}>User Intake</Text>
                <Text style={styles.intakeOverviewSubtitle}>Keep important details ready for a visit.</Text>
                <View style={styles.intakeProgressCard}>
                  <Text style={styles.intakeProgressKicker}>YOUR PROGRESS</Text>
                  <Text style={styles.intakeProgressValue}>
                    {completedIntakeSectionCount} of {intakeSections.length} sections complete
                  </Text>
                  <View style={styles.intakeProgressTrack}>
                    <View style={[styles.intakeProgressFill, {
                      width: `${Math.round(completedIntakeSectionCount / intakeSections.length * 100)}%`,
                    }]} />
                  </View>
                </View>
                <View style={styles.intakeListHeading}>
                  <Text style={styles.intakeListTitle}>Sections</Text>
                  <Text style={styles.intakeListHint}>Scroll for all 11</Text>
                </View>
                <View style={styles.intakeRows}>
                  {intakeSections.map(section => {
                    const complete = isIntakeSectionComplete(section, intakeAnswers);
                    return (
                      <Pressable
                        key={section.key}
                        accessibilityRole="button"
                        onPress={() => openIntakeSection(section)}
                        style={styles.intakeRow}
                      >
                        <View style={styles.intakeRowIcon}>
                          <Text style={styles.intakeRowIconText}>{sectionIconGlyph(section.icon)}</Text>
                        </View>
                        <View style={styles.intakeRowBody}>
                          <Text style={styles.intakeRowTitle}>{section.title}</Text>
                          <Text style={[styles.intakeRowMeta, complete && styles.intakeRowComplete]}>
                            {section.number} · {complete ? 'Complete' : section.number === 1 ? 'Required' : 'Optional'}
                          </Text>
                        </View>
                        <Text style={styles.intakeRowChevron}>›</Text>
                      </Pressable>
                    );
                  })}
                </View>
                <Pressable
                  disabled={!canReviewIntake}
                  style={[styles.intakeReviewButton, !canReviewIntake && styles.intakeReviewDisabled]}
                  onPress={openIntakeReview}
                >
                  <Text style={[styles.intakeReviewButtonText, !canReviewIntake && styles.intakeReviewDisabledText]}>Review intake</Text>
                </Pressable>
                <Text style={styles.intakeReviewHint}>
                  {canReviewIntake ? 'The required personal section is complete.' : 'Complete personal information to review.'}
                </Text>
                {intakeSubmitError && <Text style={styles.errorText}>{intakeSubmitError}</Text>}
              </View>
            )}

            {!isRestoringSession &&
              step === 'intake-section' &&
              selectedIntakeSection && (
                <View style={styles.intakePage}>
                  {renderIntakePageHeader({
                    count: `${selectedIntakeSection.number} of ${intakeSections.length}`,
                    progress:
                      selectedIntakeSection.number / intakeSections.length,
                    subtitle:
                      'Review the information expected for this part of your intake.',
                    title: selectedIntakeSection.title,
                    variant: 'section',
                  })}

                  <View style={styles.intakePageBody}>
                    <View style={styles.sectionWipeFrame}>
                      {outgoingIntakeSection && (
                        <Animated.View
                          pointerEvents="none"
                          style={[
                            styles.form,
                            styles.sectionWipePane,
                            outgoingSectionWipeStyle,
                          ]}
                        >
                          {renderIntakeSectionForm(outgoingIntakeSection)}
                        </Animated.View>
                      )}
                      <Animated.View
                        style={[
                          styles.form,
                          outgoingIntakeSection && incomingSectionWipeStyle,
                        ]}
                      >
                        {renderIntakeSectionForm(selectedIntakeSection)}
                      </Animated.View>
                    </View>
                  </View>
                </View>
              )}

            {!isRestoringSession && step === 'review' && (
              <View style={styles.intakePage}>
                {renderIntakePageHeader({
                  count: `${completedIntakeSectionCount} of 11 Sections Completed`,
                  progress: completedIntakeSectionCount / 11,
                  subtitle:
                    'Check the intake data before saving it to your Google Drive folder.',
                  title: 'Review & Submit',
                })}

                <View
                  style={[
                    styles.intakePageBody,
                    styles.form,
                    styles.reviewPageBody,
                  ]}
                >
                  {intakeSections.map((section) => (
                    <View key={section.key} style={styles.reviewSection}>
                      <Text style={styles.reviewSectionTitle}>
                        {section.number}. {section.title}
                      </Text>
                      {section.fields.map((field, fieldIndex) => {
                        const value =
                          intakeAnswers[
                            intakeAnswerKey(section, fieldIndex)
                          ]?.trim();

                        return (
                          <View key={field} style={styles.reviewField}>
                            <Text style={styles.reviewLabel}>{field}</Text>
                            <Text
                              style={[
                                styles.reviewValue,
                                !value && styles.reviewValueEmpty,
                              ]}
                            >
                              {value || 'Not provided'}
                            </Text>
                          </View>
                        );
                      })}
                    </View>
                  ))}

                  {intakeSubmitError && (
                    <Text style={styles.errorText}>{intakeSubmitError}</Text>
                  )}
                </View>
              </View>
            )}

            {/* The initial setup questionnaire is intentionally disabled while the
            post-auth experience is the reqs.md intake dashboard.
        {!isRestoringSession && step === 'questionnaire' && (
          <View style={styles.form}>
            <Text style={styles.eyebrow}>Setup</Text>
            <Text style={styles.heading}>A few details first.</Text>
            <Text style={styles.copy}>
              These answers shape the manifest and the first doctor-facing report.
            </Text>

            {userEmail && (
              <View style={styles.accountBanner}>
                <Text style={styles.accountLabel}>Signed in with Google</Text>
                <Text style={styles.accountEmail}>{userEmail}</Text>
              </View>
            )}

            {questions.map(question => (
              <View key={question.key} style={styles.question}>
                <Text style={styles.questionText}>{question.prompt}</Text>
                <View style={styles.optionGrid}>
                  {question.options.map(option => {
                    const selected = answers[question.key] === option;

                    return (
                      <Pressable
                        key={option}
                        style={[styles.option, selected && styles.optionSelected]}
                        onPress={() => {
                          selectAnswer(question.key, option).catch(() => undefined);
                        }}>
                        <View style={[styles.radio, selected && styles.radioSelected]} />
                        <Text style={[styles.optionText, selected && styles.optionTextSelected]}>
                          {option}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            ))}

            <Pressable
              disabled={!canSubmit || isCreatingDriveFolder}
              style={[
                styles.primaryButton,
                (!canSubmit || isCreatingDriveFolder) && styles.buttonDisabled,
              ]}
              onPress={createDriveFolder}>
              {isCreatingDriveFolder && <ActivityIndicator color="#ffffff" />}
              <Text style={styles.primaryButtonText}>
                {localCsvPath ? 'Update answers' : 'Create my Drive folder'}
              </Text>
            </Pressable>

            {driveFolderError && <Text style={styles.errorText}>{driveFolderError}</Text>}
          </View>
        )}
        */}

            {!isRestoringSession && step === 'ready' && (
              <View style={styles.intakeSaved}>
                <View style={styles.intakeSavedMark}>
                  <Text style={styles.intakeSavedCheck}>✓</Text>
                </View>
                <Text style={styles.intakeSavedTitle}>Intake saved.</Text>
                <Text style={styles.intakeSavedCopy}>
                  Your Google Drive folder is ready and the intake submission
                  has been saved.
                </Text>
                {driveFolder && (
                  <View style={styles.intakeSavedReceipt}>
                    <Text style={styles.intakeSavedLabel}>Location</Text>
                    <Text style={styles.intakeSavedValue}>
                      {driveFolder.driveFolderName}
                    </Text>
                    <Text style={styles.intakeSavedLabel}>Saved record</Text>
                    <Text style={styles.intakeSavedValue}>
                      {driveFolder.intakeSubmissionJsonName ??
                        driveFolder.questionnaireCsvName}
                    </Text>
                  </View>
                )}
                <Pressable
                  style={styles.intakeReviewButton}
                  onPress={() => {
                    setStep('dashboard');
                  }}
                >
                  <Text style={styles.intakeReviewButtonText}>
                    Back to Intake
                  </Text>
                </Pressable>
              </View>
            )}
          </ScrollView>
        )}

        {!isRestoringSession &&
          step === 'intake-section' &&
          selectedIntakeSection && (
            <View style={styles.sectionBottomBar}>
              <Pressable
                disabled={selectedIntakeSectionIndex <= 0}
                style={[
                  styles.bottomNavButton,
                  styles.bottomNavButtonSecondary,
                  selectedIntakeSectionIndex <= 0 && styles.buttonDisabled,
                ]}
                onPress={goToPreviousIntakeSection}
              >
                <Text style={styles.bottomNavButtonSecondaryText}>Back</Text>
              </Pressable>
              <View style={styles.bottomNavProgress}>
                <Text style={styles.bottomNavProgressText}>
                  {selectedIntakeSection.number} / {intakeSections.length}
                </Text>
                <View style={styles.bottomNavProgressTrack}>
                  <View
                    style={[
                      styles.bottomNavProgressFill,
                      {
                        width: `${
                          (selectedIntakeSection.number /
                            intakeSections.length) *
                          100
                        }%`,
                      },
                    ]}
                  />
                </View>
              </View>
              <Pressable
                disabled={
                  selectedIntakeSectionIndex >= intakeSections.length - 1 &&
                  !canReviewIntake
                }
                style={[
                  styles.bottomNavButton,
                  styles.bottomNavButtonPrimary,
                  selectedIntakeSectionIndex >= intakeSections.length - 1 &&
                    !canReviewIntake &&
                    styles.buttonDisabled,
                ]}
                onPress={goToNextIntakeSection}
              >
                <Text style={styles.bottomNavButtonPrimaryText}>
                  {selectedIntakeSectionIndex >= intakeSections.length - 1
                    ? 'Review'
                    : 'Next'}
                </Text>
              </Pressable>
            </View>
          )}

        {!isRestoringSession && step === 'review' && (
          <View style={styles.reviewSubmitBar}>
            <Pressable
              disabled={!canSubmitReviewedIntake}
              style={[
                styles.reviewStickySubmitButton,
                canSubmitReviewedIntake && styles.reviewStickySubmitButtonReady,
                !canSubmitReviewedIntake && styles.buttonDisabled,
              ]}
              onPress={() => {
                submitIntake().catch(() => undefined);
              }}
            >
              {isSubmittingIntake && <ActivityIndicator color="#ffffff" />}
              <Text style={styles.reviewStickySubmitText}>
                Submit to Google Drive
              </Text>
            </Pressable>
          </View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

async function saveSessionToken(sessionToken: string) {
  await AsyncStorage.setItem(sessionTokenStorageKey, sessionToken);
}

async function verifySessionToken(
  token: string,
): Promise<SessionCheckResponse | null> {
  const response = await fetch(mobileSessionUrl, {
    headers: {
      authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    return null;
  }

  const checkedSession = (await response.json()) as SessionCheckResponse;

  return checkedSession.status === 'ok' ? checkedSession : null;
}

async function reportAuthCallbackDebug(url: string, callback: AuthCallback) {
  await fetch(mobileAuthCallbackDebugUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      parsedTokenEndsWithHash: callback.sessionToken?.endsWith('#'),
      parsedTokenLength: callback.sessionToken?.length,
      rawUrlEndsWithHash: url.endsWith('#'),
      rawUrlHasFragment: url.includes('#'),
      rawUrlLength: url.length,
    }),
  });
}

export function parseAuthCallback(url: string): AuthCallback | null {
  let callbackUrl: URL;

  try {
    callbackUrl = new URL(url);
  } catch {
    return null;
  }

  if (callbackUrl.protocol !== 'lmnop:') {
    return null;
  }

  if (!callbackUrl.searchParams.has('status')) {
    return null;
  }

  return {
    email: callbackUrl.searchParams.get('email'),
    sessionToken: callbackUrl.searchParams.get('session_token'),
    status: callbackUrl.searchParams.get('status'),
  };
}

function buildQuestionnaireCsv(answers: Record<string, string>): string {
  return [
    ['question_key', 'question', 'answer'],
    ...questions.map((question) => [
      question.key,
      question.prompt,
      answers[question.key] ?? '',
    ]),
  ]
    .map((row) => row.map(escapeCsvCell).join(','))
    .join('\n')
    .concat('\n');
}

function parseQuestionnaireCsv(csvContent: string): Record<string, string> {
  const rows = parseCsvRows(csvContent);
  const nextAnswers: Record<string, string> = {};

  rows.slice(1).forEach((row) => {
    const [questionKey, , answer] = row;

    if (questionKey && answer) {
      nextAnswers[questionKey] = answer;
    }
  });

  return nextAnswers;
}

function parseCsvRows(csvContent: string): string[][] {
  const rows: string[][] = [];
  let cell = '';
  let row: string[] = [];
  let isQuoted = false;

  for (let index = 0; index < csvContent.length; index += 1) {
    const char = csvContent[index];
    const nextChar = csvContent[index + 1];

    if (char === '"' && isQuoted && nextChar === '"') {
      cell += '"';
      index += 1;
    } else if (char === '"') {
      isQuoted = !isQuoted;
    } else if (char === ',' && !isQuoted) {
      row.push(cell);
      cell = '';
    } else if ((char === '\n' || char === '\r') && !isQuoted) {
      if (char === '\r' && nextChar === '\n') {
        index += 1;
      }

      row.push(cell);
      if (row.some((value) => value.length > 0)) {
        rows.push(row);
      }
      row = [];
      cell = '';
    } else {
      cell += char;
    }
  }

  row.push(cell);
  if (row.some((value) => value.length > 0)) {
    rows.push(row);
  }

  return rows;
}

function escapeCsvCell(value: string): string {
  if (!/[",\n\r]/.test(value)) {
    return value;
  }

  return `"${value.replace(/"/g, '""')}"`;
}

function areAnswersComplete(answers: Record<string, string>): boolean {
  return questions.every((question) => answers[question.key]);
}

function intakeAnswerKey(section: IntakeSection, fieldIndex: number): string {
  return `${section.key}.${fieldIndex}`;
}

function isIntakeSectionComplete(
  section: IntakeSection,
  answers: Record<string, string>,
): boolean {
  return section.fields.every((_, fieldIndex) =>
    Boolean(answers[intakeAnswerKey(section, fieldIndex)]?.trim()),
  );
}

function buildIntakeSubmissionSections(answers: Record<string, string>) {
  return intakeSections.map((section) => ({
    fields: section.fields.map((field, fieldIndex) => ({
      label: field,
      value: answers[intakeAnswerKey(section, fieldIndex)]?.trim() ?? '',
    })),
    key: section.key,
    number: section.number,
    title: section.title,
  }));
}

function sectionIconGlyph(icon: string): string {
  const glyphs: Record<string, string> = {
    alert: '!',
    clipboard: '✓',
    family: '⌘',
    folder: '▰',
    group: '•••',
    legal: '§',
    meds: '▣',
    pain: '!',
    person: '●',
    phone: '☎',
    shield: '◖',
  };

  return glyphs[icon] ?? '•';
}

const styles = StyleSheet.create({
  modelProgressTrack: {
    height: 6,
    backgroundColor: '#dce5df',
    borderRadius: 3,
    overflow: 'hidden',
    marginTop: 8,
    alignSelf: 'stretch',
  },
  modelProgressFill: { height: 6, backgroundColor: '#198754' },
  refinementHeading: { color: '#344a48', fontSize: 14, fontWeight: '600' },
  refinementDescription: {
    textAlign: 'center',
    color: '#526563',
    fontSize: 12,
    marginTop: 4,
  },
  refinementHelp: {
    color: '#526563',
    fontSize: 12,
    lineHeight: 17,
    marginBottom: 8,
  },
  refinementOptions: { flexDirection: 'row', gap: 8, paddingVertical: 8 },
  refinementOption: {
    flex: 1,
    padding: 12,
    borderRadius: 6,
    backgroundColor: '#eef1f0',
  },
  refinementSelected: { backgroundColor: '#d9f2df' },
  refinementOptionText: {
    textAlign: 'center',
    color: '#176b5b',
    fontWeight: '600',
  },
  keyboardContainer: { flex: 1 },
  speechReplaceButton: { backgroundColor: '#245aa6' },
  speechStopButton: { backgroundColor: '#a3313c' },
  safeArea: {
    flex: 1,
    backgroundColor: '#f4efec',
  },
  darkSafeArea: {
    backgroundColor: '#101c1a',
  },
  container: {
    flexGrow: 1,
    paddingHorizontal: 14,
    paddingVertical: 16,
  },
  scrollView: {
    flex: 1,
  },
  hero: {
    flex: 1,
    justifyContent: 'center',
    minHeight: 700,
    position: 'relative',
  },
  updateRequiredScreen: {
    flex: 1,
    justifyContent: 'center',
    minHeight: 700,
    position: 'relative',
  },
  brandMark: {
    alignItems: 'center',
    alignSelf: 'center',
    backgroundColor: '#176b5b',
    borderRadius: 28,
    height: 64,
    justifyContent: 'center',
    marginBottom: 28,
    width: 64,
  },
  brandMarkText: {
    color: '#ffffff',
    fontSize: 30,
    fontWeight: '800',
  },
  eyebrow: {
    color: '#bb5a3a',
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0,
    marginBottom: 10,
    textAlign: 'center',
    textTransform: 'uppercase',
  },
  title: {
    color: '#1c2420',
    fontSize: 42,
    fontWeight: '800',
    letterSpacing: 0,
    lineHeight: 46,
    marginBottom: 16,
    textAlign: 'center',
  },
  heading: {
    color: '#1c2420',
    fontSize: 34,
    fontWeight: '800',
    letterSpacing: 0,
    lineHeight: 38,
    marginBottom: 12,
  },
  copy: {
    color: '#5d6a62',
    fontSize: 17,
    lineHeight: 25,
    marginBottom: 28,
    textAlign: 'center',
  },
  googleIcon: {
    color: '#ffffff',
    fontSize: 20,
    fontWeight: '800',
  },
  statusRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'center',
    marginTop: 16,
  },
  statusText: {
    color: '#5d6a62',
    fontSize: 15,
  },
  errorText: {
    color: '#9a3412',
    fontSize: 15,
    lineHeight: 21,
    marginTop: 18,
    textAlign: 'center',
  },
  updateRequiredDetail: {
    color: '#5d6a62',
    fontSize: 15,
    fontWeight: '700',
    lineHeight: 21,
    marginBottom: 20,
    textAlign: 'center',
  },
  versionText: {
    bottom: 4,
    color: '#8c978f',
    fontSize: 12,
    fontWeight: '700',
    left: 0,
    position: 'absolute',
    right: 0,
    textAlign: 'center',
  },
  secondaryButton: {
    alignItems: 'center',
    alignSelf: 'stretch',
    borderColor: '#176b5b',
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: 'center',
    marginTop: 14,
    minHeight: 50,
    paddingHorizontal: 18,
  },
  secondaryButtonText: {
    color: '#176b5b',
    fontSize: 16,
    fontWeight: '800',
  },
  form: {
    gap: 18,
    paddingBottom: 28,
  },
  sectionWipeFrame: {
    overflow: 'hidden',
  },
  sectionWipePane: {
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
    zIndex: 1,
  },
  dashboard: {
    gap: 10,
    marginHorizontal: -14,
    marginTop: -16,
    paddingBottom: 18,
  },
  intakeOverview: { marginHorizontal: 6, paddingTop: 0, paddingBottom: 22 },
  intakeOverviewTitle: { color: '#eef8f3', fontSize: 32, fontWeight: '800', letterSpacing: -1.2, marginTop: 4 },
  intakeOverviewSubtitle: { color: '#a7bbb4', fontSize: 14, lineHeight: 21, marginTop: 6 },
  intakeProgressCard: { backgroundColor: '#226a5c', borderRadius: 20, marginTop: 22, padding: 18 },
  intakeProgressKicker: { color: '#d2efe5', fontSize: 11, fontWeight: '800', letterSpacing: 0.8 },
  intakeProgressValue: { color: '#ffffff', fontSize: 22, fontWeight: '800', letterSpacing: -0.5, marginTop: 5 },
  intakeProgressTrack: { backgroundColor: '#619d8b', borderRadius: 5, height: 5, marginTop: 15, overflow: 'hidden' },
  intakeProgressFill: { backgroundColor: '#c6efdb', borderRadius: 5, height: 5 },
  intakeListHeading: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginTop: 24, marginBottom: 11 },
  intakeListTitle: { color: '#eef8f3', fontSize: 15, fontWeight: '800' },
  intakeListHint: { color: '#a7bbb4', fontSize: 11 },
  intakeRows: { gap: 8 },
  intakeRow: { alignItems: 'center', backgroundColor: '#1b2b28', borderColor: '#34483f', borderRadius: 16, borderWidth: 1, flexDirection: 'row', gap: 12, minHeight: 76, paddingHorizontal: 12, paddingVertical: 11 },
  intakeRowIcon: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#27483c', borderRadius: 12, height: 41, width: 41 },
  intakeRowIconText: { color: '#66c9ad', fontSize: 22, fontWeight: '700' },
  intakeRowBody: { flex: 1 },
  intakeRowTitle: { color: '#eef8f3', fontSize: 14, fontWeight: '700' },
  intakeRowMeta: { color: '#a7bbb4', fontSize: 11, marginTop: 4 },
  intakeRowComplete: { color: '#66c9ad', fontWeight: '700' },
  intakeRowChevron: { color: '#a7bbb4', fontSize: 24 },
  intakeReviewButton: { alignItems: 'center', backgroundColor: '#125e52', borderRadius: 15, justifyContent: 'center', minHeight: 52, marginTop: 17 },
  intakeReviewDisabled: { backgroundColor: '#27483c' },
  intakeReviewButtonText: { color: '#ffffff', fontSize: 14, fontWeight: '800' },
  intakeReviewDisabledText: { color: '#a7bbb4' },
  intakeReviewHint: { color: '#a7bbb4', fontSize: 11, textAlign: 'center', marginTop: 8 },
  intakeSaved: { paddingHorizontal: 6, paddingTop: 71, gap: 0 },
  intakeSavedMark: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#27483c', borderRadius: 21, height: 66, width: 66 },
  intakeSavedCheck: { color: '#66c9ad', fontSize: 34, fontWeight: '700' },
  intakeSavedTitle: { color: '#eef8f3', fontSize: 32, fontWeight: '800', letterSpacing: -1.2, marginTop: 24 },
  intakeSavedCopy: { color: '#a7bbb4', fontSize: 14, lineHeight: 22, marginTop: 9 },
  intakeSavedReceipt: { backgroundColor: '#1b2b28', borderColor: '#34483f', borderRadius: 17, borderWidth: 1, marginTop: 30, padding: 17 },
  intakeSavedLabel: { color: '#a7bbb4', fontSize: 11 },
  intakeSavedValue: { color: '#eef8f3', fontSize: 13, fontWeight: '700', marginTop: 4, marginBottom: 15 },
  intakePage: {
    gap: 0,
    marginHorizontal: -14,
    marginTop: -16,
    paddingBottom: 18,
  },
  intakePageBody: {
    backgroundColor: '#101c1a',
    paddingHorizontal: 14,
    paddingTop: 10,
  },
  reviewPageBody: {
    paddingBottom: 90,
  },
  intakeAppBar: {
    alignItems: 'center',
    backgroundColor: '#101c1a',
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 58,
    paddingHorizontal: 20,
    shadowColor: '#1c2420',
    shadowOffset: {
      height: 2,
      width: 0,
    },
    shadowOpacity: 0.16,
    shadowRadius: 4,
  },
  intakeAppIdentity: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    gap: 10,
  },
  intakeAppIcon: {
    alignItems: 'center',
    backgroundColor: '#f7f8f5',
    borderRadius: 2,
    height: 42,
    justifyContent: 'center',
    width: 42,
  },
  intakeAppIconImage: {
    borderRadius: 2,
    height: 36,
    width: 36,
  },
  intakeAppTitle: {
    color: '#ffffff',
    fontSize: 20,
    fontWeight: '700',
    lineHeight: 24,
  },
  intakeAppSubtitle: {
    color: '#c8efec',
    fontSize: 10,
    fontWeight: '700',
    lineHeight: 13,
  },
  intakeAppMenu: {
    color: '#ffffff',
    fontSize: 28,
    fontWeight: '900',
  },
  intakeAppAction: {
    alignItems: 'center',
    borderColor: '#bde8e4',
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 36,
    paddingHorizontal: 14,
  },
  intakeAppActionText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '900',
  },
  intakeSummary: {
    backgroundColor: '#101c1a',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  intakeSectionSummary: {
    backgroundColor: '#101c1a',
    gap: 5,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 8,
  },
  intakeSummaryRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'space-between',
  },
  intakeSummaryTextGroup: {
    flex: 1,
    gap: 3,
  },
  intakeSummaryTitle: {
    color: '#eef8f3',
    fontSize: 29,
    fontWeight: '900',
    lineHeight: 25,
  },
  intakeSectionSummaryTitle: {
    color: '#eef8f3',
    fontSize: 27,
    lineHeight: 27,
  },
  intakeSummarySubtitle: {
    color: '#a7bbb4',
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 16,
  },
  intakeSectionSummarySubtitle: {
    color: '#a7bbb4',
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 15,
  },
  intakeSummaryCount: {
    color: '#66c9ad',
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'right',
  },
  accountBanner: {
    backgroundColor: '#e7f3ef',
    borderColor: '#b7d3ca',
    borderRadius: 8,
    borderWidth: 1,
    padding: 14,
  },
  accountLabel: {
    color: '#176b5b',
    fontSize: 13,
    fontWeight: '800',
    marginBottom: 4,
    textTransform: 'uppercase',
  },
  accountEmail: {
    color: '#1c2420',
    fontSize: 16,
    fontWeight: '700',
  },
  question: {
    backgroundColor: '#ffffff',
    borderColor: '#d8ded5',
    borderRadius: 8,
    borderWidth: 1,
    padding: 18,
  },
  progressHeader: {
    gap: 10,
  },
  progressLabel: {
    color: '#1c2420',
    fontSize: 15,
    fontWeight: '800',
    textAlign: 'right',
  },
  progressTrack: {
    backgroundColor: '#34483f',
    borderRadius: 2,
    height: 4,
    overflow: 'hidden',
  },
  progressFill: {
    backgroundColor: '#66c9ad',
    height: 4,
    width: '0%',
  },
  sectionGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: 10,
  },
  sectionTile: {
    alignItems: 'flex-start',
    backgroundColor: '#ffffff',
    borderColor: '#d8ded5',
    borderRadius: 8,
    borderWidth: 1,
    elevation: 1,
    flexBasis: '48%',
    flexGrow: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
    minHeight: 84,
    paddingHorizontal: 8,
    paddingVertical: 8,
    shadowColor: '#1c2420',
    shadowOffset: {
      height: 1,
      width: 0,
    },
    shadowOpacity: 0.08,
    shadowRadius: 3,
  },
  sectionTileComplete: {
    backgroundColor: '#e7f3ef',
    borderColor: '#b7d3ca',
  },
  sectionIcon: {
    alignItems: 'center',
    backgroundColor: '#eef7f4',
    borderRadius: 8,
    height: 38,
    justifyContent: 'center',
    width: 38,
  },
  sectionIconText: {
    color: '#176b5b',
    fontSize: 21,
    fontWeight: '900',
  },
  sectionTitle: {
    color: '#1c2420',
    fontSize: 12,
    fontWeight: '800',
    flex: 1,
    lineHeight: 14,
  },
  sectionCheck: {
    alignItems: 'center',
    backgroundColor: '#c7cec8',
    borderRadius: 9,
    height: 18,
    justifyContent: 'center',
    width: 18,
  },
  sectionCheckComplete: {
    backgroundColor: '#15965f',
  },
  sectionCheckText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '900',
    lineHeight: 15,
  },
  sectionPreview: {
    gap: 4,
    width: '100%',
  },
  sectionPreviewLine: {
    gap: 2,
  },
  sectionPreviewLabel: {
    color: '#4d5953',
    fontSize: 7,
    fontWeight: '800',
  },
  sectionPreviewInput: {
    backgroundColor: '#f7f5f7',
    borderColor: '#d4d8d2',
    borderRadius: 2,
    borderWidth: 1,
    minHeight: 18,
    justifyContent: 'center',
    paddingHorizontal: 5,
  },
  sectionPreviewText: {
    color: '#4d5953',
    fontSize: 8,
    fontWeight: '700',
  },
  sectionTopBar: {
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderBottomColor: '#d8ded5',
    borderBottomWidth: 1,
    elevation: 2,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 22,
    paddingVertical: 14,
    shadowColor: '#1c2420',
    shadowOffset: {
      height: 1,
      width: 0,
    },
    shadowOpacity: 0.08,
    shadowRadius: 3,
  },
  sectionTopBrand: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
  },
  sectionTopBrandMark: {
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderRadius: 8,
    height: 34,
    justifyContent: 'center',
    overflow: 'hidden',
    width: 34,
  },
  sectionTopBrandIcon: {
    height: 34,
    width: 34,
  },
  sectionTopBarTitle: {
    color: '#1c2420',
    fontSize: 16,
    fontWeight: '900',
  },
  closeButton: {
    alignItems: 'center',
    borderColor: '#176b5b',
    borderRadius: 8,
    borderWidth: 1,
    minHeight: 38,
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  closeButtonText: {
    color: '#176b5b',
    fontSize: 15,
    fontWeight: '900',
  },
  sectionBottomBar: {
    alignItems: 'center',
    backgroundColor: '#101c1a',
    borderTopColor: '#34483f',
    borderTopWidth: 1,
    elevation: 2,
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 18,
    paddingBottom: 9,
    paddingTop: 8,
    shadowColor: '#1c2420',
    shadowOffset: {
      height: -1,
      width: 0,
    },
    shadowOpacity: 0.08,
    shadowRadius: 3,
  },
  reviewSubmitBar: {
    backgroundColor: '#101c1a',
    borderTopColor: '#34483f',
    borderTopWidth: 1,
    elevation: 2,
    paddingHorizontal: 18,
    paddingBottom: 9,
    paddingTop: 8,
    shadowColor: '#1c2420',
    shadowOffset: {
      height: -1,
      width: 0,
    },
    shadowOpacity: 0.08,
    shadowRadius: 3,
  },
  reviewStickySubmitButton: {
    alignItems: 'center',
    backgroundColor: '#8d9691',
    borderRadius: 19,
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'center',
    minHeight: 42,
    paddingHorizontal: 18,
  },
  reviewStickySubmitButtonReady: {
    backgroundColor: '#078681',
  },
  reviewStickySubmitText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '900',
  },
  mainBottomNav: {
    flexShrink: 0,
    alignItems: 'center',
    backgroundColor: '#1b2b28',
    borderTopColor: '#34483f',
    borderTopWidth: 1,
    elevation: 4,
    flexDirection: 'row',
    gap: 8,
    paddingBottom: 10,
    paddingHorizontal: 12,
    paddingTop: 8,
    shadowColor: '#1c2420',
    shadowOffset: {
      height: -1,
      width: 0,
    },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  mainBottomNavItem: {
    alignItems: 'center',
    borderRadius: 8,
    flex: 1,
    gap: 3,
    justifyContent: 'center',
    minHeight: 48,
    paddingHorizontal: 10,
  },
  mainBottomNavItemSelected: {
    backgroundColor: '#27483c',
  },
  mainBottomNavIcon: {
    color: '#a7bbb4',
    fontSize: 13,
    fontWeight: '900',
    lineHeight: 15,
  },
  mainBottomNavText: {
    color: '#a7bbb4',
    fontSize: 12,
    fontWeight: '900',
    lineHeight: 15,
  },
  mainBottomNavTextSelected: {
    color: '#66c9ad',
  },
  workspaceTopbar: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', minHeight: 38, marginBottom: 23 },
  workspaceBack: { color: '#66c9ad', fontSize: 14, fontWeight: '700' },
  workspaceBrand: { color: '#66c9ad', fontSize: 11, fontWeight: '800', letterSpacing: 1.8 },
  transcriptionsPage: { flex: 1, backgroundColor: '#101c1a', paddingHorizontal: 20, paddingTop: 16 },
  transcriptionsHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 23 },
  transcriptionsTitle: { color: '#eef8f3', fontSize: 33, fontWeight: '800', letterSpacing: -1.2, marginBottom: 7 },
  transcriptionsSubtitle: { color: '#a7bbb4', fontSize: 14, lineHeight: 20 },
  newTranscriptionButton: { minHeight: 48, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14, borderRadius: 14, backgroundColor: '#125e52' },
  dictationNewButton: { minHeight: 54, marginBottom: 25, borderRadius: 16 },
  newTranscriptionButtonText: { color: '#ffffff', fontSize: 15, fontWeight: '800' },
  dictationSectionRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 },
  dictationSectionTitle: { color: '#eef8f3', fontSize: 16, fontWeight: '800' },
  dictationSectionCount: { color: '#a7bbb4', fontSize: 12 },
  dictationDriveNote: { color: '#a7bbb4', fontSize: 12, paddingVertical: 16 },
  transcriptionsList: { gap: 9, paddingBottom: 20 },
  transcriptionFileRow: { flexDirection: 'row', alignItems: 'center', gap: 13, minHeight: 77, borderWidth: 1, borderColor: '#34483f', borderRadius: 17, paddingHorizontal: 14, backgroundColor: '#1b2b28' },
  transcriptionFileIcon: { width: 43, height: 43, alignItems: 'center', justifyContent: 'center', borderRadius: 13, backgroundColor: '#27483c' },
  transcriptionFileIconText: { color: '#66c9ad', fontSize: 24, fontWeight: '700' },
  transcriptionFileDetails: { flex: 1, gap: 4 },
  transcriptionFileName: { color: '#eef8f3', fontSize: 15, fontWeight: '700' },
  transcriptionFileDate: { color: '#a7bbb4', fontSize: 12 },
  transcriptionFileChevron: { color: '#a7bbb4', fontSize: 25 },
  transcriptionsLoading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  transcriptionsEmpty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 24 },
  transcriptionsEmptyTitle: { color: '#eef8f3', fontSize: 18, fontWeight: '700', textAlign: 'center' },
  transcriptionsError: { color: '#e78288', fontSize: 13, lineHeight: 19, textAlign: 'center' },
  transcriptionsRetry: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 8, backgroundColor: '#27483c' },
  transcriptionsRetryText: { color: '#66c9ad', fontSize: 13, fontWeight: '800' },
  transcriptionsRefreshing: { position: 'absolute', top: 12, right: 16 },
  transcriptionModalBackdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(12, 27, 23, 0.55)', padding: 22 },
  transcriptionModal: { width: '100%', maxWidth: 440, borderRadius: 24, padding: 22, backgroundColor: '#1b2b28' },
  transcriptionModalTitle: { color: '#eef8f3', fontSize: 24, fontWeight: '800', marginBottom: 4 },
  transcriptionInputLabel: { color: '#eef8f3', fontSize: 12, fontWeight: '700', marginTop: 16, marginBottom: 6 },
  transcriptionNameInput: { minHeight: 47, borderWidth: 1, borderColor: '#34483f', borderRadius: 12, paddingHorizontal: 12, color: '#eef8f3', backgroundColor: '#101c1a', fontSize: 15 },
  transcriptionFilenamePreview: { color: '#a7bbb4', fontSize: 11, marginTop: 12 },
  transcriptionModalActions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 10, marginTop: 22 },
  transcriptionCancelButton: { minHeight: 42, justifyContent: 'center', paddingHorizontal: 13 },
  transcriptionCancelText: { color: '#eef8f3', fontSize: 13, fontWeight: '700' },
  transcriptionSaveButton: { minHeight: 42, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingHorizontal: 13, backgroundColor: '#087f73', borderRadius: 8 },
  transcriptionSaveButtonText: { color: '#ffffff', fontSize: 12, fontWeight: '800' },
  transcriptionSaveError: { color: '#9a3412', fontSize: 12, lineHeight: 18, paddingHorizontal: 22, paddingBottom: 6 },
  diagnosticsContent: { flexGrow: 1, gap: 14, padding: 22 },
  diagnosticsTitle: { color: '#1c302b', fontSize: 24, fontWeight: '800' },
  diagnosticsDescription: { color: '#566766', fontSize: 14, lineHeight: 20 },
  diagnosticsCard: {
    backgroundColor: '#f4f8f7',
    borderColor: '#dce4e4',
    borderRadius: 12,
    borderWidth: 1,
    gap: 8,
    padding: 16,
  },
  diagnosticsLabel: { color: '#566766', fontSize: 13, fontWeight: '700' },
  diagnosticsValue: { color: '#176b5b', fontSize: 18, fontWeight: '800' },
  diagnosticsDetail: { color: '#344a48', fontSize: 14, lineHeight: 20 },
  diagnosticsFootnote: { color: '#687774', fontSize: 12, lineHeight: 18 },
  diagnosticsButton: {
    alignItems: 'center',
    backgroundColor: '#e7f3ef',
    borderRadius: 10,
    marginTop: 4,
    paddingHorizontal: 16,
    paddingVertical: 13,
  },
  diagnosticsButtonText: { color: '#078681', fontSize: 14, fontWeight: '800' },
  speechPage: {
    flex: 1,
    backgroundColor: '#101c1a',
  },
  speechSafeArea: {
    backgroundColor: '#101c1a',
  },
  speechNavigation: {
    backgroundColor: '#1b2b28',
    borderTopColor: '#34483f',
  },
  speechHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
    paddingHorizontal: 22,
    paddingVertical: 16,
    backgroundColor: '#101c1a',
  },
  speechBrand: {
    fontSize: 16,
    fontWeight: '800',
    color: '#66c9ad',
  },
  speechHeaderLabel: {
    fontSize: 12,
    color: '#a7bbb4',
    flexShrink: 1,
  },
  speechStage: {
    flex: 1,
    paddingHorizontal: 20,
  },
  speechTopbar: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
    paddingTop: 18,
    paddingBottom: 22,
  },
  speechTitleGroup: {
    flex: 1,
    gap: 7,
  },
  speechSubtitle: {
    color: '#a7bbb4',
    fontSize: 13,
    lineHeight: 19,
  },
  speechTitle: {
    color: '#eef8f3',
    fontSize: 29,
    fontWeight: '800',
    lineHeight: 32,
  },
  speechTranscriptToolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#1b2b28',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderColor: '#34483f',
    borderWidth: 1,
    borderBottomWidth: 1,
    borderBottomColor: '#34483f',
    paddingHorizontal: 16,
    minHeight: 48,
  },
  speechSectionTitle: {
    flex: 1,
    color: '#eef8f3',
    fontSize: 14,
    fontWeight: '600',
  },
  speechWordCount: {
    fontSize: 12,
    color: '#a7bbb4',
    fontVariant: ['tabular-nums'],
  },
  speechClearButton: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: 8,
  },
  speechClearText: {
    color: '#66c9ad',
    fontSize: 13,
    fontWeight: '500',
  },
  speechWords: {
    backgroundColor: '#1b2b28',
    flex: 1,
    borderBottomLeftRadius: 20,
    borderBottomRightRadius: 20,
    borderColor: '#34483f',
    borderWidth: 1,
    borderTopWidth: 0,
  },
  speechWordsContent: {
    flexGrow: 1,
    paddingTop: 18,
    paddingHorizontal: 16,
  },
  speechWord: {
    color: '#eef8f3',
    fontSize: 17,
    fontWeight: '400',
    lineHeight: 25,
  },
  speechProvisional: {
    color: '#66c9ad',
    backgroundColor: '#27483c',
  },
  speechPlaceholder: {
    color: '#a7bbb4',
    fontSize: 17,
    fontWeight: '400',
    lineHeight: 27,
  },
  speechRecordingArea: {
    backgroundColor: '#27483c',
    borderRadius: 20,
    padding: 14,
    marginBottom: 12,
    gap: 10,
  },
  speechTalkButton: {
    alignItems: 'center',
    backgroundColor: '#176b5b',
    borderRadius: 6,
    justifyContent: 'center',
    minHeight: 58,
    paddingHorizontal: 18,
  },
  speechTalkButtonActive: {
    backgroundColor: '#a73d4a',
  },
  speechTalkText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
  speechStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    minHeight: 28,
  },
  speechStatusLabel: {
    flexShrink: 1,
  },
  speechRecordingStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 8,
  },
  speechProfileButton: { alignSelf: 'center', padding: 8 },
  speechLocalLabel: {
    color: '#a7bbb4',
    fontSize: 12,
  },
  speechStatus: {
    color: '#eef8f3',
    fontSize: 13,
    fontWeight: '500',
    lineHeight: 19,
  },
  speechError: {
    color: '#9a3412',
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 18,
    textAlign: 'center',
  },
  bottomNavButton: {
    alignItems: 'center',
    borderRadius: 19,
    flex: 0.72,
    justifyContent: 'center',
    minHeight: 38,
    paddingHorizontal: 14,
  },
  bottomNavProgress: {
    alignItems: 'center',
    flex: 0.82,
    gap: 4,
    justifyContent: 'center',
  },
  bottomNavProgressText: {
    color: '#a7bbb4',
    fontSize: 12,
    fontWeight: '900',
  },
  bottomNavProgressTrack: {
    backgroundColor: '#34483f',
    borderRadius: 3,
    height: 7,
    overflow: 'hidden',
    width: '100%',
  },
  bottomNavProgressFill: {
    backgroundColor: '#078681',
    height: 7,
    width: '0%',
  },
  bottomNavButtonPrimary: {
    backgroundColor: '#125e52',
  },
  bottomNavButtonPrimaryText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '900',
  },
  bottomNavButtonSecondary: {
    backgroundColor: '#1b2b28',
    borderColor: '#34483f',
    borderWidth: 1,
  },
  bottomNavButtonSecondaryText: {
    color: '#eef8f3',
    fontSize: 16,
    fontWeight: '900',
  },
  backButton: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderColor: '#176b5b',
    borderRadius: 8,
    borderWidth: 1,
    minHeight: 42,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  backButtonText: {
    color: '#176b5b',
    fontSize: 15,
    fontWeight: '800',
  },
  fieldList: {
    backgroundColor: '#ffffff',
    borderColor: '#d8ded5',
    borderRadius: 8,
    borderWidth: 1,
    padding: 18,
  },
  fieldRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 12,
    paddingVertical: 10,
  },
  fieldBullet: {
    backgroundColor: '#176b5b',
    borderRadius: 5,
    height: 10,
    marginTop: 6,
    width: 10,
  },
  fieldText: {
    color: '#1c2420',
    flex: 1,
    fontSize: 16,
    lineHeight: 22,
  },
  inputList: {
    gap: 14,
  },
  inputGroup: {
    backgroundColor: '#ffffff',
    borderColor: '#d8ded5',
    borderRadius: 8,
    borderWidth: 1,
    padding: 14,
  },
  inputLabel: {
    color: '#1c2420',
    fontSize: 15,
    fontWeight: '800',
    lineHeight: 20,
    marginBottom: 10,
  },
  textInput: {
    backgroundColor: '#f7f8f5',
    borderColor: '#d8ded5',
    borderRadius: 8,
    borderWidth: 1,
    color: '#1c2420',
    fontSize: 16,
    lineHeight: 22,
    minHeight: 84,
    paddingHorizontal: 12,
    paddingVertical: 10,
    textAlignVertical: 'top',
  },
  sectionFormList: {
    gap: 9,
    paddingBottom: 8,
  },
  sectionFormField: {
    gap: 4,
  },
  sectionFormLabel: {
    color: '#eef8f3',
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 19,
  },
  sectionFormInput: {
    backgroundColor: '#1b2b28',
    borderColor: '#34483f',
    borderRadius: 13,
    borderWidth: 1,
    color: '#eef8f3',
    fontSize: 14,
    lineHeight: 21,
    minHeight: 73,
    paddingHorizontal: 13,
    paddingVertical: 11,
    textAlignVertical: 'top',
  },
  reviewSection: {
    backgroundColor: '#1b2b28',
    borderColor: '#34483f',
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
  },
  reviewSectionTitle: {
    color: '#eef8f3',
    fontSize: 14,
    fontWeight: '800',
    lineHeight: 24,
    marginBottom: 12,
  },
  reviewField: {
    borderTopColor: '#34483f',
    borderTopWidth: 1,
    paddingVertical: 12,
  },
  reviewLabel: {
    color: '#a7bbb4',
    fontSize: 11,
    fontWeight: '800',
    lineHeight: 18,
    marginBottom: 5,
  },
  reviewValue: {
    color: '#eef8f3',
    fontSize: 13,
    lineHeight: 22,
  },
  reviewValueEmpty: {
    color: '#a7bbb4',
    fontStyle: 'italic',
  },
  questionText: {
    color: '#1c2420',
    fontSize: 18,
    fontWeight: '800',
    lineHeight: 24,
    marginBottom: 14,
  },
  optionGrid: {
    gap: 10,
  },
  option: {
    alignItems: 'center',
    borderColor: '#d8ded5',
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 10,
    minHeight: 46,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  optionSelected: {
    backgroundColor: '#e7f3ef',
    borderColor: '#176b5b',
  },
  radio: {
    borderColor: '#8c978f',
    borderRadius: 9,
    borderWidth: 2,
    height: 18,
    width: 18,
  },
  radioSelected: {
    backgroundColor: '#176b5b',
    borderColor: '#176b5b',
  },
  optionText: {
    color: '#1c2420',
    flex: 1,
    fontSize: 16,
    lineHeight: 21,
  },
  optionTextSelected: {
    fontWeight: '700',
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: '#176b5b',
    borderRadius: 8,
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'center',
    minHeight: 54,
    paddingHorizontal: 18,
  },
  buttonDisabled: {
    opacity: 0.45,
  },
  primaryButtonText: {
    color: '#ffffff',
    fontSize: 17,
    fontWeight: '800',
  },
  reviewSubmitButton: {
    alignItems: 'center',
    alignSelf: 'flex-end',
    backgroundColor: '#c7cec8',
    borderRadius: 18,
    justifyContent: 'center',
    marginHorizontal: 12,
    marginTop: 2,
    minHeight: 42,
    paddingHorizontal: 22,
  },
  reviewSubmitButtonEnabled: {
    backgroundColor: '#176b5b',
  },
});

export default App;
