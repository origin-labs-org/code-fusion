//! Closed native record-image wire and bounded metadata-free raster custody.
use super::semantic_pixel_privacy::PixelPrivacyProof;
use base64::Engine as _;
use image::{ImageEncoder, ImageFormat, ImageReader};
use std::io::{Cursor, Write};
use zephium_agentic::{
    SemanticRecordMediaPlan, WorkBrowserRecordImage, WorkBrowserRecordImageOrigin,
};

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct Crop {
    pub(crate) rect: [f64; 4],
    pub(crate) proof: PixelPrivacyProof,
}
pub(crate) enum NativeMediaResult {
    RetryableNetwork,
    PublicAsset(String),
    Unavailable(zephium_agentic::SemanticRecordMediaOutcome, u8),
    Fetched(Vec<u8>),
    Crop(Crop),
}
pub(crate) type MediaCompletion = Box<dyn FnOnce(Option<NativeMediaResult>)>;
pub(crate) struct MediaInvocation {
    wire: String,
    retry_report: bool,
    public_asset: bool,
}
impl MediaInvocation {
    pub(crate) fn new(
        plan: &SemanticRecordMediaPlan,
        validate: bool,
        fetch: MediaFetchAttempt,
    ) -> Self {
        let mut wire = plan.native_invocation();
        if validate {
            wire.replace_range(..1, "V");
        }
        if !validate && fetch.mode == 3 {
            wire.replace_range(..1, "U");
            return Self {
                wire,
                retry_report: false,
                public_asset: true,
            };
        }
        let public_asset = !validate && fetch.mode == 2;
        let retry_report = !validate && fetch.mode == 1;
        if !validate {
            use std::fmt::Write as _;
            wire.pop();
            let _ = write!(wire, ",\"q\":{}", fetch.timeout_millis);
            if fetch.mode != 0 {
                let _ = write!(wire, ",\"p\":{}", fetch.mode);
            }
            wire.push('}');
        }
        Self {
            wire,
            retry_report,
            public_asset,
        }
    }
    pub(crate) fn as_str(&self) -> &str {
        &self.wire
    }
    pub(crate) fn decode(&self, bytes: &[u8]) -> Option<NativeMediaResult> {
        if bytes.len() > 90 * 1024 {
            return None;
        }
        let value: serde_json::Value = serde_json::from_slice(bytes).ok()?;
        let object = value.as_object()?;
        if object.get("v")?.as_u64() != Some(1) {
            return None;
        }
        let status = object.get("s")?.as_str()?;
        if status == "unavailable" {
            return (object.len() == 4)
                .then(|| {
                    let code = u8::try_from(object.get("r")?.as_u64()?).ok()?;
                    let stage = u8::try_from(object.get("f")?.as_u64()?).ok()?;
                    if stage > 8 {
                        return None;
                    }
                    let reason = zephium_agentic::SemanticRecordMediaOutcome::from_code(code)?;
                    (1..=11)
                        .contains(&code)
                        .then_some(NativeMediaResult::Unavailable(reason, stage))
                })
                .flatten();
        }
        let expected: serde_json::Value = serde_json::from_str(self.wire.get(3..)?).ok()?;
        for key in ["i", "g", "k", "n"] {
            if object.get(key) != expected.get(key) {
                return None;
            }
        }
        match status {
            "public_asset" if object.len() == 7 && self.public_asset => {
                let raw = object.get("u")?.as_str()?;
                if raw.len() > 4096 {
                    return None;
                }
                let url = url::Url::parse(raw).ok()?;
                (url.scheme() == "https"
                    && url.username().is_empty()
                    && url.password().is_none()
                    && url.as_str() == raw)
                    .then(|| NativeMediaResult::PublicAsset(raw.to_owned()))
            }
            "retry" if object.len() == 6 && self.retry_report => {
                Some(NativeMediaResult::RetryableNetwork)
            }
            "fetch" if object.len() == 7 && self.wire.starts_with("M1:") => {
                let bytes = object.get("bytes")?.as_str()?;
                if bytes.len() > 87384 {
                    return None;
                }
                let bytes = base64::engine::general_purpose::STANDARD
                    .decode(bytes)
                    .ok()?;
                (!bytes.is_empty() && bytes.len() <= 65536)
                    .then_some(NativeMediaResult::Fetched(bytes))
            }
            "crop" if object.len() == 8 => {
                let proof = PixelPrivacyProof::decode(&serde_json::to_vec(object.get("p")?).ok()?)?;
                if !proof.clear() {
                    return Some(NativeMediaResult::Unavailable(
                        zephium_agentic::SemanticRecordMediaOutcome::PrivacyRefused,
                        0,
                    ));
                }
                let rect = object.get("b")?.as_object()?;
                if rect.len() != 4 {
                    return None;
                }
                let rect = [
                    rect.get("x")?.as_f64()?,
                    rect.get("y")?.as_f64()?,
                    rect.get("w")?.as_f64()?,
                    rect.get("h")?.as_f64()?,
                ];
                let (w, h) = proof.viewport();
                if !rect.iter().all(|v| v.is_finite())
                    || rect[0] < 0.0
                    || rect[1] < 0.0
                    || rect[2] < 64.0
                    || rect[3] < 48.0
                    || rect[0] + rect[2] > w
                    || rect[1] + rect[3] > h
                {
                    return None;
                }
                Some(NativeMediaResult::Crop(Crop { rect, proof }))
            }
            _ => None,
        }
    }
}
struct Sink(Vec<u8>);
impl Write for Sink {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        if self.0.len().saturating_add(bytes.len()) > 65536 {
            return Err(std::io::Error::other("media limit"));
        }
        self.0.extend_from_slice(bytes);
        Ok(bytes.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}
pub(crate) fn raster(
    plan: &SemanticRecordMediaPlan,
    bytes: Vec<u8>,
    geometry: Option<zephium_agentic::WorkBrowserCropGeometry>,
) -> Option<WorkBrowserRecordImage> {
    let origin = if geometry.is_some() {
        WorkBrowserRecordImageOrigin::NativeCrop
    } else {
        WorkBrowserRecordImageOrigin::NativeFetch
    };
    raster_with_origin(plan, bytes, geometry, origin)
}
fn raster_with_origin(
    plan: &SemanticRecordMediaPlan,
    bytes: Vec<u8>,
    geometry: Option<zephium_agentic::WorkBrowserCropGeometry>,
    origin: WorkBrowserRecordImageOrigin,
) -> Option<WorkBrowserRecordImage> {
    let limit = match origin {
        WorkBrowserRecordImageOrigin::NativeCrop => 1024 * 1024,
        WorkBrowserRecordImageOrigin::NativeFetch => 65536,
        WorkBrowserRecordImageOrigin::PublicFetch => zephium_agentic::MAX_PUBLIC_RECORD_IMAGE_BYTES,
    };
    if bytes.len() > limit {
        return None;
    }
    let mut reader = ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .ok()?;
    if !matches!(
        reader.format(),
        Some(ImageFormat::Png | ImageFormat::Jpeg | ImageFormat::WebP | ImageFormat::Gif)
    ) {
        return None;
    }
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(2048);
    limits.max_image_height = Some(2048);
    limits.max_alloc = Some(24 * 1024 * 1024);
    reader.limits(limits);
    let decoded = reader.decode().ok()?;
    for (width, height) in [(320, 240), (240, 180), (160, 120), (80, 60)] {
        let small = record_thumbnail(&decoded, width, height).to_rgba8();
        let mut sink = Sink(Vec::new());
        if image::codecs::png::PngEncoder::new(&mut sink)
            .write_image(
                small.as_raw(),
                small.width(),
                small.height(),
                image::ExtendedColorType::Rgba8,
            )
            .is_ok()
        {
            return WorkBrowserRecordImage::from_native(
                plan,
                origin,
                small.width().try_into().ok()?,
                small.height().try_into().ok()?,
                sink.0,
            )
            .map(|image| match geometry {
                Some(geometry) => image.with_crop_geometry(geometry),
                None => image,
            });
        }
    }
    None
}

pub(crate) fn raster_public(
    plan: &SemanticRecordMediaPlan,
    bytes: Vec<u8>,
) -> Option<WorkBrowserRecordImage> {
    raster_with_origin(plan, bytes, None, WorkBrowserRecordImageOrigin::PublicFetch)
}

pub(crate) struct RecordFrame {
    pub(crate) png: Vec<u8>,
    pub(crate) geometry: zephium_agentic::WorkBrowserCropGeometry,
}
pub(crate) type FrameCompletion = Box<dyn FnOnce(Option<RecordFrame>)>;
pub(crate) type FrameCapture = std::rc::Rc<dyn Fn(Crop, FrameCompletion) -> bool>;

pub(crate) type MediaDispatch =
    std::rc::Rc<dyn Fn(&SemanticRecordMediaPlan, bool, MediaFetchAttempt, MediaCompletion)>;

pub(crate) type PrivacyDispatch =
    std::rc::Rc<dyn Fn(super::semantic_pixel_privacy::PrivacyCompletion)>;

fn record_thumbnail(image: &image::DynamicImage, width: u32, height: u32) -> image::DynamicImage {
    image.thumbnail(width.min(image.width()), height.min(image.height()))
}
#[cfg(test)]
mod size_tests {
    use super::*;
    #[test]
    fn native_record_images_never_upscale_a_small_crop() {
        let small = image::DynamicImage::new_rgba8(64, 47);
        let preview = record_thumbnail(&small, 320, 240);
        assert_eq!((preview.width(), preview.height()), (64, 47));
        let wide = image::DynamicImage::new_rgba8(800, 400);
        let preview = record_thumbnail(&wide, 320, 240);
        assert_eq!((preview.width(), preview.height()), (320, 160));
    }
}

#[cfg(all(target_os = "macos", feature = "native-agentic-semantic-probe"))]
#[derive(Debug)]
pub(crate) enum ProbeStage {
    PublicAssetQueued,
    PublicAssetDenied,
    PublicAssetExpired,
    PublicAssetBytes,
    PublicAssetUnavailable,
    PublicAssetVerified,
    PublicAssetUnverified,
    PublicAssetRasterRejected,
    OwnerNotReady,
    InvalidPlanCount,
    SourceNotCurrent,
    AdmissionRefused,
    PresentationRefused,
    Admitted,
    Dispatched,
    CurrentLost,
    Fetched,
    Crop,
    Unavailable,
    TransportUnknown,
    CropPermissionMissing,
}
#[cfg(all(target_os = "macos", feature = "native-agentic-semantic-probe"))]
#[allow(clippy::print_stderr)]
pub(crate) fn probe_stage(stage: ProbeStage) {
    if crate::platform::macos::media_diagnostics_enabled() {
        eprintln!("record-media-stage: {stage:?} content=redacted");
    }
}

/// Engine-private attempt operands; model/protocol callers cannot mint retry state.
#[derive(Clone, Copy)]
pub(crate) struct MediaFetchAttempt {
    mode: u8,
    timeout_millis: u16,
}
impl MediaFetchAttempt {
    pub(crate) fn public_validation() -> Self {
        Self {
            mode: 3,
            timeout_millis: 1,
        }
    }

