//! Local synthetic record pictures: verify stored pixels without exporting them.
use super::*;
use zephium_core::work::{
    artifact::WorkArtifactDataV1,
    collection::{WorkBrowseCollection, WorkBrowseColumn, WorkBrowseExtraction, WorkBrowseValue},
    media::{WorkRecordMediaOriginV1, WorkRecordMediaRefV1, MAX_RECORD_MEDIA_BYTES},
    port::WorkReply,
};

#[path = "work_site_media_record.rs"]
mod record_fixture;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) enum Scenario {
    Mixed,
    Anonymous,
    Held,
    Canvas,
    Record,
}

const PREFIX: &str = "/media-fixture/";
const WIDTH: u32 = 128;
const HEIGHT: u32 = 96;
const NAMES: [&str; 7] = [
    "Ruby card",
    "Lime card",
    "Blue card",
    "Amber card",
    "Magenta card",
    "Cyan card",
    "Purple card",
];
const COLORS: [[u8; 3]; 7] = [
    [224, 32, 48],
    [32, 208, 64],
    [40, 72, 224],
    [240, 176, 24],
    [208, 40, 192],
    [24, 192, 208],
    [112, 48, 208],
];

fn png(index: usize) -> Vec<u8> {
    let color = COLORS[index];
    let mut pixels = image::RgbaImage::from_pixel(
        WIDTH,
        HEIGHT,
        image::Rgba([color[0], color[1], color[2], 255]),
    );
    for y in 0..16 {
        for x in 0..16 {
            pixels.put_pixel(x, y, image::Rgba([255, 255, 255, 255]));
        }
    }
    for y in HEIGHT - 16..HEIGHT {
        for x in WIDTH - 16..WIDTH {
            pixels.put_pixel(x, y, image::Rgba([0, 0, 0, 255]));
        }
    }
    let mut bytes = Vec::new();
    if image::DynamicImage::ImageRgba8(pixels)
        .write_to(
            &mut std::io::Cursor::new(&mut bytes),
            image::ImageFormat::Png,
        )
        .is_err()
    {
        return Vec::new();
    }
    bytes
}

fn page(held: bool, crop_only: bool) -> String {
    let pictures = [
        "<img src='/media-fixture/photo-0.png' alt=''>",
        "<picture><source media='(min-width: 1px)' srcset='/media-fixture/photo-1.png 1x, /media-fixture/photo-1.png 2x'><img src='/media-fixture/photo-0.png' alt='Wrong alt: Ruby card'></picture>",
        "<div class='photo' style=\"background-image:url('/media-fixture/photo-2.png')\"></div>",
        "<img loading='lazy' src='/media-fixture/photo-3.png' data-src='/media-fixture/photo-0.png' alt='Wrong alt: Ruby card'>",
        "<video preload='none' poster='/media-fixture/photo-4.png' aria-label='Observed poster'></video>",
        "<img src='/media-fixture/cookie.png' alt='Wrong alt: Ruby card'>",
        "<canvas id='graphic' width='128' height='96' aria-label='Synthetic card illustration'></canvas>",
    ];
    let mut cards = String::new();
    for (index, (name, picture)) in NAMES.iter().zip(pictures).enumerate() {
        if crop_only && index != 6 {
            continue;
        }
        cards.push_str(&format!(
            "<article>{picture}<h2>{name}</h2><p>Fixture item {index}</p></article>"
        ));
    }
    let wall = if held {
        "<form action='/media-fixture/signin' method='post'><h1>Sign in to your account</h1><label>Email<input type='email' autocomplete='username'></label><label>Password<input type='password' autocomplete='current-password'></label><button>Sign in</button></form>"
    } else if crop_only {
        "<h1>Single synthetic card</h1>"
    } else {
        "<h1>Seven synthetic cards</h1>"
    };
    format!(
        "<!doctype html><html><head><title>Record media fixture</title><style>body{{margin:8px;font:14px/16px sans-serif}}main{{display:grid;grid-template-columns:repeat(4,150px);gap:8px}}article{{padding:4px;width:140px;height:140px;border:1px solid #ddd}}h1{{font-size:18px;line-height:24px;margin:0 0 8px}}h2{{font-size:14px;line-height:16px;margin:4px 0}}p{{margin:0}}img,video,canvas,.photo{{display:block;width:128px;height:96px;background-size:128px 96px}}form{{padding:8px}}</style></head><body>{wall}<main>{cards}</main><script>const c=document.getElementById('graphic').getContext('2d');c.fillStyle='rgb(112,48,208)';c.fillRect(0,0,128,96);c.fillStyle='white';c.fillRect(0,0,16,16);c.fillStyle='black';c.fillRect(112,80,16,16);</script></body></html>"
    )
}

