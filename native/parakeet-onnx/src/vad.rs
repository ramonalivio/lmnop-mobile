use ort::{session::Session, value::Tensor};
use std::{ffi::{c_char, CStr}, panic::{catch_unwind, AssertUnwindSafe}};

pub struct Vad {
    model: Session,
    state: Vec<f32>,
    context: Vec<f32>,
}
impl Vad {
    fn run(&mut self, samples: &[f32]) -> Result<f32, ort::Error> {
        let mut input = self.context.clone();
        input.extend_from_slice(samples);
        let output = self.model.run(ort::inputs![
            "input" => Tensor::from_array(([1usize, 576], input))?,
            "state" => Tensor::from_array(([2usize, 1, 128], self.state.clone()))?,
            "sr" => Tensor::from_array((Vec::<usize>::new(), vec![16000i64]))?
        ])?;
        let probability = output["output"].try_extract_tensor::<f32>()?.1[0];
        self.state = output["stateN"].try_extract_tensor::<f32>()?.1.to_vec();
        self.context.copy_from_slice(&samples[448..]);
        Ok(probability)
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn lmnop_vad_open(path: *const c_char, error: *mut *mut c_char) -> *mut Vad {
    let result = catch_unwind(|| -> Result<Vad, String> {
        let path = unsafe { CStr::from_ptr(path) }.to_str().map_err(|e| e.to_string())?;
        let mut builder = Session::builder().map_err(|e| e.to_string())?
            .with_intra_threads(1).map_err(|e| e.to_string())?
            .with_inter_threads(1).map_err(|e| e.to_string())?;
        let model = builder.commit_from_file(path).map_err(|e| e.to_string())?;
        Ok(Vad { model, state: vec![0.; 256], context: vec![0.; 64] })
    });
    match result {
        Ok(Ok(vad)) => Box::into_raw(Box::new(vad)),
        failure => { unsafe { *error = super::message(match failure { Ok(Err(e)) => e, _ => "VAD initialization panicked".into() }); } std::ptr::null_mut() }
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn lmnop_vad_run(raw: *mut Vad, audio: *const f32, count: usize, error: *mut *mut c_char) -> f32 {
    let result = catch_unwind(AssertUnwindSafe(|| -> Result<f32, String> {
        if count != 512 || audio.is_null() { return Err("VAD requires 512 samples".into()); }
        let vad = unsafe { raw.as_mut() }.ok_or("Invalid VAD session")?;
        vad.run(unsafe { std::slice::from_raw_parts(audio, count) }).map_err(|e| e.to_string())
    }));
    match result {
        Ok(Ok(p)) => p,
        failure => { unsafe { *error = super::message(match failure { Ok(Err(e)) => e, _ => "VAD inference panicked".into() }); } -1. }
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn lmnop_vad_close(raw: *mut Vad) {
    if !raw.is_null() { let _ = catch_unwind(AssertUnwindSafe(|| unsafe { drop(Box::from_raw(raw)); })); }
}
