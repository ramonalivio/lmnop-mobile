import { useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

type Page = 'start' | 'photo' | 'voice' | 'edit' | 'review' | 'pdf' | 'email' | 'profile' | 'signature';
type Source = 'photo' | 'voice' | 'type';
type Medication = {
  name: string;
  strength: string;
  dose: string;
  route: string;
  frequency: string;
  duration: string;
  quantity: string;
  refills: string;
  directions: string;
};
type PrescriptionDraft = {
  patientName: string;
  birthDate: string;
  prescriptionDate: string;
  medications: Medication[];
};
type Profile = { name: string; registration: string; practice: string; address: string };

const emptyMedication = (): Medication => ({
  name: '', strength: '', dose: '', route: '', frequency: '', duration: '', quantity: '', refills: '', directions: '',
});
const today = () => new Date().toLocaleDateString('en-GB');

export function PrescriptionScreen({ email, initialPage = 'start', onExit }: {
  email: string | null;
  initialPage?: 'start' | 'profile';
  onExit?: () => void;
}) {
  const [page, setPage] = useState<Page>(initialPage);
  const [source, setSource] = useState<Source>('type');
  const [pdfKind, setPdfKind] = useState<'new' | 'copy'>('new');
  const [draft, setDraft] = useState<PrescriptionDraft>({
    patientName: '', birthDate: '', prescriptionDate: today(), medications: [emptyMedication()],
  });
  const [profile, setProfile] = useState<Profile>({ name: '', registration: '', practice: '', address: '' });
  const [profileReturn, setProfileReturn] = useState<'start' | 'review'>('start');
  const [signaturePoints, setSignaturePoints] = useState<Array<{ x: number; y: number }>>([]);
  const [hasSignature, setHasSignature] = useState(false);
  const [emailTo, setEmailTo] = useState('');
  const [emailSubject, setEmailSubject] = useState('Prescription PDF');
  const [emailMessage, setEmailMessage] = useState('');

  const pending = (feature: string) => Alert.alert(
    `${feature} is not connected yet`,
    'This is the approved Prescription interface. The service integration will follow.',
  );
  const chooseSource = (next: Source) => {
    setSource(next);
    setPdfKind('new');
    setDraft({ patientName: '', birthDate: '', prescriptionDate: today(), medications: [emptyMedication()] });
    setPage(next === 'type' ? 'edit' : next);
  };
  const updateDraft = (key: 'patientName' | 'birthDate' | 'prescriptionDate', value: string) =>
    setDraft(current => ({ ...current, [key]: value }));
  const updateMedication = (index: number, key: keyof Medication, value: string) =>
    setDraft(current => ({ ...current, medications: current.medications.map((medicine, at) => at === index ? { ...medicine, [key]: value } : medicine) }));
  const openProfile = (from: 'start' | 'review') => { setProfileReturn(from); setPage('profile'); };
  const goBack = () => {
    if (page === 'start') return onExit?.();
    if (page === 'signature') return setPage('profile');
    if (page === 'profile') return initialPage === 'profile' ? onExit?.() : setPage(profileReturn);
    if (page === 'email') return setPage('pdf');
    if (page === 'pdf') return setPage(pdfKind === 'copy' ? 'photo' : 'review');
    if (page === 'review') return setPage('edit');
    return setPage('start');
  };

  const field = (label: string, value: string, onChangeText: (value: string) => void, placeholder = '') => (
    <View style={styles.field} key={label}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        autoCapitalize="sentences"
        onChangeText={onChangeText}
        placeholder={placeholder || label}
        placeholderTextColor="#9aa9a2"
        style={styles.input}
        value={value}
      />
    </View>
  );
  const action = (label: string, onPress: () => void, secondary = false, disabled = false) => (
    <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={[styles.action, secondary && styles.secondaryAction, disabled && styles.disabledAction]}>
      <Text style={[styles.actionText, secondary && styles.secondaryActionText]}>{label}</Text>
    </Pressable>
  );
  const card = (icon: string, title: string, detail: string, onPress: () => void) => (
    <Pressable accessibilityRole="button" key={title} onPress={onPress} style={styles.choiceCard}>
      <View style={styles.choiceIcon}><Text style={styles.choiceIconText}>{icon}</Text></View>
      <View style={styles.choiceBody}><Text style={styles.choiceTitle}>{title}</Text><Text style={styles.choiceDetail}>{detail}</Text></View>
      <Text style={styles.chevron}>›</Text>
    </Pressable>
  );

  return (
    <View style={styles.page}>
      <View style={styles.topbar}>
        <Pressable accessibilityRole="button" onPress={goBack} style={styles.backButton}>
          <Text style={styles.backText}>{page === 'start' ? '‹  Home' : '‹  Back'}</Text>
        </Pressable>
        <Text style={styles.topRight}>{page === 'start' ? 'CARE WORKSPACE' : page === 'profile' ? 'SETTINGS' : 'PRESCRIPTION'}</Text>
      </View>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {page === 'start' && <>
          <Text style={styles.kicker}>CARE WORKSPACE</Text>
          <Text style={styles.heading}>Prescriptions</Text>
          <Text style={styles.subtitle}>Choose one way to create or digitize a prescription.</Text>
          <View style={styles.cardList}>
            {card('▧', 'Scan existing', 'Extract with Gemini · Internet required', () => chooseSource('photo'))}
            {card('◉', 'Dictate new', 'Use the same voice models as Dictation', () => chooseSource('voice'))}
            {card('✎', 'Type new', 'Enter structured medication fields', () => chooseSource('type'))}
          </View>
          <Text style={styles.sectionTitle}>One method per prescription</Text>
          <View style={styles.softCard}><Text style={styles.softText}>Review and correct details manually before approving the final PDF.</Text></View>
          <Pressable accessibilityRole="button" onPress={() => openProfile('start')} style={styles.profileLink}>
            <Text style={styles.profileLinkText}>Prescriber profile & signature</Text><Text style={styles.chevron}>›</Text>
          </Pressable>
          <Text style={styles.previewNote}>Interface preview. Nothing on these screens is saved, sent, or uploaded yet.</Text>
        </>}

        {page === 'photo' && <>
          <Text style={styles.heading}>Scan a prescription</Text>
          <Text style={styles.subtitle}>Capture one existing prescription. Gemini extraction requires internet.</Text>
          <View style={styles.photoStage}><View style={styles.paper}><Text style={styles.paperTitle}>PRESCRIPTION</Text><View style={styles.paperLine}/><View style={[styles.paperLine, styles.paperLineShort]}/><View style={styles.paperLine}/><View style={styles.paperLine}/></View></View>
          <Text style={styles.caption}>No photo selected</Text>
          {action('Take photo', () => pending('Camera capture'))}
          {action('Choose from library', () => pending('Photo selection'), true)}
          <View style={styles.notice}><Text style={styles.noticeTitle}>Internet required</Text><Text style={styles.noticeText}>The photo will be sent to Gemini for extraction. Only the approved final PDF will go to Google Drive.</Text></View>
          <Text style={styles.sectionTitle}>After extraction</Text>
          {card('✎', 'Create editable prescription', 'Review extracted fields and sign a new PDF', () => { setPdfKind('new'); setPage('edit'); })}
          {card('▤', 'Keep as digitized copy', 'Preview and approve a PDF copy of the source', () => { setPdfKind('copy'); setPage('pdf'); })}
          <Text style={styles.previewNote}>These paths show the layout. No source image has been captured or extracted.</Text>
        </>}

        {page === 'voice' && <>
          <Text style={styles.heading}>Dictate details</Text>
          <Text style={styles.subtitle}>The same local models used by Dictation will produce the transcript.</Text>
          <View style={styles.wave}><Text style={styles.waveText}>▂ ▅ ▇ ▃ ▆ ▂ ▄ ▇ ▃ ▅ ▂</Text></View>
          <Pressable accessibilityRole="button" onPress={() => pending('Voice dictation')} style={styles.record}><Text style={styles.recordText}>●</Text></Pressable>
          <Text style={styles.recordCaption}>Tap to start dictation</Text>
          <View style={styles.transcript}><Text style={styles.transcriptLabel}>TRANSCRIPT PREVIEW</Text><Text style={styles.transcriptText}>Your dictation will appear here for review.</Text></View>
          <View style={styles.softCard}><Text style={styles.softText}>The prescriber checks the transcript and manually corrects the medication fields.</Text></View>
          {action('Review structured fields', () => setPage('edit'))}
          <Text style={styles.previewNote}>No audio is recorded in this interface preview.</Text>
        </>}

        {page === 'edit' && <>
          <Text style={styles.heading}>{source === 'type' ? 'Add prescription' : 'Edit prescription'}</Text>
          <Text style={styles.subtitle}>{source === 'type' ? 'Enter patient and medication details manually.' : 'Correct each structured field against the source before approval.'}</Text>
          {source !== 'type' && <View style={styles.notice}><Text style={styles.noticeText}>The {source === 'photo' ? 'photo extraction' : 'voice transcript'} is not connected yet. These fields are a layout preview.</Text></View>}
          <Text style={styles.sectionTitle}>Patient</Text>
          {field('Full name', draft.patientName, value => updateDraft('patientName', value), 'Patient full name')}
          <View style={styles.twoColumn}>{field('Date of birth', draft.birthDate, value => updateDraft('birthDate', value), 'DD / MM / YYYY')}{field('Prescription date', draft.prescriptionDate, value => updateDraft('prescriptionDate', value))}</View>
          {draft.medications.map((medicine, index) => <View key={`medicine-${index}`}>
            <Text style={styles.sectionTitle}>Medication {index + 1}</Text>
            {field('Medication name', medicine.name, value => updateMedication(index, 'name', value))}
            <View style={styles.twoColumn}>{field('Strength', medicine.strength, value => updateMedication(index, 'strength', value), 'e.g. 10 mg')}{field('Dose', medicine.dose, value => updateMedication(index, 'dose', value), 'e.g. 1 tablet')}</View>
            <View style={styles.twoColumn}>{field('Route', medicine.route, value => updateMedication(index, 'route', value), 'e.g. Oral')}{field('Frequency', medicine.frequency, value => updateMedication(index, 'frequency', value), 'e.g. Daily')}</View>
            <View style={styles.twoColumn}>{field('Duration', medicine.duration, value => updateMedication(index, 'duration', value), 'e.g. 14 days')}{field('Quantity', medicine.quantity, value => updateMedication(index, 'quantity', value))}</View>
            {field('Refills', medicine.refills, value => updateMedication(index, 'refills', value))}
            {field('Directions', medicine.directions, value => updateMedication(index, 'directions', value), 'Additional instructions')}
          </View>)}
          <Pressable accessibilityRole="button" onPress={() => setDraft(current => ({ ...current, medications: [...current.medications, emptyMedication()] }))} style={styles.textButton}><Text style={styles.textButtonLabel}>＋ Add another medication</Text></Pressable>
          {action('Review prescription', () => setPage('review'))}
        </>}

        {page === 'review' && <>
          <Text style={styles.heading}>Review & sign</Text>
          <Text style={styles.subtitle}>Check the details before previewing the PDF.</Text>
          <View style={styles.notice}><Text style={styles.noticeText}>The prescriber decides when the details are correct. Edit any mistake before approval.</Text></View>
          <View style={styles.reviewCard}><View style={styles.reviewHeader}><Text style={styles.reviewTitle}>Patient</Text><Pressable onPress={() => setPage('edit')}><Text style={styles.textButtonLabel}>Edit</Text></Pressable></View><Text style={styles.reviewValue}>{draft.patientName || 'Patient name'} · {draft.birthDate || 'Date of birth'}</Text></View>
          {draft.medications.map((medicine, index) => <View key={`review-${index}`} style={styles.reviewCard}><View style={styles.reviewHeader}><Text style={styles.reviewTitle}>Medication {index + 1}</Text><Pressable onPress={() => setPage('edit')}><Text style={styles.textButtonLabel}>Edit fields</Text></Pressable></View><Text style={styles.reviewValue}>{medicine.name || 'Medication name'}{medicine.strength ? ` · ${medicine.strength}` : ''}</Text><Text style={styles.reviewSub}>{[medicine.dose, medicine.route, medicine.frequency, medicine.duration, medicine.quantity, medicine.refills, medicine.directions].filter(Boolean).join(' · ') || 'Dose · Route · Frequency · Duration · Quantity · Refills'}</Text></View>)}
          <View style={styles.reviewCard}><View style={styles.reviewHeader}><Text style={styles.reviewTitle}>Prescriber</Text><Pressable onPress={() => openProfile('review')}><Text style={styles.textButtonLabel}>Edit profile</Text></Pressable></View><Text style={styles.reviewValue}>{profile.name || 'Add prescriber details in Settings'}</Text><Text style={styles.reviewSub}>{profile.registration || 'Professional registration'}</Text></View>
          <View style={styles.reviewCard}><Text style={styles.reviewTitle}>Signature</Text><View style={styles.signaturePreview}>{hasSignature ? signaturePoints.map((point, index) => <View key={index} style={[styles.signatureDot, { left: point.x, top: point.y }]}/>) : <Text style={styles.reviewSub}>No saved signature</Text>}</View><Text style={styles.reviewSub}>Change in Settings → Prescriber profile</Text></View>
          <View style={styles.softCard}><Text style={styles.softText}>After approval, only the final PDF uploads to Google Drive automatically.</Text></View>
          {action('Preview PDF', () => { setPdfKind('new'); setPage('pdf'); })}
        </>}

        {page === 'pdf' && <>
          <Text style={styles.heading}>Review PDF</Text>
          <Text style={styles.subtitle}>Preview the {pdfKind === 'copy' ? 'digitized source copy' : 'finished prescription'} before approval.</Text>
          <View style={styles.document}>
            <View style={styles.documentHead}><Text style={styles.documentBrand}>{pdfKind === 'copy' ? 'DOCUMENT COPY' : 'LMNOP'}</Text><Text style={styles.documentPractice}>{profile.practice || 'Practice details'}</Text></View>
            <Text style={styles.documentTitle}>{pdfKind === 'copy' ? 'Scanned prescription' : 'Prescription'}</Text>
            {pdfKind === 'copy' ? <View style={styles.documentScan}><Text style={styles.documentScanText}>Original photographed page</Text></View> : <>
              <Text style={styles.documentText}>Patient  {draft.patientName || 'Patient name'}</Text>
              <Text style={styles.documentText}>Date of birth  {draft.birthDate || 'DD / MM / YYYY'}</Text>
              <Text style={styles.documentText}>Issued  {draft.prescriptionDate}</Text>
              {draft.medications.map((medicine, index) => <View key={`pdf-${index}`} style={styles.documentMedicine}><Text style={styles.documentMedicineTitle}>{medicine.name || 'Medication name'}  {medicine.strength}</Text><Text style={styles.documentText}>{[medicine.dose, medicine.route, medicine.frequency, medicine.duration, medicine.quantity, medicine.refills, medicine.directions].filter(Boolean).join(' · ') || 'Dose and directions'}</Text></View>)}
              <Text style={styles.documentSignature}>{hasSignature ? 'Signed by prescriber' : 'Prescriber signature'}</Text>
              <Text style={styles.documentText}>{profile.name || 'Prescriber name'}</Text>
            </>}
          </View>
          <Text style={styles.previewNote}>On approval, this screen will show upload progress, saved confirmation, or a retryable failure.</Text>
          {action('Approve PDF & upload', () => pending('PDF generation and Google Drive upload'))}
          <View style={styles.twoColumn}>{action('Share PDF', () => pending('OS sharing'), true)}{action('Email', () => setPage('email'), true)}</View>
        </>}

        {page === 'email' && <>
          <Text style={styles.heading}>Email prescription</Text>
          <Text style={styles.subtitle}>Send the approved PDF from your connected Google email. Internet required.</Text>
          <View style={styles.softCard}><Text style={styles.softText}>FROM · {email || 'Connected Google account'}</Text></View>
          {field('To', emailTo, setEmailTo, 'Recipient email address')}
          {field('Subject', emailSubject, setEmailSubject)}
          {field('Message', emailMessage, setEmailMessage, 'Add a note for the recipient')}
          <View style={styles.reviewCard}><Text style={styles.reviewTitle}>▤  Prescription.pdf</Text><Text style={styles.reviewSub}>Approved PDF attachment</Text></View>
          {action('Send email', () => pending('Gmail sending'))}
          <Text style={styles.previewNote}>Sending is unavailable offline and is not connected in this preview.</Text>
        </>}

        {page === 'profile' && <>
          <Text style={styles.heading}>Prescriber profile</Text>
          <Text style={styles.subtitle}>These details and the signature will be reused on prescriptions.</Text>
          {field('Full name', profile.name, value => setProfile(current => ({ ...current, name: value })))}
          {field('Professional registration', profile.registration, value => setProfile(current => ({ ...current, registration: value })))}
          {field('Practice name', profile.practice, value => setProfile(current => ({ ...current, practice: value })))}
          {field('Practice address', profile.address, value => setProfile(current => ({ ...current, address: value })))}
          <Text style={styles.sectionTitle}>Signature</Text>
          <View style={styles.signaturePreview}>{hasSignature ? signaturePoints.map((point, index) => <View key={index} style={[styles.signatureDot, { left: point.x, top: point.y }]}/>) : <Text style={styles.reviewSub}>No signature added</Text>}</View>
          <View style={styles.twoColumn}>{action('Draw on screen', () => setPage('signature'), true)}{action('Upload file', () => pending('Signature file selection'), true)}</View>
          <Text style={styles.previewNote}>Profile changes remain in memory for this preview and are not saved yet.</Text>
        </>}

        {page === 'signature' && <>
          <Text style={styles.heading}>Draw signature</Text>
          <Text style={styles.subtitle}>Drag your finger on the area below.</Text>
          <View
            accessible
            accessibilityLabel="Signature drawing area"
            onStartShouldSetResponder={() => true}
            onMoveShouldSetResponder={() => true}
            onResponderGrant={event => setSignaturePoints([{ x: event.nativeEvent.locationX, y: event.nativeEvent.locationY }])}
            onResponderMove={event => setSignaturePoints(points => [...points, { x: event.nativeEvent.locationX, y: event.nativeEvent.locationY }])}
            style={styles.signaturePad}
          >
            {signaturePoints.map((point, index) => <View key={index} style={[styles.signatureDot, { left: point.x, top: point.y }]}/>)}
          </View>
          {action('Clear signature', () => { setSignaturePoints([]); setHasSignature(false); }, true)}
          {action('Use this signature', () => { setHasSignature(signaturePoints.length > 0); setPage('profile'); }, false, signaturePoints.length === 0)}
          <Text style={styles.previewNote}>The drawn signature is used only in this preview session.</Text>
        </>}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#101d1a' },
  topbar: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 22, paddingTop: 17, paddingBottom: 10 },
  backButton: { minHeight: 34, justifyContent: 'center' }, backText: { color: '#71cdb0', fontSize: 14, fontWeight: '700' }, topRight: { color: '#78887f', fontSize: 11, fontWeight: '700', letterSpacing: 1 },
  content: { paddingHorizontal: 22, paddingBottom: 32 },
  kicker: { color: '#71cdb0', fontSize: 11, fontWeight: '800', letterSpacing: 2, marginTop: 20 },
  heading: { color: '#edf7f1', fontSize: 31, fontWeight: '800', letterSpacing: -1, marginTop: 21 },
  subtitle: { color: '#a6bdb2', fontSize: 14, lineHeight: 21, marginTop: 6, marginBottom: 16 },
  cardList: { gap: 10, marginTop: 7 },
  choiceCard: { alignItems: 'center', backgroundColor: '#1c2d28', borderColor: '#354940', borderRadius: 18, borderWidth: 1, flexDirection: 'row', gap: 12, minHeight: 84, padding: 15, marginTop: 9 },
  choiceIcon: { alignItems: 'center', justifyContent: 'center', width: 44, height: 44, borderRadius: 13, backgroundColor: '#29493b' }, choiceIconText: { color: '#71cdb0', fontSize: 23 },
  choiceBody: { flex: 1 }, choiceTitle: { color: '#edf7f1', fontSize: 16, fontWeight: '800' }, choiceDetail: { color: '#a6bdb2', fontSize: 12, lineHeight: 17, marginTop: 4 }, chevron: { color: '#a6bdb2', fontSize: 24 },
  sectionTitle: { color: '#edf7f1', fontSize: 14, fontWeight: '800', marginTop: 24, marginBottom: 10 },
  softCard: { backgroundColor: '#29493b', borderRadius: 15, padding: 14, marginTop: 10 }, softText: { color: '#71cdb0', fontSize: 12, lineHeight: 18 },
  profileLink: { alignItems: 'center', borderBottomColor: '#354940', borderBottomWidth: 1, flexDirection: 'row', justifyContent: 'space-between', marginTop: 25, minHeight: 50 }, profileLinkText: { color: '#71cdb0', fontSize: 14, fontWeight: '700' },
  previewNote: { color: '#a6bdb2', fontSize: 11, lineHeight: 17, marginTop: 15 },
  photoStage: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#22392f', height: 185, borderRadius: 18, marginTop: 10 },
  paper: { backgroundColor: '#ffffff', height: 150, width: 132, borderRadius: 3, padding: 14, transform: [{ rotate: '-4deg' }] }, paperTitle: { color: '#405b4b', fontSize: 9, fontWeight: '800', letterSpacing: 1 }, paperLine: { backgroundColor: '#8aa99a', height: 3, borderRadius: 3, marginTop: 12 }, paperLineShort: { width: '65%' }, caption: { color: '#a6bdb2', fontSize: 11, marginTop: 9, marginBottom: 7 },
  action: { alignItems: 'center', backgroundColor: '#11594c', borderRadius: 15, justifyContent: 'center', minHeight: 51, paddingHorizontal: 12, marginTop: 11, flex: 1 }, actionText: { color: '#ffffff', fontSize: 14, fontWeight: '700', textAlign: 'center' }, secondaryAction: { backgroundColor: '#1c2d28', borderColor: '#354940', borderWidth: 1 }, secondaryActionText: { color: '#edf7f1' }, disabledAction: { opacity: 0.45 },
  notice: { backgroundColor: '#4d3921', borderRadius: 14, padding: 13, marginTop: 17 }, noticeTitle: { color: '#e7bd7d', fontSize: 12, fontWeight: '800' }, noticeText: { color: '#e7bd7d', fontSize: 12, lineHeight: 18 },
  wave: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#29493b', borderRadius: 18, height: 115, marginTop: 13 }, waveText: { color: '#71cdb0', fontSize: 27, letterSpacing: 3 }, record: { alignSelf: 'center', alignItems: 'center', justifyContent: 'center', width: 74, height: 74, backgroundColor: '#11594c', borderRadius: 40, marginTop: 25 }, recordText: { color: '#ffffff', fontSize: 33 }, recordCaption: { color: '#a6bdb2', fontSize: 13, textAlign: 'center', marginTop: 12 },
  transcript: { backgroundColor: '#1c2d28', borderColor: '#354940', borderWidth: 1, borderRadius: 17, padding: 16, marginTop: 20 }, transcriptLabel: { color: '#a6bdb2', fontSize: 11, fontWeight: '800', letterSpacing: 1 }, transcriptText: { color: '#edf7f1', fontSize: 14, marginTop: 10 },
  field: { flex: 1, marginTop: 12 }, fieldLabel: { color: '#edf7f1', fontSize: 12, fontWeight: '800' }, input: { backgroundColor: '#1c2d28', borderColor: '#354940', borderRadius: 12, borderWidth: 1, color: '#edf7f1', fontSize: 16, minHeight: 47, marginTop: 7, paddingHorizontal: 12, paddingVertical: 10 }, twoColumn: { flexDirection: 'row', gap: 10 }, textButton: { alignSelf: 'flex-start', marginTop: 17, paddingVertical: 7 }, textButtonLabel: { color: '#71cdb0', fontSize: 12, fontWeight: '800' },
  reviewCard: { backgroundColor: '#1c2d28', borderColor: '#354940', borderRadius: 17, borderWidth: 1, marginTop: 10, padding: 14 }, reviewHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' }, reviewTitle: { color: '#edf7f1', fontSize: 13, fontWeight: '800' }, reviewValue: { color: '#edf7f1', fontSize: 12, lineHeight: 18, marginTop: 7 }, reviewSub: { color: '#a6bdb2', fontSize: 11, lineHeight: 17, marginTop: 5 },
  signaturePreview: { backgroundColor: '#22392f', borderColor: '#354940', borderRadius: 11, borderStyle: 'dashed', borderWidth: 1, justifyContent: 'center', minHeight: 68, marginTop: 11, overflow: 'hidden', padding: 11 }, signaturePad: { backgroundColor: '#1c2d28', borderColor: '#354940', borderRadius: 16, borderWidth: 1, height: 220, marginTop: 16, overflow: 'hidden' }, signatureDot: { position: 'absolute', backgroundColor: '#edf7f1', width: 4, height: 4, borderRadius: 2 },
  document: { backgroundColor: '#ffffff', borderColor: '#354940', borderWidth: 1, borderRadius: 5, minHeight: 395, padding: 19, marginTop: 8 }, documentHead: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', borderBottomColor: '#d6ded6', borderBottomWidth: 1, paddingBottom: 12 }, documentBrand: { color: '#20352d', fontSize: 15, fontWeight: '800', letterSpacing: 1 }, documentPractice: { color: '#6c7b70', fontSize: 9 }, documentTitle: { color: '#20352d', fontSize: 19, fontWeight: '800', marginTop: 20, marginBottom: 12 }, documentText: { color: '#20352d', fontSize: 10, lineHeight: 17 }, documentMedicine: { borderTopColor: '#d6ded6', borderTopWidth: 1, marginTop: 20, paddingTop: 13 }, documentMedicineTitle: { color: '#20352d', fontSize: 13, fontWeight: '800' }, documentSignature: { color: '#20352d', fontSize: 11, marginTop: 28 }, documentScan: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#22392f', height: 240, marginTop: 10 }, documentScanText: { color: '#a6bdb2', fontSize: 12 },
});
