package com.ramon.lmnop

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class AppInfoModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {
  override fun getName(): String = "AppInfo"

  @ReactMethod
  fun getVersion(promise: Promise) {
    val version = Arguments.createMap()

    version.putString("versionName", BuildConfig.VERSION_NAME)
    version.putString("versionCode", BuildConfig.VERSION_CODE.toString())
    promise.resolve(version)
  }
}
