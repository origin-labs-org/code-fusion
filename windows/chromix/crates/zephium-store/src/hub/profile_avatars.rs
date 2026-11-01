//! Profile avatars live in meta beside the profile registry and leave with
//! their profile row. A photo is stored only after it was cropped square and
//! downscaled here.
use super::*;
use std::sync::Arc;
use zephium_core::profiles::{ProfileAvatar, ProfileAvatarStyle, MAX_PROFILE_AVATAR_PHOTO_BYTES};

const PHOTO_SIDE: u32 = 256;
const MAX_SOURCE_BYTES: usize = 32 * 1024 * 1024;
const MAX_SOURCE_SIDE: u32 = 12_000;
const MAX_DECODE_ALLOC_BYTES: u64 = 512 * 1024 * 1024;

fn style_name(style: ProfileAvatarStyle) -> &'static str {
    match style {
        ProfileAvatarStyle::Initials => "initials",
        ProfileAvatarStyle::Symbol => "symbol",
        ProfileAvatarStyle::Photo => "photo",
    }
}

fn style_of(name: &str) -> Option<ProfileAvatarStyle> {
    match name {
        "initials" => Some(ProfileAvatarStyle::Initials),
        "symbol" => Some(ProfileAvatarStyle::Symbol),
        "photo" => Some(ProfileAvatarStyle::Photo),
        _ => None,
    }
}

impl Hub {
    pub(crate) fn profile_avatars(&self) -> rusqlite::Result<Vec<(ProfileId, ProfileAvatar)>> {
        let mut statement = self.meta.prepare_cached(
            "SELECT profile_id, style, color, symbol, revision FROM profile_avatars",
        )?;
        let rows = statement.query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)?,
                row.get::<_, i64>(3)?,
                row.get::<_, i64>(4)?,
            ))
        })?;
        let mut avatars = Vec::new();
        for row in rows {
            let (profile, style, color, symbol, revision) = row?;
            let avatar = (|| {
                Some(ProfileAvatar {
                    style: style_of(&style)?,
                    color: u8::try_from(color).ok()?,
                    symbol: u8::try_from(symbol).ok()?,
                    revision: u32::try_from(revision).ok()?,
                })
            })();
            let profile = ProfileId::parse(&profile).filter(|id| id.to_string() == profile);
            if let (Some(profile), Some(avatar)) = (profile, avatar.filter(ProfileAvatar::valid)) {
                avatars.push((profile, avatar));
            }
        }
        Ok(avatars)
    }

    pub(crate) fn save_profile_avatar(
        &mut self,
        profile: ProfileId,
        avatar: ProfileAvatar,
        photo: Option<Arc<Vec<u8>>>,
    ) -> rusqlite::Result<()> {
        let photo_style = avatar.style == ProfileAvatarStyle::Photo;
        if self.recovery_required.is_some()
            || !self.knows(profile)
            || !avatar.valid()
            || avatar.revision == 0
            || photo_style != photo.is_some()
            || photo.as_ref().is_some_and(|bytes| {
                bytes.is_empty() || bytes.len() > MAX_PROFILE_AVATAR_PHOTO_BYTES
            })
        {
            return Err(invalid_data("invalid profile avatar"));
        }
        self.meta.execute(
            "INSERT INTO profile_avatars(profile_id, style, color, symbol, revision, photo)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(profile_id) DO UPDATE SET
                 style = excluded.style, color = excluded.color, symbol = excluded.symbol,
                 revision = excluded.revision, photo = excluded.photo",
            params![
                profile.to_string(),
                style_name(avatar.style),
                avatar.color,
                avatar.symbol,
                avatar.revision,
                photo.as_deref().map(Vec::as_slice),
            ],
        )?;
        Ok(())
    }

    pub(crate) fn profile_avatar_photo(&self, profile: ProfileId) -> Option<Vec<u8>> {
        self.meta
            .query_row(
                "SELECT photo FROM profile_avatars WHERE profile_id = ?1 AND photo IS NOT NULL",
                [profile.to_string()],
                |row| row.get::<_, Vec<u8>>(0),
            )
            .optional()
            .ok()
            .flatten()
            .filter(|bytes| bytes.len() <= MAX_PROFILE_AVATAR_PHOTO_BYTES)
    }
}

