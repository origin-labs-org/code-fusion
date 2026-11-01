//! Transcribes an audio file with the on-device recognizer, or records from
//! the microphone for a few seconds:
//!
//! ```text
//! cargo run -p zephium-voice --features file-probe --example transcribe -- sample.aiff [pl]
//! cargo run -p zephium-voice --features file-probe --example transcribe -- --mic 5 [en]
//! ```

#[cfg(target_os = "macos")]
embed_plist::embed_info_plist!("transcribe.plist");

#[cfg(target_os = "macos")]
fn main() {
    use std::sync::{mpsc, Arc, Mutex};
    use zephium_voice::{Capture, Ending, Listener, Outcome, Recognition};

    struct Print(Mutex<mpsc::Sender<Ending>>);
    impl Listener for Print {
        fn levels(&self, levels: &[f32]) {
            for level in levels {
                println!("level {}", "#".repeat((level * 40.0) as usize));
            }
        }
        fn partial(&self, text: &str) {
            println!("partial: {text}");
        }
        fn ended(&self, ending: Ending) {
            let _ = self.0.lock().unwrap().send(ending);
        }
        fn note(&self, fact: &str) {
            println!("note: {fact}");
        }
    }

    let args: Vec<String> = std::env::args().skip(1).collect();
    println!("preferred: {:?}", zephium_voice::preferred_languages());
    if args.first().map(String::as_str) == Some("--status") {
        println!("microphone: {:?}", zephium_voice::microphone_permission());
        println!("recognition: {:?}", zephium_voice::recognition_permission());
        for language in ["en", "pl", "de"] {
            println!(
                "{language}: {:?}",
                zephium_voice::on_device_locale(Some(language))
            );
        }
        return;
    }
    if args.first().map(String::as_str) == Some("--mic") {
        let seconds: u64 = args.get(1).and_then(|s| s.parse().ok()).unwrap_or(5);
        let locale = zephium_voice::on_device_locale(args.get(2).map(String::as_str));
        println!("on-device locale: {locale:?}");
        let (sender, ended) = mpsc::channel();
        let recognition = match locale {
            Some(locale) => Recognition::OnDevice { locale },
            None => Recognition::Upload,
        };
        let capture =
            Capture::start(recognition, true, Arc::new(Print(Mutex::new(sender)))).expect("start");
        let ending = ended
            .recv_timeout(std::time::Duration::from_secs(seconds))
            .ok();
        println!("ended: {ending:?}");
        match capture.finish().expect("finish") {
            Outcome::Text(text) => println!("text: {text}"),
            Outcome::Audio { wav, duration_ms } => {
                println!("audio: {} bytes, {duration_ms} ms", wav.len())
            }
            Outcome::Nothing => println!("nothing heard"),
        }
        return;
    }
    let path = args.first().expect("an audio file");
    let locale = zephium_voice::on_device_locale(args.get(1).map(String::as_str))
        .expect("no on-device locale");
    println!("on-device locale: {locale}");
    let started = std::time::Instant::now();
    let text =
        zephium_voice::transcribe_file(std::path::Path::new(path), &locale).expect("transcribe");
    println!("text ({} ms): {text}", started.elapsed().as_millis());
}

#[cfg(not(target_os = "macos"))]
fn main() {}
