package com.ramon.lmnop

import android.app.ActivityManager
import android.content.Context
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.Process
import android.os.SystemClock
import com.facebook.react.bridge.*
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.UUID

/** Sample process CPU and resident memory once a second, matching iOS report units. */
class SpeechProfilerModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  override fun getName() = "SpeechProfiler"
  private val handler = Handler(Looper.getMainLooper())
  private val profiles = mutableMapOf<String, JSONObject>()
  private val ticker = object : Runnable {
    override fun run() {
      profiles.values.forEach { profile -> runCatching { sample(profile) } }
      if (profiles.isNotEmpty()) handler.postDelayed(this, 1000)
    }
  }
  private fun metrics(): JSONObject {
    val memory = runCatching { File("/proc/self/status").readLines() }.getOrDefault(emptyList()).firstOrNull { it.startsWith("VmRSS:") }
      ?.substringAfter(":")?.trim()?.split(Regex("\\s+"))?.firstOrNull()?.toDoubleOrNull()?.div(1024)
    return JSONObject().put("uptimeSeconds", SystemClock.elapsedRealtime() / 1000.0)
      .put("cpuSeconds", Process.getElapsedCpuTime() / 1000.0)
      .put("residentMiB", memory ?: JSONObject.NULL)
  }
  private fun sample(profile: JSONObject) {
    val value = metrics()
    val samples = profile.getJSONArray("samples")
    val previous = if (samples.length() > 0) samples.getJSONObject(samples.length() - 1) else profile.getJSONObject("baseline")
    val wall = value.getDouble("uptimeSeconds") - previous.getDouble("uptimeSeconds")
    value.put("cpuPercentOneCore", if (wall >= 0.1) 100 * (value.getDouble("cpuSeconds") - previous.getDouble("cpuSeconds")) / wall else JSONObject.NULL)
    value.put("elapsedMs", (value.getDouble("uptimeSeconds") - profile.getJSONObject("baseline").getDouble("uptimeSeconds")) * 1000)
    if (samples.length() >= 3600) samples.remove(0)
    samples.put(value)
  }
  private fun run(promise: Promise, action: () -> Any?) {
    handler.post { try { promise.resolve(action()) } catch (error: Exception) { promise.reject("profile_error", "Could not save performance metrics.", error) } }
  }
  @ReactMethod fun start(promise: Promise) = run(promise) {
    val id = UUID.randomUUID().toString()
    val memory = ActivityManager.MemoryInfo()
    (context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager).getMemoryInfo(memory)
    profiles[id] = JSONObject().put("id", id).put("baseline", metrics()).put("samples", JSONArray()).put("events", JSONArray())
      .put("metadata", JSONObject().put("machine", "${Build.MANUFACTURER} ${Build.MODEL}").put("osVersion", Build.VERSION.RELEASE)
        .put("logicalCpuCount", Runtime.getRuntime().availableProcessors()).put("physicalMemoryMiB", memory.totalMem / 1048576.0)
        .put("appVersion", BuildConfig.VERSION_NAME).put("appBuild", BuildConfig.VERSION_CODE))
    if (profiles.size == 1) handler.post(ticker)
    id
  }
  @ReactMethod fun mark(id: String, phase: String, details: ReadableMap, promise: Promise) = run(promise) {
    profiles[id]?.let { profile ->
      val events = profile.getJSONArray("events")
      if (events.length() >= 600) events.remove(0)
      val values = JSONObject(details.toHashMap())
      events.put(JSONObject().put("phase", phase).put("details", values).put("metrics", metrics()))
      for (key in listOf("model", "runtime")) if (values.has(key)) profile.getJSONObject("metadata").put(key, values.get(key))
    }
    null
  }
  private fun save(id: String, ended: Boolean): String? {
    val profile = profiles[id] ?: return null
    sample(profile)
    profile.put("ended", ended)
    val directory = File(context.cacheDir, "SpeechProfiles").apply { mkdirs() }
    val file = File(directory, "$id.json")
    file.writeText(profile.toString())
    directory.listFiles()?.sortedByDescending { it.lastModified() }?.drop(10)?.forEach { it.delete() }
    return file.toURI().toString()
  }
  @ReactMethod fun checkpoint(id: String, promise: Promise) = run(promise) { save(id, false) }
  @ReactMethod fun end(id: String, promise: Promise) = run(promise) {
    val path = save(id, true)
    profiles.remove(id)
    if (profiles.isEmpty()) handler.removeCallbacks(ticker)
    path
  }
  override fun invalidate() {
    handler.post { handler.removeCallbacks(ticker); profiles.clear() }
    super.invalidate()
  }
}
