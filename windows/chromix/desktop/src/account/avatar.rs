//! The account picture: picked natively, framed by the person in chrome, then
//! cropped, encoded and uploaded here. Chrome only ever sees image bytes that
//! `zephium-media` serves; never the service's address for them or the bearer.
use super::*;
use image::imageops::FilterType;
use image::{DynamicImage, ImageDecoder, ImageFormat};
use std::borrow::Cow;
use tauri_plugin_dialog::DialogExt;

const MAX_PICKED_BYTES: u64 = 32 * 1024 * 1024;
const MAX_SOURCE_SIDE: u32 = 12_000;
const MAX_DECODE_ALLOC_BYTES: u64 = 512 * 1024 * 1024;
/// The framing step works on a copy this size, which still leaves a full
/// upload-sized square at the step's deepest zoom.
const WORKING_SIDE: u32 = 1600;
/// The service keeps 256px; sending twice that leaves its resize the last word.
const UPLOAD_SIDE: u32 = 512;
const MIN_CROP_SIDE: u32 = 32;
const MAX_TOKEN_BYTES: usize = 64;

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub(crate) enum AccountAvatarPickV1 {
    /// Staged under `token`; `width` and `height` are the preview's pixels,
    /// which the framing is stated in.
    Picked {
        token: String,
        width: u32,
        height: u32,
    },
    Cancelled,
    /// Not a still PNG, JPEG or WebP picture that could be read.
    Unsupported,
    Unavailable,
}

/// The square the person framed, in the preview's pixels.
#[derive(Clone, Copy, Debug, Deserialize, specta::Type)]
pub(crate) struct AccountAvatarCropV1 {
    x: u32,
    y: u32,
    side: u32,
}

struct Staged {
    token: String,
    image: Arc<DynamicImage>,
    preview: Arc<Vec<u8>>,
}

/// One pick at a time: a newer one replaces a picture not yet saved.
static STAGED: Mutex<Option<Staged>> = Mutex::new(None);

fn staged() -> std::sync::MutexGuard<'static, Option<Staged>> {
    STAGED
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

fn unstage(token: &str) {
    let mut held = staged();
    if held.as_ref().is_some_and(|held| held.token == token) {
        *held = None;
    }
}

/// A picked picture, upright and shrunk to the working size. Only still
/// PNG, JPEG and WebP are taken, as the service takes; the rest is refused.
fn working_copy(bytes: &[u8]) -> Option<DynamicImage> {
    let format = image::guess_format(bytes).ok()?;
    if !matches!(
        format,
        ImageFormat::Png | ImageFormat::Jpeg | ImageFormat::WebP
    ) {
        return None;
    }
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(MAX_SOURCE_SIDE);
    limits.max_image_height = Some(MAX_SOURCE_SIDE);
    limits.max_alloc = Some(MAX_DECODE_ALLOC_BYTES);
    let mut reader = image::ImageReader::with_format(std::io::Cursor::new(bytes), format);
    reader.limits(limits);
    let mut decoder = reader.into_decoder().ok()?;
    let orientation = decoder.orientation().ok();
    let mut decoded = DynamicImage::from_decoder(decoder).ok()?;
    if let Some(orientation) = orientation {
        decoded.apply_orientation(orientation);
    }
    if decoded.width() == 0 || decoded.height() == 0 {
        return None;
    }
    Some(if decoded.width().max(decoded.height()) > WORKING_SIDE {
        decoded.resize(WORKING_SIDE, WORKING_SIDE, FilterType::Triangle)
    } else {
        decoded
    })
}

/// PNG where the picture is see-through anywhere, JPEG otherwise.
fn encode(image: &DynamicImage) -> Option<Vec<u8>> {
    let mut out = Vec::new();
    let translucent =
        image.color().has_alpha() && image.to_rgba8().pixels().any(|pixel| pixel.0[3] < 255);
    if translucent {
        image
            .write_to(&mut std::io::Cursor::new(&mut out), ImageFormat::Png)
            .ok()?;
    } else {
        image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, 90)
            .encode_image(&image.to_rgb8())
            .ok()?;
    }
    Some(out)
}

/// The person's square, cut from the working copy and sized for upload.
fn framed(image: &DynamicImage, crop: AccountAvatarCropV1) -> Option<Vec<u8>> {
    let side = crop.side;
    if side < MIN_CROP_SIDE
        || crop.x.checked_add(side)? > image.width()
        || crop.y.checked_add(side)? > image.height()
    {
        return None;
    }
    let target = UPLOAD_SIDE.min(side);
    let square = image.crop_imm(crop.x, crop.y, side, side).resize_exact(
        target,
        target,
        FilterType::Lanczos3,
    );
    encode(&square).filter(|bytes| bytes.len() <= zephium_account::MAX_AVATAR_UPLOAD_BYTES)
}