/// Responds only to this fixture's GET paths; pixels remain on its local server.
pub(super) fn serve(stream: &mut TcpStream, path: &str, signed_in: bool) -> bool {
    let path = path.split('?').next().unwrap_or(path);
    if !path.starts_with(PREFIX) {
        return false;
    }
    let (status, mime, body) = match path {
        "/media-fixture/cards" => (
            "200 OK",
            "text/html; charset=utf-8",
            page(false, false).into_bytes(),
        ),
        "/media-fixture/held" => (
            "200 OK",
            "text/html; charset=utf-8",
            page(true, false).into_bytes(),
        ),
        "/media-fixture/crop" => (
            "200 OK",
            "text/html; charset=utf-8",
            page(false, true).into_bytes(),
        ),
        "/media-fixture/record" => (
            "200 OK",
            "text/html; charset=utf-8",
            record_fixture::page().into_bytes(),
        ),
        "/media-fixture/cookie.png" if signed_in => ("200 OK", "image/png", png(5)),
        "/media-fixture/cookie.png" => ("403 Forbidden", "text/plain", Vec::new()),
        _ => match path
            .strip_prefix("/media-fixture/photo-")
            .and_then(|s| s.strip_suffix(".png"))
            .and_then(|s| s.parse::<usize>().ok())
            .filter(|i| *i < 5)
        {
            Some(index) => ("200 OK", "image/png", png(index)),
            None => ("404 Not Found", "text/plain", Vec::new()),
        },
    };
    let _ = write!(
        stream,
        "HTTP/1.1 {status}\r\nContent-Type: {mime}\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n",
        body.len()
    );
    let _ = stream.write_all(&body);
    true
}

fn correct_pixels(bytes: &[u8], index: usize) -> bool {
    pixel_base(bytes, index, 64, 48)
}

fn pixel_base(bytes: &[u8], index: usize, min_width: u32, min_height: u32) -> bool {
    if bytes.len() > MAX_RECORD_MEDIA_BYTES {
        return false;
    }
    let Ok(decoded) = image::load_from_memory_with_format(bytes, image::ImageFormat::Png) else {
        return false;
    };
    let pixels = decoded.to_rgba8();
    let (w, h) = pixels.dimensions();
    if w < min_width
        || h < min_height
        || w > 320
        || h > 240
        || (i64::from(w) * 3 - i64::from(h) * 4).abs() > 4
    {
        return false;
    }
    let near = |pixel: &image::Rgba<u8>, color: [u8; 3]| {
        pixel.0[3] >= 250 && (0..3).all(|c| pixel.0[c].abs_diff(color[c]) <= 12)
    };
    let dominant = pixels.pixels().filter(|p| near(p, COLORS[index])).count();
    dominant * 100 >= (w * h) as usize * 85
        && near(pixels.get_pixel(w / 16, h / 12), [255, 255, 255])
        && near(pixels.get_pixel(w * 15 / 16, h * 11 / 12), [0, 0, 0])
}

