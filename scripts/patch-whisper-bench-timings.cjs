const fs = require('node:fs');
const path = require('node:path');

const jsiPath = path.join(__dirname, '../node_modules/whisper.rn/cpp/jsi/RNWhisperJSI.cpp');
const typePath = path.join(__dirname, '../node_modules/whisper.rn/src/NativeRNWhisper.ts');

function replaceOnce(source, before, after, label) {
  if (source.includes(before)) return source.replace(before, after);
  if (source.includes(after)) return source;
  throw new Error(`Could not patch whisper.rn timing field: ${label}`);
}

let jsi = fs.readFileSync(jsiPath, 'utf8');
jsi = replaceOnce(jsi,
`struct TranscribeResultData {
    std::string language;
    std::string result;
    std::vector<SegmentData> segments;
    bool isAborted = false;
};`,
`struct TranscribeResultData {
    std::string language;
    std::string result;
    std::vector<SegmentData> segments;
    bool isAborted = false;
    struct {
        double audioLoadMs = 0;
        double totalMs = 0;
        double sampleMs = 0;
        double encodeMs = 0;
        double decodeMs = 0;
        double batchMs = 0;
        double promptMs = 0;
    } timings;
};`, 'result timings');

jsi = replaceOnce(jsi,
`    result.setProperty(runtime, "segments", createSegmentsArray(runtime, data.segments));
    result.setProperty(runtime, "isAborted", jsi::Value(data.isAborted));
    return result;`,
`    result.setProperty(runtime, "segments", createSegmentsArray(runtime, data.segments));
    jsi::Object timings(runtime);
    timings.setProperty(runtime, "audioLoadMs", jsi::Value(data.timings.audioLoadMs));
    timings.setProperty(runtime, "totalMs", jsi::Value(data.timings.totalMs));
    timings.setProperty(runtime, "sampleMs", jsi::Value(data.timings.sampleMs));
    timings.setProperty(runtime, "encodeMs", jsi::Value(data.timings.encodeMs));
    timings.setProperty(runtime, "decodeMs", jsi::Value(data.timings.decodeMs));
    timings.setProperty(runtime, "batchMs", jsi::Value(data.timings.batchMs));
    timings.setProperty(runtime, "promptMs", jsi::Value(data.timings.promptMs));
    result.setProperty(runtime, "timings", timings);
    result.setProperty(runtime, "isAborted", jsi::Value(data.isAborted));
    return result;`, 'JSI timings result');

jsi = replaceOnce(jsi,
`    result.language = language ? language : "";
    return result;
}`, 
`    result.language = language ? language : "";
    const auto *timings = whisper_get_timings(context);
    if (timings) {
        result.timings.sampleMs = timings->sample_ms;
        result.timings.encodeMs = timings->encode_ms;
        result.timings.decodeMs = timings->decode_ms;
        result.timings.batchMs = timings->batchd_ms;
        result.timings.promptMs = timings->prompt_ms;
    }
    return result;
}`, 'Whisper native timings');

jsi = replaceOnce(jsi,
`                    auto audio = readWaveAudio(input);
                    if (audio.empty()) {`,
`                    const auto audioReadStarted = std::chrono::steady_clock::now();
                    auto audio = readWaveAudio(input);
                    const double audioLoadMs = std::chrono::duration<double, std::milli>(
                        std::chrono::steady_clock::now() - audioReadStarted).count();
                    if (audio.empty()) {`, 'WAV load timing');

jsi = replaceOnce(jsi,
`                    int code = whisper_full_parallel(
                        holder->context,
                        job->params,
                        audio.data(),
                        static_cast<int>(audio.size()),
                        config.nProcessors);
                    bool isAborted = job->is_aborted();`,
`                    const auto inferenceStarted = std::chrono::steady_clock::now();
                    int code = whisper_full_parallel(
                        holder->context,
                        job->params,
                        audio.data(),
                        static_cast<int>(audio.size()),
                        config.nProcessors);
                    const double totalInferenceMs = std::chrono::duration<double, std::milli>(
                        std::chrono::steady_clock::now() - inferenceStarted).count();
                    bool isAborted = job->is_aborted();`, 'native inference wall timing');
jsi = replaceOnce(jsi,
`                    int code = whisper_full_parallel(
                        holder->context,
                        job->params,
                        audio.data(),
                        static_cast<int>(audio.size()),
                        config.nProcessors);
                    bool isAborted = job->is_aborted();`,
`                    const auto inferenceStarted = std::chrono::steady_clock::now();
                    int code = whisper_full_parallel(
                        holder->context,
                        job->params,
                        audio.data(),
                        static_cast<int>(audio.size()),
                        config.nProcessors);
                    const double totalInferenceMs = std::chrono::duration<double, std::milli>(
                        std::chrono::steady_clock::now() - inferenceStarted).count();
                    bool isAborted = job->is_aborted();`, 'PCM native inference wall timing');

// The same transcription call text is used by file and PCM paths. Attach the
// file preparation timings only when those locals exist in the WAV path.
jsi = replaceOnce(jsi,
`                    auto result = buildTranscribeResult(
                        holder->context,
                        config.tdrzEnable,
                        isAborted);
                    return [result](jsi::Runtime &rt) {`,
`                    auto result = buildTranscribeResult(
                        holder->context,
                        config.tdrzEnable,
                        isAborted);
                    result.timings.audioLoadMs = audioLoadMs;
                    result.timings.totalMs = totalInferenceMs;
                    return [result](jsi::Runtime &rt) {`, 'WAV timings return');

// The PCM path has no file read/resample stage, but still reports native
// inference wall time and the internal Whisper stage timings.
const pcmAnchor = `                    auto result = buildTranscribeResult(
                        holder->context,
                        config.tdrzEnable,
                        isAborted);
                    return [result](jsi::Runtime &rt) {`;
if (jsi.includes(pcmAnchor)) {
  jsi = replaceOnce(jsi, pcmAnchor,
`                    auto result = buildTranscribeResult(
                        holder->context,
                        config.tdrzEnable,
                        isAborted);
                    result.timings.totalMs = totalInferenceMs;
                    return [result](jsi::Runtime &rt) {`, 'PCM timings return');
}

fs.writeFileSync(jsiPath, jsi);

let types = fs.readFileSync(typePath, 'utf8');
types = replaceOnce(types,
`export type TranscribeResult = {
  result: string`,
`export type TranscribeResult = {
  timings?: {
    audioLoadMs: number;
    totalMs: number;
    sampleMs: number;
    encodeMs: number;
    decodeMs: number;
    batchMs: number;
    promptMs: number;
  };
  result: string`, 'TypeScript result timings');
fs.writeFileSync(typePath, types);