/// Opens the system's picker and stages the picture for framing.
#[tauri::command]
#[specta::specta]
pub(crate) async fn account_avatar_pick(
    caller: WebviewWindow,
    app: tauri::AppHandle,
) -> Result<AccountAvatarPickV1, ()> {
    let signed_in = admitted(&caller, "account_avatar_pick").is_ok_and(|s| s.signed_in());
    if !signed_in || shutdown_started(&app) {
        return Ok(AccountAvatarPickV1::Unavailable);
    }
    let picker = app.clone();
    let picked = tokio::task::spawn_blocking(move || {
        picker
            .dialog()
            .file()
            .set_title("Choose a Photo")
            .add_filter("Images", &["png", "jpg", "jpeg", "webp"])
            .blocking_pick_file()
    })
    .await
    .map_err(|_| ())?;
    let Some(picked) = picked else {
        return Ok(AccountAvatarPickV1::Cancelled);
    };
    let Ok(path) = picked.into_path() else {
        return Ok(AccountAvatarPickV1::Unsupported);
    };
    let prepared = tokio::task::spawn_blocking(move || {
        let metadata = std::fs::metadata(&path).ok()?;
        if !metadata.is_file() || metadata.len() > MAX_PICKED_BYTES {
            return None;
        }
        let image = working_copy(&std::fs::read(&path).ok()?)?;
        let preview = encode(&image)?;
        Some((image, preview))
    })
    .await
    .map_err(|_| ())?;
    let Some((image, preview)) = prepared else {
        return Ok(AccountAvatarPickV1::Unsupported);
    };
    let token = zephium_core::ids::ProfileId::generate().to_string();
    let (width, height) = (image.width(), image.height());
    *staged() = Some(Staged {
        token: token.clone(),
        image: Arc::new(image),
        preview: Arc::new(preview),
    });
    Ok(AccountAvatarPickV1::Picked {
        token,
        width,
        height,
    })
}

/// Uploads the framed square of the staged picture as the account's picture.
#[tauri::command]
#[specta::specta]
pub(crate) async fn account_avatar_save(
    caller: WebviewWindow,
    token: String,
    crop: AccountAvatarCropV1,
) -> AccountReplyV1 {
    let service = match admitted(&caller, "account_avatar_save") {
        Ok(service) => service,
        Err(error) => return reply(Err(error)),
    };
    let image = staged()
        .as_ref()
        .filter(|held| held.token == token)
        .map(|held| held.image.clone());
    let Some(image) = image else {
        return reply(Err(AccountError::AvatarInvalid));
    };
    let bytes = tokio::task::spawn_blocking(move || framed(&image, crop))
        .await
        .ok()
        .flatten();
    let result = match bytes {
        Some(bytes) => service.upload_avatar(&bytes).await,
        None => Err(AccountError::AvatarInvalid),
    };
    if result.is_ok() {
        unstage(&token);
    }
    log("avatar_save", &result);
    reply(result)
}

/// Puts a staged picture away, and stops its upload if one is under way.
#[tauri::command]
#[specta::specta]
pub(crate) fn account_avatar_discard(caller: WebviewWindow, token: String) -> AccountReplyV1 {
    let result = admitted(&caller, "account_avatar_discard").map(|service| {
        if token.len() <= MAX_TOKEN_BYTES {
            unstage(&token);
        }
        service.cancel_avatar_upload();
    });
    reply(result)
}

/// Removes the account's picture everywhere it is signed in.
#[tauri::command]
#[specta::specta]
pub(crate) async fn account_avatar_remove(caller: WebviewWindow) -> AccountReplyV1 {
    let result = match admitted(&caller, "account_avatar_remove") {
        Ok(service) => service.remove_avatar().await,
        Err(error) => Err(error),
    };
    log("avatar_remove", &result);
    reply(result)
}

fn respond(status: u16, body: Vec<u8>) -> tauri::http::Response<Cow<'static, [u8]>> {
    let content_type = if body.starts_with(b"\x89PNG") {
        "image/png"
    } else if body.starts_with(&[0xff, 0xd8]) {
        "image/jpeg"
    } else if body.starts_with(b"RIFF") {
        "image/webp"
    } else {
        "text/plain"
    };
    tauri::http::Response::builder()
        .status(status)
        .header("Content-Type", content_type)
        .header("X-Content-Type-Options", "nosniff")
        // Nothing of the account is left in the webview's cache to outlive a sign-out.
        .header("Cache-Control", "no-store")
        .header("Content-Security-Policy", "default-src 'none'; sandbox")
        .body(Cow::Owned(body))
        .unwrap_or_else(|_| tauri::http::Response::new(Cow::Borrowed(b"" as &[u8])))
}

