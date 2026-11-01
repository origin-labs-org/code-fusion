//! The checksummed SHA-1 v2/v3 entry table only. Required extensions and sparse
//! representations are rejected; optional extension payloads are never decoded.
use super::{hash, Error, Oid, MAX_INDEX, MAX_OBJECTS};
use crate::work_files::protected_path;
use std::{
    collections::{BTreeMap, BTreeSet},
    path::{Component, Path, PathBuf},
};

pub(super) struct Entry {
    pub oid: Oid,
    pub ordinary: bool,
    pub intent: bool,
}
pub(super) struct Index {
    pub entries: BTreeMap<PathBuf, Entry>,
    pub protected: BTreeSet<Oid>,
}
pub(super) fn relative(path: &str) -> Result<PathBuf, Error> {
    if path.is_empty()
        || path.len() > 4096
        || path.contains('\\')
        || path.starts_with('/')
        || path.ends_with('/')
        || path.chars().any(char::is_control)
        || path
            .split('/')
            .any(|part| part.is_empty() || matches!(part, "." | ".."))
    {
        return Err(Error::Input);
    }
    let path = Path::new(path);
    if path
        .components()
        .any(|part| !matches!(part, Component::Normal(_)))
    {
        return Err(Error::Input);
    }
    Ok(path.to_owned())
}
fn u32_at(bytes: &[u8], at: usize) -> Result<u32, Error> {
    Ok(u32::from_be_bytes(
        bytes
            .get(at..at.checked_add(4).ok_or(Error::Invalid)?)
            .ok_or(Error::Invalid)?
            .try_into()
            .map_err(|_| Error::Invalid)?,
    ))
}
pub(super) fn parse(bytes: &[u8], check: &impl Fn() -> Result<(), Error>) -> Result<Index, Error> {
    check()?;
    if bytes.len() < 32 || bytes.len() > MAX_INDEX {
        return Err(Error::Limit);
    }
    let end = bytes.len() - 20;
    if bytes.get(..4) != Some(b"DIRC") || hash(&bytes[..end]) != bytes[end..] {
        return Err(Error::Invalid);
    }
    let version = u32_at(bytes, 4)?;
    if !matches!(version, 2 | 3) {
        return Err(Error::Unsupported);
    }
    let count = u32_at(bytes, 8)? as usize;
    if count > MAX_OBJECTS {
        return Err(Error::Limit);
    }
    let mut offset = 12usize;
    let mut previous: Option<(&[u8], u16)> = None;
    let mut index = Index {
        entries: BTreeMap::new(),
        protected: BTreeSet::new(),
    };
    let mut names = BTreeSet::<&[u8]>::new();
    for row in 0..count {
        if row % 256 == 0 {
            check()?;
        }
        let start = offset;
        let fixed = bytes
            .get(start..start.checked_add(62).ok_or(Error::Invalid)?)
            .filter(|_| start + 62 <= end)
            .ok_or(Error::Invalid)?;
        let mode = u32::from_be_bytes(fixed[24..28].try_into().unwrap());
        if !matches!(mode, 0o100644 | 0o100755 | 0o120000 | 0o160000) {
            return Err(Error::Unsupported);
        }
        let oid: Oid = fixed[40..60].try_into().unwrap();
        let flags = u16::from_be_bytes(fixed[60..62].try_into().unwrap());
        let stage = (flags >> 12) & 3;
        offset += 62;
        let mut extended = 0u16;
        if flags & 0x4000 != 0 {
            if version != 3 {
                return Err(Error::Invalid);
            }
            let field = bytes
                .get(offset..offset + 2)
                .filter(|_| offset + 2 <= end)
                .ok_or(Error::Invalid)?;
            extended = u16::from_be_bytes(field.try_into().unwrap());
            offset += 2;
            if extended & !0x6000 != 0 {
                return Err(Error::Unsupported);
            }
        }
        let remaining = bytes.get(offset..end).ok_or(Error::Invalid)?;
        let length = remaining
            .iter()
            .take(4097)
            .position(|byte| *byte == 0)
            .ok_or(Error::Invalid)?;
        let name = &remaining[..length];
        if (flags & 0x0fff != 0x0fff && usize::from(flags & 0x0fff) != length)
            || (flags & 0x0fff == 0x0fff && length < 0x0fff)
        {
            return Err(Error::Invalid);
        }
        if previous.is_some_and(|previous| previous >= (name, stage)) {
            return Err(Error::Invalid);
        }
        previous = Some((name, stage));
        for (position, byte) in name.iter().enumerate() {
            if *byte == b'/' && names.contains(&name[..position]) {
                return Err(Error::Invalid);
            }
        }
        names.insert(name);
        let path = relative(std::str::from_utf8(name).map_err(|_| Error::Unsupported)?)?;
        offset = offset.checked_add(length + 1).ok_or(Error::Invalid)?;
        let padded = start
            .checked_add((offset - start).checked_add(7).ok_or(Error::Invalid)? & !7)
            .ok_or(Error::Invalid)?;
        if padded > end || bytes[offset..padded].iter().any(|byte| *byte != 0) {
            return Err(Error::Invalid);
        }
        offset = padded;
        if protected_path(&path) || short_alias(&path) {
            index.protected.insert(oid);
            continue;
        }
        let ordinary = stage == 0 && matches!(mode, 0o100644 | 0o100755) && extended & 0x4000 == 0;
        let entry = Entry {
            oid,
            ordinary,
            intent: extended & 0x2000 != 0,
        };
        match index.entries.entry(path) {
            std::collections::btree_map::Entry::Vacant(row) => {
                row.insert(entry);
            }
            std::collections::btree_map::Entry::Occupied(mut row) => {
                row.get_mut().ordinary = false;
            }
        }
    }
    while offset < end {
        let header = bytes
            .get(offset..offset.checked_add(8).ok_or(Error::Invalid)?)
            .filter(|_| offset + 8 <= end)
            .ok_or(Error::Invalid)?;
        if !header[0].is_ascii_uppercase() {
            return Err(Error::Unsupported);
        }
        let length = u32::from_be_bytes(header[4..8].try_into().unwrap()) as usize;
        offset = offset
            .checked_add(8)
            .and_then(|at| at.checked_add(length))
            .filter(|at| *at <= end)
            .ok_or(Error::Invalid)?;
    }
    Ok(index)
}

// Short-name aliases can resolve to a protected Windows component even though
// their textual spelling is unrelated. Never grant these names or shared OIDs.
fn short_alias(path: &Path) -> bool {
    path.components().any(|part| {
        part.as_os_str().to_str().is_some_and(|name| {
            let stem = name.split('.').next().unwrap_or_default();
            stem.rsplit_once('~').is_some_and(|(prefix, suffix)| {
                !prefix.is_empty()
                    && stem.len() <= 8
                    && !suffix.is_empty()
                    && suffix.bytes().all(|byte| byte.is_ascii_digit())
            })
        })
    })
}
