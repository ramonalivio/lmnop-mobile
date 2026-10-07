package com.ramon.lmnop

import android.content.Context
import android.view.WindowInsets
import android.view.inputmethod.InputMethodManager
import com.facebook.react.bridge.*
import com.facebook.react.uimanager.UIManagerHelper
import com.facebook.react.views.textinput.ReactEditText

/** Modal autofocus can run before its dialog owns window focus. */
class TranscriptKeyboardModule(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  override fun getName() = "TranscriptKeyboard"
  @ReactMethod fun show(tag: Double) {
    UiThreadUtil.runOnUiThread {
      val editor = UIManagerHelper.getUIManagerForReactTag(reactApplicationContext, tag.toInt())
        ?.resolveView(tag.toInt()) as? ReactEditText ?: return@runOnUiThread
      fun showWhenReady(attempt: Int) {
        if (!editor.isAttachedToWindow) return
        if (!editor.hasWindowFocus()) {
          if (attempt < 20) editor.postDelayed({ showWhenReady(attempt + 1) }, 50)
          return
        }
        editor.showSoftInputOnFocus = true
        editor.requestFocusFromJS()
        // Explicitly show even when a hardware keyboard puts Android outside touch mode.
        (editor.context.getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager)
          .showSoftInput(editor, InputMethodManager.SHOW_IMPLICIT)
        if (android.os.Build.VERSION.SDK_INT >= 30)
          editor.windowInsetsController?.show(WindowInsets.Type.ime())
      }
      editor.post { showWhenReady(0) }
    }
  }
}
