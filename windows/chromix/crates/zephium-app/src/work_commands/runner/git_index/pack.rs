//! Bounded pack-v2 / idx-v2 decoding. Original metadata never reaches Git.
use super::{hash, Budget, Error, Oid, MAX_BLOB, MAX_OBJECTS};
use std::{
    collections::{BTreeMap, BTreeSet},
    io::Read,
};

#[derive(Clone, Copy)]
struct Slot {
    offset: usize,
    crc: u32,
}
pub(super) struct Pack {
    data: Vec<u8>,
    entries: BTreeMap<Oid, Slot>,
    offsets: BTreeMap<usize, Oid>,
}
pub(super) enum Payload {
    Blob(Vec<u8>),
    Delta { base: Oid, bytes: Vec<u8> },
}
fn u32_at(data: &[u8], at: usize) -> Result<u32, Error> {
    Ok(u32::from_be_bytes(
        data.get(at..at.checked_add(4).ok_or(Error::Invalid)?)
            .ok_or(Error::Invalid)?
            .try_into()
            .map_err(|_| Error::Invalid)?,
    ))
}
impl Pack {
    pub fn new(index: &[u8], data: Vec<u8>, expected: Oid) -> Result<Self, Error> {
        if index.len() < 1072 || index.get(..4) != Some(b"\xfftOc") || u32_at(index, 4)? != 2 {
            return Err(Error::Unsupported);
        }
        let index_end = index.len() - 20;
        if hash(&index[..index_end]) != index[index_end..] {
            return Err(Error::Invalid);
        }
        let count = u32_at(index, 8 + 255 * 4)? as usize;
        if count > MAX_OBJECTS {
            return Err(Error::Limit);
        }
        let names_end = 1032usize
            .checked_add(count.checked_mul(20).ok_or(Error::Invalid)?)
            .ok_or(Error::Invalid)?;
        let crc_end = names_end
            .checked_add(count.checked_mul(4).ok_or(Error::Invalid)?)
            .ok_or(Error::Invalid)?;
        let offsets_end = crc_end
            .checked_add(count.checked_mul(4).ok_or(Error::Invalid)?)
            .ok_or(Error::Invalid)?;
        let trailer = index
            .len()
            .checked_sub(40)
            .filter(|end| *end >= offsets_end)
            .ok_or(Error::Invalid)?;
        if (trailer - offsets_end) % 8 != 0 || index[trailer..index_end] != expected {
            return Err(Error::Invalid);
        }
        let large_count = (trailer - offsets_end) / 8;
        if large_count > count {
            return Err(Error::Invalid);
        }
        if data.len() < 32
            || data.get(..4) != Some(b"PACK")
            || u32_at(&data, 4)? != 2
            || u32_at(&data, 8)? as usize != count
        {
            return Err(Error::Invalid);
        }
        let end = data.len() - 20;
        if data[end..] != expected || hash(&data[..end]) != expected {
            return Err(Error::Invalid);
        }
        let mut entries = BTreeMap::new();
        let mut offsets = BTreeMap::new();
        let mut fanout = [0u32; 256];
        let mut last = None;
        let mut used_large = BTreeSet::new();
        for n in 0..count {
            let oid: Oid = index[1032 + n * 20..1032 + (n + 1) * 20]
                .try_into()
                .unwrap();
            if last.is_some_and(|previous| previous >= oid) {
                return Err(Error::Invalid);
            }
            last = Some(oid);
            fanout[oid[0] as usize] += 1;
            let raw = u32_at(index, crc_end + n * 4)?;
            let offset = if raw & 0x8000_0000 == 0 {
                raw as usize
            } else {
                let slot = (raw & 0x7fff_ffff) as usize;
                if slot >= large_count || !used_large.insert(slot) {
                    return Err(Error::Invalid);
                }
                let position = offsets_end + slot * 8;
                usize::try_from(u64::from_be_bytes(
                    index[position..position + 8].try_into().unwrap(),
                ))
                .map_err(|_| Error::Invalid)?
            };
            if !(12..end).contains(&offset) || offsets.insert(offset, oid).is_some() {
                return Err(Error::Invalid);
            }
            entries.insert(
                oid,
                Slot {
                    offset,
                    crc: u32_at(index, names_end + n * 4)?,
                },
            );
        }
        if used_large.len() != large_count {
            return Err(Error::Invalid);
        }
        let mut total = 0;
        for (n, amount) in fanout.iter().enumerate() {
            total += amount;
            if total != u32_at(index, 8 + n * 4)? {
                return Err(Error::Invalid);
            }
        }
        if count > 0 && offsets.first_key_value().map(|(offset, _)| *offset) != Some(12) {
            return Err(Error::Invalid);
        }
        Ok(Self {
            data,
            entries,
            offsets,
        })
    }
    pub fn contains(&self, id: &Oid) -> bool {
        self.entries.contains_key(id)
    }
    pub fn payload(&self, id: &Oid, budget: &mut Budget) -> Result<Payload, Error> {
        let slot = self.entries.get(id).ok_or(Error::Missing)?;
        let end = self
            .offsets
            .range((
                std::ops::Bound::Excluded(slot.offset),
                std::ops::Bound::Unbounded,
            ))
            .next()
            .map_or(self.data.len() - 20, |(offset, _)| *offset);
        let data = self.data.get(slot.offset..end).ok_or(Error::Invalid)?;
        let mut crc = flate2::Crc::new();
        crc.update(data);
        if crc.sum() != slot.crc {
            return Err(Error::Invalid);
        }
        let first = *data.first().ok_or(Error::Invalid)?;
        let kind = (first >> 4) & 7;
        let mut size = u64::from(first & 15);
        let mut at = 1;
        let mut shift = 4;
        let mut byte = first;
        while byte & 128 != 0 {
            byte = *data.get(at).ok_or(Error::Invalid)?;
            at += 1;
            let multiplier = 1u64.checked_shl(shift).ok_or(Error::Invalid)?;
            size = size
                .checked_add(
                    u64::from(byte & 127)
                        .checked_mul(multiplier)
                        .ok_or(Error::Invalid)?,
                )
                .ok_or(Error::Invalid)?;
            shift += 7;
            if shift > 64 {
                return Err(Error::Invalid);
            }
        }
        let size = usize::try_from(size).map_err(|_| Error::Limit)?;
        if size > MAX_BLOB {
            return Err(Error::Limit);
        }
        let base = match kind {
            3 => None,
            6 => {
                let mut byte = *data.get(at).ok_or(Error::Invalid)?;
                at += 1;
                let mut distance = u64::from(byte & 127);
                let mut count = 1;
                while byte & 128 != 0 {
                    byte = *data.get(at).ok_or(Error::Invalid)?;
                    at += 1;
                    count += 1;
                    if count > 10 {
                        return Err(Error::Invalid);
                    }
                    distance = distance
                        .checked_add(1)
                        .and_then(|n| n.checked_mul(128))
                        .and_then(|n| n.checked_add(u64::from(byte & 127)))
                        .ok_or(Error::Invalid)?;
                }
                if distance == 0 {
                    return Err(Error::Invalid);
                }
                let base = slot
                    .offset
                    .checked_sub(usize::try_from(distance).map_err(|_| Error::Invalid)?)
                    .ok_or(Error::Invalid)?;
                Some(*self.offsets.get(&base).ok_or(Error::Invalid)?)
            }
            7 => {
                let id = data
                    .get(at..at + 20)
                    .ok_or(Error::Invalid)?
                    .try_into()
                    .unwrap();
                at += 20;
                Some(id)
            }
            _ => return Err(Error::Unsupported),
        };
        budget.output(size)?;
        let bytes = inflate(data.get(at..).ok_or(Error::Invalid)?, size)?;
        Ok(match base {
            None => Payload::Blob(bytes),
            Some(base) => Payload::Delta { base, bytes },
        })
    }
}
pub(super) fn inflate(bytes: &[u8], expected: usize) -> Result<Vec<u8>, Error> {
    let mut decoder = flate2::bufread::ZlibDecoder::new(bytes);
    let mut result = Vec::new();
    decoder
        .by_ref()
        .take(expected as u64 + 1)
        .read_to_end(&mut result)
        .map_err(|_| Error::Invalid)?;
    if result.len() != expected || decoder.total_in() as usize != bytes.len() {
        return Err(Error::Invalid);
    }
    Ok(result)
}
fn delta_integer(data: &[u8], at: &mut usize) -> Result<usize, Error> {
    let mut result = 0usize;
    let mut shift = 0u32;
    loop {
        let byte = *data.get(*at).ok_or(Error::Invalid)?;
        *at += 1;
        let multiplier = 1usize.checked_shl(shift).ok_or(Error::Invalid)?;
        result = result
            .checked_add(
                usize::from(byte & 127)
                    .checked_mul(multiplier)
                    .ok_or(Error::Invalid)?,
            )
            .ok_or(Error::Invalid)?;
        if result > MAX_BLOB {
            return Err(Error::Limit);
        }
        if byte & 128 == 0 {
            return Ok(result);
        }
        shift += 7;
    }
}
pub(super) fn apply_delta(base: &[u8], data: &[u8], budget: &mut Budget) -> Result<Vec<u8>, Error> {
    let mut at = 0;
    let source = delta_integer(data, &mut at)?;
    let target = delta_integer(data, &mut at)?;
    if source != base.len() {
        return Err(Error::Invalid);
    }
    budget.output(target)?;
    let mut result = Vec::with_capacity(target);
    while at < data.len() {
        let command = data[at];
        at += 1;
        if command == 0 {
            return Err(Error::Invalid);
        }
        if command & 128 == 0 {
            let amount = usize::from(command);
            let end = at
                .checked_add(amount)
                .filter(|end| *end <= data.len())
                .ok_or(Error::Invalid)?;
            if result
                .len()
                .checked_add(amount)
                .filter(|n| *n <= target)
                .is_none()
            {
                return Err(Error::Invalid);
            }
            result.extend_from_slice(&data[at..end]);
            at = end;
        } else {
            let mut offset = 0usize;
            let mut size = 0usize;
            for bit in 0..7 {
                if command & (1 << bit) != 0 {
                    let value = usize::from(*data.get(at).ok_or(Error::Invalid)?);
                    at += 1;
                    if bit < 4 {
                        offset |= value << (bit * 8);
                    } else {
                        size |= value << ((bit - 4) * 8);
                    }
                }
            }
            if size == 0 {
                size = 0x10000;
            }
            let end = offset
                .checked_add(size)
                .filter(|end| *end <= base.len())
                .ok_or(Error::Invalid)?;
            if result
                .len()
                .checked_add(size)
                .filter(|n| *n <= target)
                .is_none()
            {
                return Err(Error::Invalid);
            }
            result.extend_from_slice(&base[offset..end]);
        }
    }
    if result.len() != target {
        return Err(Error::Invalid);
    }
    Ok(result)
}