    pub(crate) const fn validation() -> Self {
        Self {
            mode: 0,
            timeout_millis: 1500,
        }
    }
}
pub(crate) struct MediaRetryWindow {
    deadline: std::time::Instant,
    eligible: bool,
    initial_sent: bool,
    retry_decided: bool,
}
impl MediaRetryWindow {
    pub(crate) fn new(
        now: std::time::Instant,
        remaining: std::time::Duration,
        eligible: bool,
    ) -> Self {
        Self {
            deadline: now + remaining.min(std::time::Duration::from_millis(1500)),
            eligible,
            initial_sent: false,
            retry_decided: false,
        }
    }
    pub(crate) fn active(&self, now: std::time::Instant) -> bool {
        now < self.deadline
    }
    pub(crate) fn remaining(&self, now: std::time::Instant) -> Option<u16> {
        let millis = self.deadline.saturating_duration_since(now).as_millis();
        (millis > 0).then_some(millis.min(1500) as u16)
    }
    pub(crate) fn initial(&mut self, now: std::time::Instant) -> Option<MediaFetchAttempt> {
        if self.initial_sent {
            return None;
        }
        self.initial_sent = true;
        Some(MediaFetchAttempt {
            mode: u8::from(self.eligible),
            timeout_millis: self.remaining(now)?,
        })
    }
    pub(crate) fn retry(
        &mut self,
        now: std::time::Instant,
        current: bool,
    ) -> Option<MediaFetchAttempt> {
        if self.retry_decided {
            return None;
        }
        self.retry_decided = true;
        if !self.initial_sent || !self.eligible || !current {
            return None;
        }
        Some(MediaFetchAttempt {
            mode: 2,
            timeout_millis: self.remaining(now)?,
        })
    }
}

#[cfg(test)]
mod retry_tests {
    use super::*;
    use std::time::{Duration, Instant};
    #[test]
    fn native_media_refusals_are_closed_and_privacy_never_permits_fallback() {
        use zephium_agentic::SemanticRecordMediaOutcome as O;
        let request = MediaInvocation {
            wire: "M1:{\"i\":1,\"g\":2,\"k\":3,\"n\":4}".into(),
            retry_report: false,
            public_asset: false,
        };
        for code in 1..=11 {
            let body = format!("{{\"v\":1,\"s\":\"unavailable\",\"r\":{code},\"f\":0}}");
            let Some(NativeMediaResult::Unavailable(reason, stage)) =
                request.decode(body.as_bytes())
            else {
                panic!()
            };
            assert_eq!(stage, 0);
            assert_eq!(reason, O::from_code(code).unwrap());
            if code == 9 || code == 10 {
                assert!(!reason.permits_public_candidate());
            }
        }
        for body in [
            r#"{"v":1,"s":"unavailable","r":0}"#,
            r#"{"v":1,"s":"unavailable","r":12}"#,
            r#"{"v":1,"s":"unavailable","r":"page content"}"#,
        ] {
            assert!(request.decode(body.as_bytes()).is_none());
        }
    }
    #[test]
    fn public_asset_wire_requires_original_source_coordinates_and_explicit_retry_mode() {
        let body=br#"{"v":1,"s":"public_asset","i":1,"g":2,"k":3,"n":4,"u":"https://cdn.example.com/photo.png"}"#;
        for allowed in [false, true] {
            let request = MediaInvocation {
                wire: "U1:{\"i\":1,\"g\":2,\"k\":3,\"n\":4}".into(),
                retry_report: false,
                public_asset: allowed,
            };
            assert_eq!(
                matches!(
                    request.decode(body),
                    Some(NativeMediaResult::PublicAsset(_))
                ),
                allowed
            );
            for (from, to) in [
                ("\"n\":4", "\"n\":5"),
                ("https://cdn.example.com", "http://cdn.example.com"),
                (
                    "https://cdn.example.com",
                    "https://user:secret@cdn.example.com",
                ),
            ] {
                assert!(request
                    .decode(String::from_utf8_lossy(body).replace(from, to).as_bytes())
                    .is_none());
            }
        }
    }
    #[test]
    fn public_asset_retry_spends_only_original_remaining_time_once() {
        let start = Instant::now();
        let mut window = MediaRetryWindow::new(start, Duration::from_secs(8), true);
        let first = window.initial(start).unwrap();
        assert_eq!((first.mode, first.timeout_millis), (1, 1500));
        assert!(window.initial(start).is_none());
        let retry = window
            .retry(start + Duration::from_millis(400), true)
            .unwrap();
        assert_eq!((retry.mode, retry.timeout_millis), (2, 1100));
        assert!(window
            .retry(start + Duration::from_millis(500), true)
            .is_none());
        assert!(window.active(start + Duration::from_millis(1499)));
        assert!(!window.active(start + Duration::from_millis(1500)));
    }
    #[test]
    fn stop_or_source_loss_between_callbacks_cannot_dispatch_a_retry() {
        let start = Instant::now();
        for eligible in [false, true] {
            let mut window = MediaRetryWindow::new(start, Duration::from_millis(900), eligible);
            assert!(window.initial(start).is_some());
            let mut dispatched = 0;
            if window
                .retry(start + Duration::from_millis(10), false)
                .is_some()
            {
                dispatched += 1;
            }
            assert_eq!(dispatched, 0);
            // Admission cannot heal after its one decision has been refused.
            assert!(window
                .retry(start + Duration::from_millis(11), true)
                .is_none());
        }
    }
    #[test]
    fn private_expired_and_shorter_resource_deadlines_never_gain_retry_time() {
        let start = Instant::now();
        let mut private = MediaRetryWindow::new(start, Duration::from_secs(8), false);
        assert_eq!(private.initial(start).unwrap().mode, 0);
        assert!(private.retry(start, true).is_none());
        for millis in [0, 1, 700, 1500] {
            let mut window = MediaRetryWindow::new(start, Duration::from_millis(millis), true);
            let first = window.initial(start);
            assert_eq!(first.is_some(), millis > 0);
            if let Some(first) = first {
                assert_eq!(first.timeout_millis, u16::try_from(millis).unwrap());
            }
            assert!(window
                .retry(start + Duration::from_millis(millis), true)
                .is_none());
        }
    }
    #[test]
    fn only_original_eligible_fetch_accepts_exact_retryable_network_ack() {
        let response = br#"{"v":1,"s":"retry","i":1,"g":2,"k":3,"n":4}"#;
        for report in [false, true] {
            let invocation = MediaInvocation {
                wire: "M1:{\"i\":1,\"g\":2,\"k\":3,\"n\":4,\"q\":1000}".into(),
                retry_report: report,
                public_asset: false,
            };
            assert_eq!(
                matches!(
                    invocation.decode(response),
                    Some(NativeMediaResult::RetryableNetwork)
                ),
                report
            );
            assert!(invocation
                .decode(br#"{"v":1,"s":"retry","i":1,"g":2,"k":3,"n":99}"#)
                .is_none());
        }
    }
}
