//! The server's minimum client version against this build's.

/// Whether `current` is older than `minimum`. Versions are dotted numbers with
/// an optional pre-release suffix, which sorts before its release. Anything
/// unreadable never reads as too old: the hint is the server's, not a gate.
pub fn older_than(current: &str, minimum: &str) -> bool {
    let (Some(current), Some(minimum)) = (parse(current), parse(minimum)) else {
        return false;
    };
    match current.0.cmp(&minimum.0) {
        std::cmp::Ordering::Less => true,
        std::cmp::Ordering::Greater => false,
        std::cmp::Ordering::Equal => current.1 && !minimum.1,
    }
}

/// The numbers, padded to three, and whether a pre-release suffix follows.
fn parse(text: &str) -> Option<([u64; 3], bool)> {
    let text = text.trim().trim_start_matches('v');
    let text = text.split('+').next()?;
    let (numbers, pre) = match text.split_once('-') {
        Some((numbers, pre)) => (numbers, !pre.is_empty()),
        None => (text, false),
    };
    let mut parts = [0; 3];
    for (index, part) in numbers.split('.').enumerate() {
        if index == 3 || part.is_empty() || !part.bytes().all(|b| b.is_ascii_digit()) {
            return None;
        }
        parts[index] = part.parse().ok()?;
    }
    Some((parts, pre))
}

#[cfg(test)]
mod tests {
    use super::older_than;

    #[test]
    fn versions_compare_by_number_with_pre_releases_first() {
        assert!(older_than("0.9.3", "1.0.0"));
        assert!(older_than("1.0.0-beta.2", "1.0.0"));
        assert!(older_than("1.2", "1.2.1"));
        assert!(!older_than("1.0.0", "1.0.0"));
        assert!(!older_than("1.10.0", "1.9.9"));
        assert!(!older_than("1.0.0", "1.0.0-beta.1"));
        assert!(!older_than("1.0.0", ""));
        assert!(!older_than("dev", "1.0.0"));
        assert!(!older_than("1.0.0", "2.x"));
    }
}
