package com.ramon.lmnop

import ai.moonshine.voice.JNI
import android.os.SystemClock
import android.util.Log
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.*
import com.facebook.react.uimanager.ViewManager
import java.io.File
import java.util.concurrent.Executors

/** Same streaming contract and cadence as the iOS Moonshine bridge. */
class MoonshineSpeechModule(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  private val queue = Executors.newSingleThreadExecutor()
  private var transcriber = -1
  private var stream = -1
  private var audioTime = 0.0
  private var lastUpdate = 0.0
  private var lastDecode = 0.0
  override fun getName() = "MoonshineSpeech"

  private fun run(promise: Promise, action: () -> Any?) {
    queue.execute {
      try { promise.resolve(action()) }
      catch (error: Exception) { promise.reject("moonshine", error.message, error) }
    }
  }
  private fun check(code: Int) {
    check(code >= 0) { JNI.moonshineErrorToString(code) ?: "Moonshine failed ($code)" }
  }
  private fun freeStream() {
    if (stream >= 0 && transcriber >= 0) JNI.moonshineFreeStream(transcriber, stream)
    stream = -1
  }
  private fun release() {
    freeStream()
    if (transcriber >= 0) JNI.moonshineFreeTranscriber(transcriber)
    transcriber = -1
  }
  private fun snapshot(final: Boolean): WritableMap {
    val started = SystemClock.elapsedRealtimeNanos()
    val transcript = JNI.moonshineTranscribeStream(transcriber, stream, 0)
      ?: error("Moonshine returned no transcript")
    lastDecode = (SystemClock.elapsedRealtimeNanos() - started) / 1e9
    val confirmed = mutableListOf<String>()
    val provisional = mutableListOf<String>()
    var pending = false
    for (line in transcript.lines.orEmpty()) {
      if (!final && !line.isComplete) pending = true
      val text = line.text?.trim().orEmpty()
      if (text.isNotEmpty()) (if (pending) provisional else confirmed).add(text)
    }
    return Arguments.createMap().apply {
      putString("confirmed", confirmed.joinToString(" "))
      putString("provisional", provisional.joinToString(" "))
    }
  }
  @ReactMethod fun prepare(keyterms: ReadableArray, promise: Promise) = run(promise) {
    if (transcriber < 0) {
      JNI.ensureLibraryLoaded()
      val model = "moonshine-medium-streaming-en-26-08-21"
      val folder = File(reactApplicationContext.filesDir, "models/$model")
      check(folder.isDirectory || folder.mkdirs()) { "Cannot create Moonshine model directory" }
      for (name in listOf("adapter.ort", "cross_kv.ort", "decoder_kv.ort", "encoder.ort",
          "frontend.model.ort", "frontend.weights.ort", "streaming_config.json", "tokenizer.bin")) {
        val target = File(folder, name)
        val asset = "models/$model/$name"
        val size = reactApplicationContext.assets.openFd(asset).use { it.length }
        if (!target.exists() || target.length() != size) {
          val temporary = File(folder, "$name.partial")
          reactApplicationContext.assets.open(asset).use { input -> temporary.outputStream().use { input.copyTo(it) } }
          check(temporary.length() == size && temporary.renameTo(target)) { "Cannot install Moonshine model: $name" }
        }
      }
      transcriber = JNI.moonshineLoadTranscriberFromFiles(folder.absolutePath, JNI.MOONSHINE_MODEL_ARCH_MEDIUM_STREAMING, emptyArray())
      check(transcriber)
      try {
        check(JNI.moonshineTranscriberSetKeyterms(transcriber, (0 until keyterms.size()).mapNotNull { keyterms.getString(it) }.joinToString(",")))
      } catch (error: Exception) { release(); throw error }
      Log.i("MoonshineSpeech", "Moonshine Medium ready, runtime ${JNI.moonshineGetVersion()}")
    }
    null
  }
  @ReactMethod fun start(promise: Promise) = run(promise) {
    check(transcriber >= 0 && stream < 0) { "Recognizer is not ready or recording is active" }
    stream = JNI.moonshineCreateStream(transcriber, 0)
    check(stream)
    try { check(JNI.moonshineStartStream(transcriber, stream)) }
    catch (error: Exception) { freeStream(); throw error }
    audioTime = 0.0; lastUpdate = 0.0; lastDecode = 0.0
    null
  }
  @ReactMethod fun process(samples: ReadableArray, rate: Double, promise: Promise) = run(promise) {
    check(stream >= 0 && rate.isFinite() && rate in 8000.0..192000.0) { "No active recording or invalid sample rate" }
    val pcm = FloatArray(samples.size()) { samples.getDouble(it).toFloat() }
    check(JNI.moonshineAddAudioToStream(transcriber, stream, pcm, rate.toInt(), 0))
    audioTime += pcm.size / rate
    if (audioTime - lastUpdate < lastDecode.coerceIn(0.5, 2.0)) null
    else snapshot(false).also { lastUpdate = audioTime }
  }
  @ReactMethod fun finish(promise: Promise) = run(promise) {
    check(stream >= 0) { "No active recording" }
    try {
      check(JNI.moonshineStopStream(transcriber, stream))
      snapshot(true)
    } finally { freeStream() }
  }
  // Keep the page-preloaded recognizer resident across dictation session changes.
  // invalidate() releases it when React Native tears down the native module.
  @ReactMethod fun dispose(promise: Promise) = run(promise) { freeStream(); null }
  override fun invalidate() {
    queue.execute { release() }
    queue.shutdown()
    super.invalidate()
  }
}

class MoonshineSpeechPackage : ReactPackage {
  override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> = listOf(MoonshineSpeechModule(context), DictationAudioModule(context), TranscriptKeyboardModule(context))
  override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