/// Decodes a picked picture within fixed bounds, crops its centre square and
/// encodes a 256px copy small enough to keep in meta.
pub fn prepare_avatar_photo(bytes: &[u8]) -> Result<Vec<u8>, media::MediaAdmissionError> {
    use image::{codecs::jpeg::JpegEncoder, imageops::FilterType, ImageDecoder, ImageFormat};
    use media::MediaAdmissionError as Error;
    if bytes.is_empty() {
        return Err(Error::Empty);
    }
    if bytes.len() > MAX_SOURCE_BYTES {
        return Err(Error::TooLarge);
    }
    let format = image::guess_format(bytes).map_err(|_| Error::Unsupported)?;
    if !matches!(
        format,
        ImageFormat::Png | ImageFormat::Jpeg | ImageFormat::WebP | ImageFormat::Gif
    ) {
        return Err(Error::Unsupported);
    }
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(MAX_SOURCE_SIDE);
    limits.max_image_height = Some(MAX_SOURCE_SIDE);
    limits.max_alloc = Some(MAX_DECODE_ALLOC_BYTES);
    let mut reader = image::ImageReader::with_format(std::io::Cursor::new(bytes), format);
    reader.limits(limits);
    let mut decoder = reader.into_decoder().map_err(|_| Error::Malformed)?;
    let orientation = decoder.orientation().ok();
    let mut decoded = image::DynamicImage::from_decoder(decoder).map_err(|_| Error::Malformed)?;
    if let Some(orientation) = orientation {
        decoded.apply_orientation(orientation);
    }
    let side = decoded.width().min(decoded.height());
    if side == 0 {
        return Err(Error::Malformed);
    }
    let square = decoded.crop_imm(
        (decoded.width() - side) / 2,
        (decoded.height() - side) / 2,
        side,
        side,
    );
    let target = PHOTO_SIDE.min(side);
    let small = square.resize_exact(target, target, FilterType::Lanczos3);
    let rgba = small.to_rgba8();
    if rgba.pixels().any(|pixel| pixel.0[3] < 255) {
        let mut png = Vec::new();
        if small
            .write_to(&mut std::io::Cursor::new(&mut png), ImageFormat::Png)
            .is_ok()
            && png.len() <= MAX_PROFILE_AVATAR_PHOTO_BYTES
        {
            return Ok(png);
        }
    }
    let mut rgb = image::RgbImage::new(target, target);
    for (to, from) in rgb.pixels_mut().zip(rgba.pixels()) {
        let [r, g, b, a] = from.0;
        let blend =
            |c: u8| ((u16::from(c) * u16::from(a) + 255 * (255 - u16::from(a))) / 255) as u8;
        *to = image::Rgb([blend(r), blend(g), blend(b)]);
    }
    for quality in [88, 80, 70, 60, 50] {
        let mut jpeg = Vec::new();
        if JpegEncoder::new_with_quality(&mut jpeg, quality)
            .encode_image(&rgb)
            .is_ok()
            && jpeg.len() <= MAX_PROFILE_AVATAR_PHOTO_BYTES
        {
            return Ok(jpeg);
        }
    }
    Err(Error::TooLarge)
}

#[cfg(test)]
mod tests {
    use super::*;
    use zephium_core::profiles::ProfileKind;
    use zephium_core::session::{PersistedProfile, PersistedSpace, SessionState};

    fn hub_with(profiles: &[(u128, ProfileKind)]) -> Hub {
        let mut hub = Hub::in_memory().unwrap();
        hub.save(&SessionState {
            profiles: profiles
                .iter()
                .map(|(id, kind)| PersistedProfile {
                    id: ProfileId::from(*id),
                    name: "Fixture".into(),
                    kind: *kind,
                })
                .collect(),
            spaces: profiles
                .iter()
                .map(|(id, _)| PersistedSpace {
                    id: SpaceId::from(*id + 100),
                    profile: ProfileId::from(*id),
                    name: "Space".into(),
                    look: Default::default(),
                })
                .collect(),
            active_space: Some(SpaceId::from(profiles[0].0 + 100)),
            ..SessionState::default()
        })
        .unwrap();
        hub
    }

