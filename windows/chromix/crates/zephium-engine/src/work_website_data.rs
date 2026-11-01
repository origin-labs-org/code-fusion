//! Work's own website data: one persistent store per profile for the pages
//! Work opens without the person's session. It is apart from the profile's
//! store and from every run's anonymous store, and is erased with the profile.
use sha2::{Digest, Sha256};
use zephium_core::ids::ProfileId;

const DOMAIN: &[u8] = b"zephium.work-website-data.v1\0";

/// Stable native identifier of the profile's Work store; never the profile's.
pub(crate) fn identifier(profile: ProfileId) -> [u8; 16] {
    let digest = Sha256::new()
        .chain_update(DOMAIN)
        .chain_update(profile.bytes())
        .finalize();
    let mut id = [0_u8; 16];
    id.copy_from_slice(&digest[..16]);
    // WebKit takes the identifier as an RFC 9562 UUID; version 8 is custom.
    id[6] = (id[6] & 0x0f) | 0x80;
    id[8] = (id[8] & 0x3f) | 0x80;
    if id == profile.bytes() {
        id[15] ^= 1;
    }
    id
}

/// The Work store's own native profile key, for platforms that keep stores
/// in per-profile folders.
#[cfg(any(target_os = "windows", test))]
pub(crate) fn native_profile(profile: ProfileId) -> ProfileId {
    ProfileId::from(u128::from_be_bytes(identifier(profile)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identifier_is_stable_distinct_and_never_the_profiles_own() {
        let first = ProfileId::generate();
        let second = ProfileId::generate();
        assert_eq!(identifier(first), identifier(first));
        assert_ne!(identifier(first), identifier(second));
        assert_ne!(identifier(first), first.bytes());
        assert_eq!(identifier(first)[6] >> 4, 8);
        assert_eq!(identifier(first)[8] >> 6, 2);
        assert_eq!(native_profile(first).bytes(), identifier(first));
        assert_ne!(native_profile(first), first);
    }
}
