package com.ramon.lmnop

import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.util.concurrent.Executors

class DictationAudioModule(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  private val queue = Executors.newSingleThreadExecutor()
  @Volatile private var running = false
  private var recorder: AudioRecord? = null
  private var reader: Thread? = null
  private var sessionId: String? = null
  override fun getName() = "DictationAudio"
  @ReactMethod fun addListener(name: String) {}
  @ReactMethod fun removeListeners(count: Double) {}
  private fun emit(name: String, value: Any) {
    if (reactApplicationContext.hasActiveReactInstance())
      reactApplicationContext.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java).emit(name, value)
  }
  @ReactMethod fun start(promise: Promise) = begin(null, promise)
  @ReactMethod fun startSession(id: String, promise: Promise) = begin(id, promise)
  private fun begin(id: String?, promise: Promise) {
    queue.execute {
      try {
        check(recorder == null) { "Microphone is already recording" }
        val minimum = AudioRecord.getMinBufferSize(16000, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
        check(minimum > 0) { "Microphone does not support 16 kHz PCM" }
        val audio = AudioRecord(MediaRecorder.AudioSource.VOICE_RECOGNITION, 16000,
          AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, maxOf(minimum * 2, 6400))
        recorder = audio
        sessionId = id
        check(audio.state == AudioRecord.STATE_INITIALIZED) { "Microphone initialization failed" }
        audio.startRecording()
        check(audio.recordingState == AudioRecord.RECORDSTATE_RECORDING) { "Microphone could not start" }
        running = true
        reader = Thread({
          val buffer = ShortArray(if (id == null) 1600 else 512)
          while (running) {
            val count = audio.read(buffer, 0, buffer.size)
            if (count < 0) {
              if (running) emit("DictationAudioError", "Microphone read failed ($count)")
              break
            }
            if (count > 0) {
              val samples = Arguments.createArray()
              for (i in 0 until count) samples.pushDouble(buffer[i] / 32768.0)
              if (id == null) emit("DictationPcm", samples)
              else emit("DictationFrame", Arguments.createMap().apply {
                putString("id", id)
                putArray("samples", samples)
                putDouble("capturedAt", System.currentTimeMillis().toDouble())
              })
            }
          }
        }, "LMNOP microphone").also { it.start() }
        promise.resolve(null)
      } catch (error: Exception) {
        close()
        promise.reject("microphone", error.message, error)
      }
    }
  }
  private fun close() {
    running = false
    val audio = recorder
    try { if (audio?.recordingState == AudioRecord.RECORDSTATE_RECORDING) audio.stop() }
    finally {
      reader?.join()
      reader = null
      audio?.release()
      recorder = null
      sessionId?.let { emit("DictationEnd", it) }
      sessionId = null
    }
  }
  @ReactMethod fun stop(promise: Promise) {
    queue.execute {
      try { close(); promise.resolve(null) }
      catch (error: Exception) { promise.reject("microphone", error.message, error) }
    }
  }
  override fun invalidate() {
    queue.execute { close() }
    queue.shutdown()
    super.invalidate()
  }
}