    fn encoded(width: u32, height: u32, format: image::ImageFormat) -> Vec<u8> {
        let image = image::RgbaImage::from_fn(width, height, |x, y| {
            image::Rgba([(x * 7) as u8, (y * 5) as u8, ((x ^ y) * 3) as u8, 255])
        });
        let mut out = Vec::new();
        image::DynamicImage::ImageRgba8(image)
            .write_to(&mut std::io::Cursor::new(&mut out), format)
            .unwrap();
        out
    }

    #[test]
    fn a_picked_photo_is_cropped_square_and_downscaled_within_its_cap() {
        let prepared = prepare_avatar_photo(&encoded(1200, 700, image::ImageFormat::Png)).unwrap();
        assert!(prepared.len() <= MAX_PROFILE_AVATAR_PHOTO_BYTES);
        let decoded = image::load_from_memory(&prepared).unwrap();
        assert_eq!((decoded.width(), decoded.height()), (256, 256));

        let small = prepare_avatar_photo(&encoded(90, 120, image::ImageFormat::Jpeg)).unwrap();
        let decoded = image::load_from_memory(&small).unwrap();
        assert_eq!((decoded.width(), decoded.height()), (90, 90));

        assert_eq!(
            prepare_avatar_photo(b""),
            Err(media::MediaAdmissionError::Empty)
        );
        assert_eq!(
            prepare_avatar_photo(b"%PDF-1.7 not a picture"),
            Err(media::MediaAdmissionError::Unsupported)
        );
        assert_eq!(
            prepare_avatar_photo(&encoded(64, 64, image::ImageFormat::Png)[..40]),
            Err(media::MediaAdmissionError::Malformed)
        );
    }

    #[test]
    fn avatars_round_trip_and_leave_with_their_profile() {
        let mut hub = hub_with(&[(1, ProfileKind::Default), (2, ProfileKind::Named)]);
        let named = ProfileId::from(2);
        let photo =
            Arc::new(prepare_avatar_photo(&encoded(300, 300, image::ImageFormat::Png)).unwrap());
        let avatar = ProfileAvatar {
            style: ProfileAvatarStyle::Photo,
            color: 3,
            symbol: 0,
            revision: 1,
        };
        hub.save_profile_avatar(named, avatar, Some(photo.clone()))
            .unwrap();
        assert_eq!(hub.profile_avatars().unwrap(), vec![(named, avatar)]);
        assert_eq!(hub.profile_avatar_photo(named).as_ref(), Some(&*photo));

        let symbol = ProfileAvatar {
            style: ProfileAvatarStyle::Symbol,
            color: 9,
            symbol: 15,
            revision: 2,
        };
        hub.save_profile_avatar(named, symbol, None).unwrap();
        assert_eq!(hub.profile_avatars().unwrap(), vec![(named, symbol)]);
        assert_eq!(hub.profile_avatar_photo(named), None);

        for (bad, photo) in [
            (
                ProfileAvatar {
                    color: 10,
                    ..symbol
                },
                None,
            ),
            (
                ProfileAvatar {
                    symbol: 16,
                    ..symbol
                },
                None,
            ),
            (
                ProfileAvatar {
                    revision: 0,
                    ..symbol
                },
                None,
            ),
            (avatar, None),
            (symbol, Some(photo.clone())),
            (
                avatar,
                Some(Arc::new(vec![0; MAX_PROFILE_AVATAR_PHOTO_BYTES + 1])),
            ),
        ] {
            assert!(hub.save_profile_avatar(named, bad, photo).is_err());
        }
        assert!(hub
            .save_profile_avatar(ProfileId::from(7), symbol, None)
            .is_err());

        let survivor = SessionState {
            profiles: vec![PersistedProfile {
                id: ProfileId::from(1),
                name: "Fixture".into(),
                kind: ProfileKind::Default,
            }],
            spaces: vec![PersistedSpace {
                id: SpaceId::from(101),
                profile: ProfileId::from(1),
                name: "Space".into(),
                look: Default::default(),
            }],
            active_space: Some(SpaceId::from(101)),
            ..SessionState::default()
        };
        assert_eq!(
            hub.authorize_profile_deletion(named, &survivor).unwrap(),
            zephium_core::ports::store::ProfileDeletionAuthorizeOutcome::Authorized
        );
        assert!(hub.profile_avatars().unwrap().is_empty());
        assert_eq!(hub.profile_avatar_photo(named), None);
    }
}
