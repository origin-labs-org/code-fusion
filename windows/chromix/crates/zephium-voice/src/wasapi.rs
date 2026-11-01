//! Windows: shared-mode WASAPI capture from the default microphone, converted
//! by the audio engine to 16 kHz mono float. There is no on-device
//! recognizer here; takes are uploaded.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc};
use std::thread::JoinHandle;
use std::time::Duration;

use windows::core::HRESULT;
use windows::Win32::Media::Audio::{
    eCapture, eConsole, IAudioCaptureClient, IAudioClient, IMMDeviceEnumerator, MMDeviceEnumerator,
    AUDCLNT_BUFFERFLAGS_SILENT, AUDCLNT_SHAREMODE_SHARED, AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM,
    AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY, WAVEFORMATEX,
};
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_ALL, COINIT_MULTITHREADED,
};

use crate::{Core, Fault, Listener, Outcome, Recognition, SPEECH_RATE};

const WAVE_FORMAT_IEEE_FLOAT: u16 = 3;
const E_ACCESSDENIED: HRESULT = HRESULT(0x8007_0005_u32 as i32);
/// One second of engine buffer, in 100 ns units.
const BUFFER: i64 = 10_000_000;
const POLL: Duration = Duration::from_millis(20);

pub(crate) struct Capture {
    core: Arc<Core>,
    stop: Arc<AtomicBool>,
    worker: Option<JoinHandle<()>>,
}

fn fault(error: windows::core::Error) -> Fault {
    if error.code() == E_ACCESSDENIED {
        Fault::MicrophoneDenied
    } else {
        Fault::NoMicrophone
    }
}

struct Com;
impl Com {
    fn enter() -> Result<Self, Fault> {
        // SAFETY: balanced by `Drop` on this same thread.
        unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) }
            .ok()
            .map_err(|_| Fault::NoMicrophone)?;
        Ok(Self)
    }
}
impl Drop for Com {
    fn drop(&mut self) {
        // SAFETY: pairs the successful initialization above.
        unsafe { CoUninitialize() };
    }
}

fn open() -> Result<(IAudioClient, IAudioCaptureClient), Fault> {
    let format = WAVEFORMATEX {
        wFormatTag: WAVE_FORMAT_IEEE_FLOAT,
        nChannels: 1,
        nSamplesPerSec: SPEECH_RATE,
        nAvgBytesPerSec: SPEECH_RATE * 4,
        nBlockAlign: 4,
        wBitsPerSample: 32,
        cbSize: 0,
    };
    // SAFETY: COM is initialized on this thread; every interface is used and
    // released here. The format outlives the Initialize call that reads it.
    unsafe {
        let devices: IMMDeviceEnumerator =
            CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL).map_err(fault)?;
        let device = devices
            .GetDefaultAudioEndpoint(eCapture, eConsole)
            .map_err(fault)?;
        let client: IAudioClient = device.Activate(CLSCTX_ALL, None).map_err(fault)?;
        client
            .Initialize(
                AUDCLNT_SHAREMODE_SHARED,
                AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM | AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY,
                BUFFER,
                0,
                &format,
                None,
            )
            .map_err(fault)?;
        let capture: IAudioCaptureClient = client.GetService().map_err(fault)?;
        client.Start().map_err(fault)?;
        Ok((client, capture))
    }
}

/// Drains every packet ready now. `false` when the device went away.
fn drain(capture: &IAudioCaptureClient, core: &Core, scratch: &mut Vec<f32>) -> bool {
    loop {
        // SAFETY: the capture client is live on this thread; each GetBuffer
        // is paired with ReleaseBuffer before the next.
        unsafe {
            let Ok(size) = capture.GetNextPacketSize() else {
                return false;
            };
            if size == 0 {
                return true;
            }
            let mut data = std::ptr::null_mut();
            let mut frames = 0_u32;
            let mut flags = 0_u32;
            if capture
                .GetBuffer(&mut data, &mut frames, &mut flags, None, None)
                .is_err()
            {
                return false;
            }
            scratch.clear();
            if flags & (AUDCLNT_BUFFERFLAGS_SILENT.0 as u32) != 0 || data.is_null() {
                scratch.resize(frames as usize, 0.0);
            } else {
                // The stream was initialized as mono 32-bit float.
                scratch.extend_from_slice(std::slice::from_raw_parts(
                    data.cast::<f32>(),
                    frames as usize,
                ));
            }
            let _ = capture.ReleaseBuffer(frames);
        }
        core.push(scratch);
    }
}

impl Capture {
    pub(crate) fn start(
        recognition: Recognition,
        pause: bool,
        listener: Arc<dyn Listener>,
    ) -> Result<Self, Fault> {
        if recognition != Recognition::Upload {
            return Err(Fault::LanguageUnavailable);
        }
        let core = Arc::new(Core::new(f64::from(SPEECH_RATE), true, pause, listener));
        let stop = Arc::new(AtomicBool::new(false));
        let (ready, opened) = mpsc::sync_channel(1);
        let worker_core = core.clone();
        let worker_stop = stop.clone();
        let worker = std::thread::Builder::new()
            .name("zephium-voice".into())
            .spawn(move || {
                let com = match Com::enter() {
                    Ok(com) => com,
                    Err(error) => {
                        let _ = ready.send(Err(error));
                        return;
                    }
                };
                let (client, capture) = match open() {
                    Ok(opened) => opened,
                    Err(error) => {
                        let _ = ready.send(Err(error));
                        return;
                    }
                };
                let _ = ready.send(Ok(()));
                let mut scratch = Vec::new();
                while !worker_stop.load(Ordering::Acquire) {
                    if !drain(&capture, &worker_core, &mut scratch) {
                        worker_core.listener().ended(crate::Ending::Lost);
                        break;
                    }
                    std::thread::sleep(POLL);
                }
                // SAFETY: stopping the client this thread started.
                let _ = unsafe { client.Stop() };
                drop((capture, client));
                drop(com);
            })
            .map_err(|_| Fault::NoMicrophone)?;
        match opened.recv() {
            Ok(Ok(())) => Ok(Self {
                core,
                stop,
                worker: Some(worker),
            }),
            Ok(Err(error)) => {
                let _ = worker.join();
                Err(error)
            }
            Err(_) => {
                let _ = worker.join();
                Err(Fault::NoMicrophone)
            }
        }
    }

    fn release(&mut self) {
        self.stop.store(true, Ordering::Release);
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }

    pub(crate) fn finish(mut self) -> Result<Outcome, Fault> {
        self.release();
        let (take, heard) = self.core.stop();
        Ok(Core::upload(take, heard))
    }

    pub(crate) fn cancel(mut self) {
        self.release();
        self.core.stop();
    }
}

impl Drop for Capture {
    fn drop(&mut self) {
        self.release();
    }
}
