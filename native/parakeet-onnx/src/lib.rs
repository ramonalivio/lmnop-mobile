use parakeet_rs::{ExecutionConfig, ParakeetTDT, Transcriber};
use std::{ffi::{c_char, CStr, CString}, panic::{catch_unwind, AssertUnwindSafe}, time::Instant};
fn message(text: String) -> *mut c_char {
    CString::new(text.replace('\0', " ")).unwrap().into_raw()
}
// The Kotlin module serializes access to each handle. Never unwind across JNI.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn lmnop_parakeet_open(path: *const c_char, error: *mut *mut c_char) -> *mut ParakeetTDT {
    let result = catch_unwind(|| {
        let path = unsafe { CStr::from_ptr(path) }.to_str().map_err(|e| e.to_string())?;
        ParakeetTDT::from_pretrained(path, Some(ExecutionConfig::new().with_intra_threads(4).with_inter_threads(1)))
            .map_err(|e| e.to_string())
    });
    match result {
        Ok(Ok(model)) => Box::into_raw(Box::new(model)),
        failure => { unsafe { *error = message(match failure { Ok(Err(e)) => e, _ => "Parakeet initialization panicked".into() }); } std::ptr::null_mut() }
    }
}
#[unsafe(no_mangle)]
pub unsafe extern "C" fn lmnop_parakeet_run(raw: *mut ParakeetTDT, audio: *const f32, count: usize, error: *mut *mut c_char) -> *mut c_char {
    let result = catch_unwind(AssertUnwindSafe(|| {
        let model = unsafe { raw.as_mut() }.ok_or("Invalid Parakeet session")?;
        let samples = unsafe { std::slice::from_raw_parts(audio, count) }.to_vec();
        let start = Instant::now();
        let result = model.transcribe_samples(samples, 16000, 1, None).map_err(|e| e.to_string())?;
        Ok::<_, String>(serde_json::json!({"text":result.text,"nativeMs":start.elapsed().as_secs_f64()*1000.0}).to_string())
    }));
    match result {
        Ok(Ok(text)) => message(text),
        failure => { unsafe { *error = message(match failure { Ok(Err(e)) => e, _ => "Parakeet inference panicked".into() }); } std::ptr::null_mut() }
    }
}
#[unsafe(no_mangle)]
pub unsafe extern "C" fn lmnop_parakeet_close(raw: *mut ParakeetTDT) {
    if !raw.is_null() { let _ = catch_unwind(AssertUnwindSafe(|| unsafe { drop(Box::from_raw(raw)); })); }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn lmnop_parakeet_string_free(raw: *mut c_char) {
    if !raw.is_null() { unsafe { drop(CString::from_raw(raw)); } }
}
