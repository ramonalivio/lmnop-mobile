package com.ramon.lmnop

import android.util.Base64
import android.os.Build
import org.json.JSONObject
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.*
import com.facebook.react.uimanager.ViewManager
import java.util.concurrent.Executors

class ParakeetSpeechModule(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  private val queue = Executors.newSingleThreadExecutor()
  private val sessions = mutableMapOf<String, Long>()
  override fun getName() = "ParakeetSpeech"
  private fun run(promise: Promise, action: () -> Any?) {
    queue.execute {
      try { promise.resolve(action()) }
      catch (error: Throwable) { promise.reject("parakeet", error.message, error) }
    }
  }
  @ReactMethod fun prepare(id: String, modelPath: String, promise: Promise) = run(promise) {
    check(Build.VERSION.SDK_INT >= 28) { "Parakeet refinement requires Android 9 or newer." }
    if (!sessions.containsKey(id)) sessions[id] = nativeLoad(modelPath)
    val backend = nativeBackendName(sessions.getValue(id))
    Arguments.createMap().apply {
      putString("model", "Parakeet TDT 0.6B v3 ONNX INT8")
      putString("backend", backend)
      putBoolean("gpu", false)
      putInt("threads", 4)
      putString("runtime", "parakeet-rs + ONNX Runtime 1.28 CPU")
    }
  }
  @ReactMethod fun transcribe(id: String, pcm: String, promise: Promise) = run(promise) {
    val handle = sessions[id] ?: error("Parakeet is not prepared")
    val bytes = Base64.decode(pcm, Base64.NO_WRAP)
    val result = JSONObject(nativeTranscribe(handle, bytes))
    val text = result.getString("text").trim()
    Arguments.createMap().apply {
      putString("text", text)
      putDouble("nativeMs", result.getDouble("nativeMs"))
    }
  }
  @ReactMethod fun release(id: String, promise: Promise) = run(promise) {
    sessions.remove(id)?.let { nativeFree(it) }
    null
  }
  override fun invalidate() {
    queue.execute {
      sessions.values.forEach { nativeFree(it) }; sessions.clear()
    }
    queue.shutdown()
    super.invalidate()
  }
  private external fun nativeLoad(modelPath: String): Long
  private external fun nativeBackendName(handle: Long): String
  private external fun nativeTranscribe(handle: Long, pcm: ByteArray): String
  private external fun nativeFree(handle: Long)
  companion object { init { if (Build.VERSION.SDK_INT >= 28) System.loadLibrary("lmnop_parakeet_jni") } }
}

class ParakeetSpeechPackage : ReactPackage {
  override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> = listOf(ParakeetSpeechModule(context))
  override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
