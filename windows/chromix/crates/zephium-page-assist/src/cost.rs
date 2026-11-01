//! The cost line under an answer, as decimal strings the panel shows as is.

/// Zephium AI credits from charged units: hundredths below one credit, tenths
/// above, rounded up so a small charge never reads as free.
pub fn credits(charged_units: u64, units_per_credit: u64) -> Option<String> {
    if units_per_credit == 0 {
        return None;
    }
    if charged_units == 0 {
        return Some("0".to_owned());
    }
    let charged = u128::from(charged_units);
    let per = u128::from(units_per_credit);
    let hundredths = (charged * 100).div_ceil(per);
    if hundredths < 100 {
        return Some(decimal(hundredths, 2));
    }
    Some(decimal((charged * 10).div_ceil(per), 1))
}

/// US dollars from micro-dollars, to two significant digits (two decimals
/// from one dollar up).
pub fn usd(micros: u64) -> String {
    if micros == 0 {
        return "0".to_owned();
    }
    let micros = u128::from(micros);
    if micros >= 1_000_000 {
        return decimal((micros + 5_000) / 10_000, 2);
    }
    let digits = micros.ilog10() + 1;
    let places = (6 - digits + 2).min(6);
    let divisor = 10u128.pow(6 - places);
    decimal((micros + divisor / 2) / divisor, places)
}

fn hundredths(credits: &str) -> Option<u128> {
    let (whole, fraction) = credits.split_once('.').unwrap_or((credits, ""));
    if whole.is_empty()
        || whole.len() > 18
        || fraction.len() > 6
        || !whole
            .bytes()
            .chain(fraction.bytes())
            .all(|b| b.is_ascii_digit())
    {
        return None;
    }
    let micro: u128 = format!("{fraction:0<6}").parse().ok()?;
    Some(whole.parse::<u128>().ok()? * 100 + micro.div_ceil(10_000))
}

/// The sum of two credit amounts as shown, in hundredths.
pub fn add_credits(total: Option<&str>, more: &str) -> Option<String> {
    let sum = total.map_or(Some(0), hundredths)? + hundredths(more)?;
    Some(decimal(sum, 2))
}

/// `value / 10^places`, trailing zeros trimmed.
fn decimal(value: u128, places: u32) -> String {
    let scale = 10u128.pow(places);
    let whole = value / scale;
    let fraction = value % scale;
    if fraction == 0 {
        return whole.to_string();
    }
    let fraction = format!("{fraction:0width$}", width = places as usize);
    format!("{whole}.{}", fraction.trim_end_matches('0'))
}

/// A price per million tokens times tokens, in micro-dollars.
pub fn estimate_micros(
    input_tokens: u64,
    output_tokens: u64,
    input_micros_per_million: u64,
    output_micros_per_million: u64,
) -> u64 {
    let input = u128::from(input_tokens) * u128::from(input_micros_per_million);
    let output = u128::from(output_tokens) * u128::from(output_micros_per_million);
    u64::try_from(input.saturating_add(output).div_ceil(1_000_000)).unwrap_or(u64::MAX)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn credits_add_up_as_shown() {
        assert_eq!(add_credits(None, "0.3").as_deref(), Some("0.3"));
        assert_eq!(add_credits(Some("0.3"), "1.25").as_deref(), Some("1.55"));
        assert_eq!(add_credits(Some("2"), "0.001").as_deref(), Some("2.01"));
        assert_eq!(add_credits(Some("x"), "1"), None);
        assert_eq!(add_credits(None, "-1"), None);
    }

    #[test]
    fn credits_round_up_and_read_naturally() {
        for (charged, per, expected) in [
            (0, 10_000, Some("0")),
            (1, 10_000, Some("0.01")),
            (3_000, 10_000, Some("0.3")),
            (2_999, 10_000, Some("0.3")),
            (9_999, 10_000, Some("1")),
            (12_000, 10_000, Some("1.2")),
            (12_001, 10_000, Some("1.3")),
            (50_000, 10_000, Some("5")),
            (1, 0, None),
        ] {
            assert_eq!(
                credits(charged, per).as_deref(),
                expected,
                "{charged}/{per}"
            );
        }
    }

    #[test]
    fn dollars_keep_two_significant_digits() {
        for (micros, expected) in [
            (0, "0"),
            (1, "0.000001"),
            (4_000, "0.004"),
            (4_321, "0.0043"),
            (120_000, "0.12"),
            (999_999, "1"),
            (1_234_567, "1.23"),
            (u64::MAX, "18446744073709.55"),
        ] {
            assert_eq!(usd(micros), expected, "{micros}");
        }
    }

    #[test]
    fn estimates_round_up() {
        assert_eq!(estimate_micros(1_000, 500, 150_000, 600_000), 450);
        assert_eq!(estimate_micros(1, 0, 1, 0), 1);
        assert_eq!(
            estimate_micros(u64::MAX, u64::MAX, u64::MAX, u64::MAX),
            u64::MAX
        );
    }
}
