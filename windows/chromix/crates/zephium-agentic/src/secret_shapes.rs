//! Conservative recognizable-secret shapes shared by model disclosure boundaries.
//!
//! This heuristic does not identify arbitrary secrets. Callers must independently
//! enforce path, authorization and input/output-size limits.

/// Reports recognizable credential, authorization and private-key shapes in
/// already-bounded text. Returns no matched text and performs no logging.
pub fn contains_recognized_secret(value: &str) -> bool {
    let trimmed = value.trim();
    if trimmed.len() < 8 {
        return false;
    }
    let lower = trimmed.to_ascii_lowercase();
    if lower.contains("-----begin private key-----")
        || lower.contains("-----begin rsa private key-----")
        || lower.contains("-----begin ec private key-----")
        || lower.contains("-----begin openssh private key-----")
        || lower.contains("-----begin dsa private key-----")
        || lower.contains("-----begin encrypted private key-----")
        || lower.contains("-----begin pgp private key block-----")
        || contains_authorization_value(&lower)
    {
        return true;
    }
    trimmed
        .split(|character: char| {
            !character.is_ascii_alphanumeric() && !matches!(character, '_' | '-' | '.')
        })
        .filter(|token| token.len() >= 8)
        .any(looks_like_secret_token)
}

fn contains_authorization_value(value: &str) -> bool {
    let mut prior_was_scheme = false;
    for word in value.split_ascii_whitespace() {
        let word = word.trim_matches(|character: char| !character.is_ascii_alphanumeric());
        if prior_was_scheme && word.len() >= 12 {
            return true;
        }
        prior_was_scheme = matches!(word, "bearer" | "basic");
    }
    false
}

fn looks_like_secret_token(token: &str) -> bool {
    let lower = token.to_ascii_lowercase();
    if lower.starts_with("sk-")
        || lower.starts_with("sk_live_")
        || lower.starts_with("rk_live_")
        || lower.starts_with("ghp_")
        || lower.starts_with("github_pat_")
        || lower.starts_with("glpat-")
        || lower.starts_with("xoxb-")
        || lower.starts_with("xoxp-")
        || token.starts_with("AKIA")
        || token.starts_with("ASIA")
        || token.starts_with("AIza")
    {
        return true;
    }
    let mut jwt_parts = token.split('.');
    matches!(
        (
            jwt_parts.next(),
            jwt_parts.next(),
            jwt_parts.next(),
            jwt_parts.next()
        ),
        (Some(header), Some(payload), Some(signature), None)
            if header.starts_with("eyJ")
                && payload.len() >= 8
                && signature.len() >= 8
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn recognized_shapes_and_ordinary_text() {
        for kind in [
            "PRIVATE KEY",
            "RSA PRIVATE KEY",
            "EC PRIVATE KEY",
            "OPENSSH PRIVATE KEY",
            "DSA PRIVATE KEY",
            "ENCRYPTED PRIVATE KEY",
            "PGP PRIVATE KEY BLOCK",
        ] {
            assert!(contains_recognized_secret(&format!(
                "prefix -----BEGIN {kind}----- suffix"
            )));
        }
        for value in [
            "ghp_inertFixtureToken",
            "sk-inertFixtureToken",
            "Bearer inertFixtureValue",
            "AKIAINERTFIXTUREVALUE",
            "eyJfixture.payloadFixture.signatureFixture",
        ] {
            assert!(contains_recognized_secret(value));
        }
        for value in [
            "fn main() {}",
            "public key",
            "a normal README",
            "version 1.2.3",
        ] {
            assert!(!contains_recognized_secret(value));
        }
    }
}