/// The current native contract crops the observed canvas node, not its article.
/// Its 128x96 CSS rectangle has fixed corner fiducials; compare the full interior
/// away from resampling edges so an inset or neighbouring-card crop cannot pass.
fn correct_crop_pixels(bytes: &[u8], index: usize) -> bool {
    // CSS source eligibility is 64x48; inward-sampled native PNGs may be smaller.
    // The core reference contract admits positive dimensions, not a 64x48 raster floor.
    if !pixel_base(bytes, index, 1, 1) {
        return false;
    }
    let Ok(decoded) = image::load_from_memory_with_format(bytes, image::ImageFormat::Png) else {
        return false;
    };
    let pixels = decoded.to_rgba8();
    let (w, h) = pixels.dimensions();
    let mut checked = 0usize;
    let mut correct = 0usize;
    let mut regions = [0usize; 3];
    for (x, y, pixel) in pixels.enumerate_pixels() {
        let sx = (f64::from(x) + 0.5) * 128.0 / f64::from(w);
        let sy = (f64::from(y) + 0.5) * 96.0 / f64::from(h);
        if [16.0, 112.0].iter().any(|edge| (sx - edge).abs() < 1.0)
            || [16.0, 80.0].iter().any(|edge| (sy - edge).abs() < 1.0)
        {
            continue;
        }
        let region = if sx < 16.0 && sy < 16.0 {
            1
        } else if sx >= 112.0 && sy >= 80.0 {
            2
        } else {
            0
        };
        regions[region] += 1;
        let color = match region {
            1 => [255, 255, 255],
            2 => [0, 0, 0],
            _ => COLORS[index],
        };
        checked += 1;
        if pixel.0[3] >= 250 && (0..3).all(|c| pixel.0[c].abs_diff(color[c]) <= 12) {
            correct += 1;
        }
    }
    checked > 0 && regions.iter().all(|count| *count > 0) && correct * 1000 >= checked * 999
}

/// Closed mismatch counts for the synthetic oracle; never logs samples or PNG data.
fn report_crop_counts(bytes: &[u8], index: usize) {
    let Ok(decoded) = image::load_from_memory_with_format(bytes, image::ImageFormat::Png) else {
        return;
    };
    let pixels = decoded.to_rgba8();
    let (w, h) = pixels.dimensions();
    let mut totals = [0usize; 3];
    let mut matches = [0usize; 3];
    let mut channels = [0usize; 3];
    let mut dominant = 0usize;
    for (x, y, pixel) in pixels.enumerate_pixels() {
        if pixel.0[3] >= 250 && (0..3).all(|c| pixel.0[c].abs_diff(COLORS[index][c]) <= 12) {
            dominant += 1;
        }
        let sx = (f64::from(x) + 0.5) * 128.0 / f64::from(w);
        let sy = (f64::from(y) + 0.5) * 96.0 / f64::from(h);
        if [16.0, 112.0].iter().any(|edge| (sx - edge).abs() < 1.0)
            || [16.0, 80.0].iter().any(|edge| (sy - edge).abs() < 1.0)
        {
            continue;
        }
        let region = if sx < 16.0 && sy < 16.0 {
            1
        } else if sx >= 112.0 && sy >= 80.0 {
            2
        } else {
            0
        };
        let color = match region {
            1 => [255, 255, 255],
            2 => [0, 0, 0],
            _ => COLORS[index],
        };
        totals[region] += 1;
        if pixel.0[3] >= 250 && (0..3).all(|c| pixel.0[c].abs_diff(color[c]) <= 12) {
            matches[region] += 1;
        }
        if region == 0 {
            for c in 0..3 {
                if pixel.0[c].abs_diff(color[c]) > 12 {
                    channels[c] += 1;
                }
            }
        }
    }
    let _ = writeln!(
        std::io::stdout().lock(),
        "media-fixture: crop_oracle width={w} height={h} total={} dominant={dominant} body_total={} body_match={} white_total={} white_match={} black_total={} black_match={} body_channel_mismatch={channels:?} fetch_base_valid={} native_base_valid={} full_pattern_valid={}; pixels_exported=false",
        w * h,
        totals[0],
        matches[0],
        totals[1],
        matches[1],
        totals[2],
        matches[2],
        correct_pixels(bytes, index),
        pixel_base(bytes, index, 1, 1),
        correct_crop_pixels(bytes, index)
    );
}

