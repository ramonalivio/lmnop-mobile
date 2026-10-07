package com.ramon.lmnop

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.File

class CsvFileModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = "CsvFile"

  @ReactMethod
  fun writeQuestionnaireAnswers(csvContent: String, promise: Promise) {
    try {
      val file = questionnaireFile()
      file.writeText(csvContent, Charsets.UTF_8)
      promise.resolve(file.absolutePath)
    } catch (error: Exception) {
      promise.reject("csv_write_failed", "Could not write questionnaire CSV.", error)
    }
  }

  @ReactMethod
  fun readQuestionnaireAnswers(promise: Promise) {
    val file = questionnaireFile()

    if (!file.exists()) {
      promise.resolve(null)
      return
    }

    try {
      promise.resolve(file.readText(Charsets.UTF_8))
    } catch (error: Exception) {
      promise.reject("csv_read_failed", "Could not read questionnaire CSV.", error)
    }
  }

  @ReactMethod
  fun getQuestionnaireAnswersPath(promise: Promise) {
    val file = questionnaireFile()

    promise.resolve(if (file.exists()) file.absolutePath else null)
  }

  private fun questionnaireFile(): File =
      File(reactContext.filesDir, "questionnaire-answers.csv")
}