/// `account-avatar/<revision>` serves the signed-in account's picture while
/// that revision is current; `account-avatar/staged/<token>` serves a pick
/// being framed.
pub(crate) fn serve(rest: &str) -> tauri::http::Response<Cow<'static, [u8]>> {
    let missing = || respond(404, Vec::new());
    if let Some(token) = rest.strip_prefix("staged/") {
        let preview = staged()
            .as_ref()
            .filter(|held| held.token == token)
            .map(|held| held.preview.clone());
        return preview.map_or_else(missing, |bytes| respond(200, bytes.as_ref().clone()));
    }
    let image = rest
        .parse::<u32>()
        .ok()
        .and_then(|revision| service()?.avatar_image(revision));
    image.map_or_else(missing, |bytes| respond(200, bytes.as_ref().clone()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn encoded(width: u32, height: u32, format: ImageFormat, alpha: u8) -> Vec<u8> {
        let image = image::RgbaImage::from_fn(width, height, |x, y| {
            image::Rgba([(x * 7) as u8, (y * 5) as u8, ((x ^ y) * 3) as u8, alpha])
        });
        let image = if format == ImageFormat::Jpeg {
            DynamicImage::ImageRgb8(DynamicImage::ImageRgba8(image).to_rgb8())
        } else {
            DynamicImage::ImageRgba8(image)
        };
        let mut out = Vec::new();
        image
            .write_to(&mut std::io::Cursor::new(&mut out), format)
            .unwrap();
        out
    }

    #[test]
    fn only_still_png_jpeg_and_webp_are_taken_and_large_ones_are_shrunk_to_frame() {
        let big = working_copy(&encoded(3200, 1800, ImageFormat::Png, 255)).unwrap();
        assert_eq!((big.width(), big.height()), (1600, 900));
        let small = working_copy(&encoded(300, 200, ImageFormat::Jpeg, 255)).unwrap();
        assert_eq!((small.width(), small.height()), (300, 200));
        assert!(working_copy(&encoded(64, 64, ImageFormat::WebP, 255)).is_some());
        assert!(working_copy(&encoded(64, 64, ImageFormat::Gif, 255)).is_none());
        assert!(working_copy(b"<svg xmlns='http://www.w3.org/2000/svg'/>").is_none());
        assert!(working_copy(&encoded(64, 64, ImageFormat::Png, 255)[..40]).is_none());
    }

    #[test]
    fn the_framed_square_is_cut_where_the_person_put_it_and_sent_small() {
        let image = working_copy(&encoded(1600, 900, ImageFormat::Png, 255)).unwrap();
        let bytes = framed(
            &image,
            AccountAvatarCropV1 {
                x: 700,
                y: 0,
                side: 900,
            },
        )
        .unwrap();
        assert!(bytes.starts_with(&[0xff, 0xd8, 0xff]));
        let sent = image::load_from_memory(&bytes).unwrap();
        assert_eq!((sent.width(), sent.height()), (512, 512));

        let tiny = framed(
            &image,
            AccountAvatarCropV1 {
                x: 0,
                y: 0,
                side: 100,
            },
        )
        .unwrap();
        assert_eq!(image::load_from_memory(&tiny).unwrap().width(), 100);

        for outside in [
            AccountAvatarCropV1 {
                x: 701,
                y: 0,
                side: 900,
            },
            AccountAvatarCropV1 {
                x: 0,
                y: 1,
                side: 900,
            },
            AccountAvatarCropV1 {
                x: 0,
                y: 0,
                side: 8,
            },
            AccountAvatarCropV1 {
                x: u32::MAX,
                y: 0,
                side: 900,
            },
        ] {
            assert!(framed(&image, outside).is_none(), "{outside:?}");
        }
    }

    #[test]
    fn a_see_through_picture_stays_png() {
        let image = working_copy(&encoded(200, 200, ImageFormat::Png, 120)).unwrap();
        let bytes = framed(
            &image,
            AccountAvatarCropV1 {
                x: 0,
                y: 0,
                side: 200,
            },
        )
        .unwrap();
        assert!(bytes.starts_with(b"\x89PNG"));
    }
}