/// Seed only this fresh fixture profile through an actual native profile visit.
/// Presence remains the engine's closed observation; the next Work still asks.
#[cfg(target_os = "macos")]
pub(super) async fn seed_session(context: &Context<'_>) -> Result<(), &'static str> {
    let engine = ENGINE.get().ok_or("media_seed_engine")?;
    let opened = engine
        .visit_in_profile(
            context.profile,
            vec![context.sites.local(&format!("{ACCOUNT}/seed"))],
        )
        .recv_timeout(Duration::from_secs(5))
        .unwrap_or(0);
    let deadline = std::time::Instant::now() + Duration::from_secs(10);
    let mut present = false;
    while opened == 1 && std::time::Instant::now() < deadline {
        tokio::time::sleep(Duration::from_millis(100)).await;
        present = engine
            .work_sessions_present(context.profile, vec!["127.0.0.1".into()])
            .recv_timeout(Duration::from_secs(2))
            .ok()
            .is_some_and(|values| values == [true]);
        if present {
            break;
        }
    }
    let closed = engine
        .end_profile_visits()
        .recv_timeout(Duration::from_secs(5))
        .is_ok();
    let _ = writeln!(
        std::io::stdout().lock(),
        "media-fixture: profile_seed_visits={opened} native_session_present={present} seed_close_acknowledged={closed}; content=synthetic"
    );
    if opened == 1 && present && closed {
        Ok(())
    } else {
        Err("media_profile_seed")
    }
}

#[cfg(not(target_os = "macos"))]
pub(super) async fn seed_session(_: &Context<'_>) -> Result<(), &'static str> {
    Err("media_profile_seed_not_qualified_on_this_platform")
}

pub(super) async fn run(
    context: &Context<'_>,
    scenario: Scenario,
) -> Result<(Run, bool), &'static str> {
    let held = scenario == Scenario::Held;
    let anonymous = scenario == Scenario::Anonymous;
    let crop_only = scenario == Scenario::Canvas;
    let record_only = scenario == Scenario::Record;
    let before_posts = context.sites.posts();
    let before_cookies = context
        .sites
        .hits(Site::Account, "/media-fixture/cookie.png")
        .len();
    let request = WorkAgentFetch::Browse {
        start: format!(
            "{ACCOUNT}/media-fixture/{}",
            if held {
                "held"
            } else if record_only {
                "record"
            } else if crop_only {
                "crop"
            } else {
                "cards"
            }
        ),
        goal: if record_only {
            "Read only the Amber record, not Green neighbor. Report its exact heading as name and its Fixture item description. Do not navigate or submit.".into()
        } else if crop_only {
            "Read the single Purple card. Report its exact heading as name and its Fixture item description. Do not navigate or submit.".into()
        } else {
            "Read all seven displayed cards. Collect the exact heading of each card as its name and its Fixture item description. Keep each card separate. Do not sign in, submit forms, or navigate away.".into()
        },
        collection: Some(WorkBrowseCollection {
            title: "Synthetic card pictures".into(),
            columns: vec![WorkBrowseColumn {
                name: "description".into(),
                value: WorkBrowseValue::Text,
                required: true,
                extraction: WorkBrowseExtraction::Verbatim,
            }],
            max_items: if crop_only || record_only { 1 } else { 7 },
        }),
    };
    let run = context
        .run(
            "Read the synthetic media cards",
            held || anonymous,
            "Allow",
            vec![vec![request]],
        )
        .await?;
    let mut subjects = Vec::<(String, Option<WorkRecordMediaRefV1>, bool)>::new();
    for execution in &run.state.executions {
        for artifact in &execution.artifacts {
            if !execution.steps.iter().any(|step| {
                matches!(step.kind, WorkStepKindV1::Read { .. })
                    && step.artifacts.contains(&artifact.id)
            }) {
                continue;
            }
            if let WorkArtifactDataV1::ComparisonMatrix {
                subjects: items, ..
            } = &artifact.data
            {
                subjects.extend(
                    items
                        .iter()
                        .map(|s| (s.name.clone(), s.record_media.clone(), s.media_attempted)),
                );
            }
        }
    }
    let images = subjects
        .iter()
        .filter(|(_, media, _)| media.is_some())
        .count();
    if held {
        let blocked = run
            .opened
            .iter()
            .any(|p| p.intervention == Some(WorkInterventionKindV1::SignIn));
        let passed = blocked && images == 0 && context.sites.posts() == before_posts;
        let _ = writeln!(
            std::io::stdout().lock(),
            "media-fixture: held=true records={} images={images} blocked={blocked} passed={passed}; pixels_exported=false",
            subjects.len()
        );
        return Ok((run, passed));
    }
    let mut correct = 0;
    let mut fetches = 0;
    let mut crops = 0;
    let mut sources = std::collections::BTreeSet::new();
    let mut names = std::collections::BTreeSet::new();
    for (name, media, attempted) in &subjects {
        let Some(index) = NAMES
            .iter()
            .position(|expected| name.trim() == *expected)
            .or_else(|| (name.trim() == record_fixture::NAME).then_some(7))
        else {
            continue;
        };
        let Some(media) = media else {
            continue;
        };
        if !names.insert(index)
            || !sources.insert(media.source.clone())
            || !attempted
            || media.profile != context.profile
            || media.work != run.state.work.id
        {
            continue;
        }
        let linked = run.state.executions.iter().any(|execution| {
            execution.id == media.execution
                && execution.steps.iter().any(|step| {
                    step.id == media.step && matches!(step.kind, WorkStepKindV1::Read { .. })
                })
                && execution.artifacts.iter().any(|a| {
                    a.evidence
                        .iter()
                        .any(|e| e.extraction_id == media.extraction)
                })
        });
        let reply = context
            .handle
            .read_work_record_media(media.clone())
            .map_err(|_| "media_read_admission")?;
        let response = tokio::time::timeout(Duration::from_secs(3), reply)
            .await
            .map_err(|_| "media_read_timeout")?
            .map_err(|_| "media_read_failed")?;
        let WorkReply::RecordMedia(bytes) = response.reply else {
            return Err("media_read_reply");
        };
        if media.origin == WorkRecordMediaOriginV1::NativeCrop && index < 7 {
            report_crop_counts(&bytes.0, index);
        }
        let origin = if index >= 6 {
            media.origin == WorkRecordMediaOriginV1::NativeCrop
        } else {
            media.origin == WorkRecordMediaOriginV1::NativeFetch
        };
        if response.profile == context.profile
            && linked
            && origin
            && if media.origin == WorkRecordMediaOriginV1::NativeCrop {
                if index == 7 {
                    record_fixture::pixels(&bytes.0, true)
                } else {
                    correct_crop_pixels(&bytes.0, index)
                }
            } else {
                correct_pixels(&bytes.0, index)
            }
        {
            correct += 1;
        }
        match media.origin {
            WorkRecordMediaOriginV1::NativeFetch | WorkRecordMediaOriginV1::PublicFetch => {
                fetches += 1
            }
            WorkRecordMediaOriginV1::NativeCrop => crops += 1,
        }
        let _ = writeln!(
            std::io::stdout().lock(),
            "media-fixture: record={index} origin={:?} width={} height={} digest={}",
            media.origin,
            media.width,
            media.height,
            media.digest
        );
    }
    let cookie_hits = context
        .sites
        .hits(Site::Account, "/media-fixture/cookie.png");
    let fresh_cookies = cookie_hits.get(before_cookies..).unwrap_or_default();
    let cookie = if crop_only || record_only {
        None
    } else {
        Some(if anonymous {
            !fresh_cookies.is_empty()
                && fresh_cookies
                    .iter()
                    .all(|(_, cookie)| !cookie.contains(ACCOUNT_COOKIE))
        } else {
            fresh_cookies.len() >= 2
                && fresh_cookies
                    .iter()
                    .all(|(_, cookie)| cookie.contains(ACCOUNT_COOKIE))
        })
    };
    let succeeded =
        run.opened.len() == 1 && run.opened[0].status == Some(WorkStepStatus::Succeeded);
    let badge = run
        .state
        .executions
        .iter()
        .flat_map(|e| &e.steps)
        .filter(|s| matches!(s.kind, WorkStepKindV1::Read { .. }))
        .any(|s| s.account.is_some());
    let session = if anonymous {
        run.asked.is_empty() && !badge && run.opened.iter().all(|p| !p.yours)
    } else {
        run.asked.len() == 1 && badge && run.opened.iter().all(|p| p.yours)
    };
    let media_correct = if crop_only || record_only {
        correct == 1 && crops == 1 && fetches == 0 && images == 1
    } else if anonymous {
        correct == 5
            && fetches == 5
            && crops == 0
            && images == 5
            && subjects
                .iter()
                .filter(|(name, _, _)| [NAMES[5], NAMES[6]].contains(&name.as_str()))
                .all(|(_, media, attempted)| media.is_none() && *attempted)
    } else {
        correct == 7 && fetches == 6 && crops == 1 && images == 7
    };
    let expected_names = if record_only {
        vec![record_fixture::NAME]
    } else if crop_only {
        vec![NAMES[6]]
    } else {
        NAMES.to_vec()
    };
    let records_complete = subjects
        .iter()
        .map(|(name, _, _)| name.trim())
        .collect::<std::collections::BTreeSet<_>>()
        == expected_names
            .iter()
            .copied()
            .collect::<std::collections::BTreeSet<_>>();
    let passed = subjects.len() == expected_names.len()
        && records_complete
        && media_correct
        && cookie != Some(false)
        && succeeded
        && session
        && context.sites.posts() == before_posts
        && run.confirmed.is_empty();
    let _ = writeln!(
        std::io::stdout().lock(),
        "media-fixture: held=false anonymous={anonymous} crop_only={crop_only} record_only={record_only} records={} images={images} correct={correct} native_fetch={fetches} native_crop={crops} cookie_reads={} cookie_valid={cookie:?} session_valid={session} succeeded={succeeded} passed={passed}; pixels_exported=false",
        subjects.len(),
        fresh_cookies.len()
    );
    Ok((run, passed))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn synthetic_pixel_oracle_rejects_the_wrong_card_and_wrong_rectangle() {
        for index in 0..NAMES.len() {
            let bytes = png(index);
            assert!(correct_pixels(&bytes, index));
            assert!(!correct_pixels(&bytes, (index + 1) % NAMES.len()));
            let decoded = image::load_from_memory(&bytes).unwrap();
            let mut cropped = Vec::new();
            decoded
                .crop_imm(0, 0, 64, 48)
                .write_to(
                    &mut std::io::Cursor::new(&mut cropped),
                    image::ImageFormat::Png,
                )
                .unwrap();
            assert!(!correct_pixels(&cropped, index));
        }
        assert!(!correct_pixels(b"not PNG", 0));
        let bytes = png(6);
        assert!(correct_crop_pixels(&bytes, 6));
        let decoded = image::load_from_memory(&bytes).unwrap();
        let mut inset = Vec::new();
        decoded
            .crop_imm(4, 3, 120, 90)
            .write_to(
                &mut std::io::Cursor::new(&mut inset),
                image::ImageFormat::Png,
            )
            .unwrap();
        assert!(!correct_crop_pixels(&inset, 6));
        // 640-class native viewport sampling legitimately produces a 63x47 crop.
        let mut sampled = Vec::new();
        decoded
            .resize_exact(63, 47, image::imageops::FilterType::Nearest)
            .write_to(
                &mut std::io::Cursor::new(&mut sampled),
                image::ImageFormat::Png,
            )
            .unwrap();
        assert!(!correct_pixels(&sampled, 6));
        assert!(correct_crop_pixels(&sampled, 6));
        assert!(!correct_crop_pixels(&sampled, 0));
        let mut sampled_wrong_rect = Vec::new();
        decoded
            .crop_imm(4, 3, 120, 90)
            .resize_exact(63, 47, image::imageops::FilterType::Nearest)
            .write_to(
                &mut std::io::Cursor::new(&mut sampled_wrong_rect),
                image::ImageFormat::Png,
            )
            .unwrap();
        assert!(!correct_crop_pixels(&sampled_wrong_rect, 6));
    }
}
