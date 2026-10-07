package com.ramon.lmnop

import android.os.Build
import android.os.SystemClock
import android.util.Base64
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.*
import com.facebook.react.uimanager.ViewManager
import java.util.concurrent.Executors

internal object OmiMedCpu {
  external fun optimizedSupported(): Boolean
}

class OmiMedSpeechModule(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  private val queue = Executors.newSingleThreadExecutor()
  private var sessionId: String? = null
  private var handle: Long = 0
  override fun getName() = "OmiMedSpeech"
  private fun run(promise: Promise, action: () -> Any?) {
    queue.execute {
      try { promise.resolve(action()) }
      catch (error: Throwable) { promise.reject("omi_med", error.message, error) }
    }
  }
  private fun freeSession() {
    if (handle != 0L) nativeFree(handle)
    handle = 0
    sessionId = null
  }
  @ReactMethod fun prepare(id: String, modelPath: String, promise: Promise) = run(promise) {
    check(Build.VERSION.SDK_INT >= 28) { "Omi refinement requires Android 9 or newer." }
    val started = SystemClock.elapsedRealtimeNanos()
    if (sessionId != id) {
      freeSession()
      handle = nativeLoad(modelPath)
      check(handle != 0L) { "Omi model load failed." }
      sessionId = id
    }
    Arguments.createMap().apply {
      putString("model", "Omi Med STT v1 Q8_0 GGUF")
      putString("backend", "CPU")
      putBoolean("gpu", false)
      putInt("threads", 4)
      putString("runtime", "parakeet.cpp b11fe5bc + Omi adapter v2 / GGML CPU / ${if (optimized) "ARM dotprod + FP16" else "ARM baseline"}")
      putDouble("nativeLoadMs", (SystemClock.elapsedRealtimeNanos() - started) / 1e6)
    }
  }
  @ReactMethod fun transcribe(id: String, pcm: String, promise: Promise) = run(promise) {
    check(sessionId == id && handle != 0L) { "Omi is not prepared." }
    val bytes = Base64.decode(pcm, Base64.NO_WRAP)
    val started = SystemClock.elapsedRealtimeNanos()
    val text = nativeTranscribe(handle, bytes).trim()
    Arguments.createMap().apply {
      putString("text", text)
      putDouble("nativeMs", (SystemClock.elapsedRealtimeNanos() - started) / 1e6)
    }
  }
  @ReactMethod fun release(id: String, promise: Promise) = run(promise) {
    if (sessionId == id) freeSession()
    null
  }
  override fun invalidate() {
    queue.execute { freeSession() }
    queue.shutdown()
    super.invalidate()
  }
  private external fun nativeLoad(modelPath: String): Long
  private external fun nativeTranscribe(handle: Long, pcm: ByteArray): String
  private external fun nativeFree(handle: Long)
  companion object {
    private val optimized: Boolean = if (Build.VERSION.SDK_INT >= 28) {
      System.loadLibrary("lmnop_omi_med_cpu")
      OmiMedCpu.optimizedSupported()
    } else false
    init {
      if (Build.VERSION.SDK_INT >= 28)
        System.loadLibrary(if (optimized) "lmnop_omi_med_fast" else "lmnop_omi_med")
    }
  }
}

class OmiMedSpeechPackage : ReactPackage {
  override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> = listOf(OmiMedSpeechModule(context))
  override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
