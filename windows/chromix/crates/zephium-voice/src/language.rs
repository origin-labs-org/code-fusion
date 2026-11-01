//! Matching a person's language to a recognizer locale.

/// Where a language is spoken by default when the person's region is not
/// one of the recognizer's variants.
const HOME: &[(&str, &str)] = &[
    ("ar", "SA"),
    ("da", "DK"),
    ("el", "GR"),
    ("en", "US"),
    ("es", "ES"),
    ("fa", "IR"),
    ("he", "IL"),
    ("hi", "IN"),
    ("ja", "JP"),
    ("ko", "KR"),
    ("ms", "MY"),
    ("nb", "NO"),
    ("pt", "BR"),
    ("sv", "SE"),
    ("uk", "UA"),
    ("vi", "VN"),
    ("zh", "CN"),
];

fn normal(tag: &str) -> String {
    tag.trim().replace('_', "-").to_ascii_lowercase()
}

fn language_of(tag: &str) -> &str {
    tag.split('-').next().unwrap_or_default()
}

fn region_of(tag: &str) -> Option<&str> {
    tag.split('-').skip(1).find(|part| {
        (part.len() == 2 && part.bytes().all(|b| b.is_ascii_alphabetic()))
            || (part.len() == 3 && part.bytes().all(|b| b.is_ascii_digit()))
    })
}

/// The entry of `supported` (recognizer locales, `_` or `-` separated) that
/// best serves `wanted` (a BCP 47 tag): the exact locale, then the language
/// in the tag's region, the person's `region`, its home region, and finally
/// any variant of the language. Returns the entry as `supported` spells it.
pub fn pick_locale(supported: &[String], wanted: &str, region: Option<&str>) -> Option<String> {
    let wanted = normal(wanted);
    let language = language_of(&wanted);
    if language.is_empty() {
        return None;
    }
    let find = |tag: &str| {
        supported
            .iter()
            .find(|candidate| normal(candidate) == tag)
            .cloned()
    };
    let home = HOME
        .iter()
        .find(|(code, _)| *code == language)
        .map(|(_, region)| region.to_ascii_lowercase())
        .unwrap_or_else(|| language.to_owned());
    let regions = [
        region_of(&wanted).map(str::to_owned),
        region.map(str::to_ascii_lowercase),
        Some(home),
    ];
    find(&wanted)
        .or_else(|| {
            regions
                .iter()
                .flatten()
                .find_map(|region| find(&format!("{language}-{region}")))
        })
        .or_else(|| {
            let mut variants: Vec<&String> = supported
                .iter()
                .filter(|candidate| language_of(&normal(candidate)) == language)
                .collect();
            variants.sort();
            variants.first().map(|variant| (*variant).clone())
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn supported() -> Vec<String> {
        [
            "en_US", "en_GB", "en_AU", "pl_PL", "pt_PT", "pt_BR", "de_DE", "de_AT", "zh_CN",
            "zh_TW", "yue_CN",
        ]
        .map(str::to_owned)
        .to_vec()
    }

    #[test]
    fn the_exact_locale_wins() {
        assert_eq!(
            pick_locale(&supported(), "en-GB", None).as_deref(),
            Some("en_GB")
        );
        assert_eq!(
            pick_locale(&supported(), "pt_PT", Some("BR")).as_deref(),
            Some("pt_PT")
        );
    }

    #[test]
    fn a_bare_language_takes_the_persons_region_then_its_home() {
        assert_eq!(
            pick_locale(&supported(), "en", Some("AU")).as_deref(),
            Some("en_AU")
        );
        assert_eq!(
            pick_locale(&supported(), "en", Some("PL")).as_deref(),
            Some("en_US")
        );
        assert_eq!(
            pick_locale(&supported(), "pl", Some("US")).as_deref(),
            Some("pl_PL")
        );
        assert_eq!(
            pick_locale(&supported(), "pt", None).as_deref(),
            Some("pt_BR")
        );
        assert_eq!(
            pick_locale(&supported(), "de", Some("AT")).as_deref(),
            Some("de_AT")
        );
    }

    #[test]
    fn a_region_the_recognizer_lacks_falls_back_within_the_language() {
        assert_eq!(
            pick_locale(&supported(), "en-PL", Some("PL")).as_deref(),
            Some("en_US")
        );
        assert_eq!(
            pick_locale(&supported(), "de-CH", None).as_deref(),
            Some("de_DE")
        );
        assert_eq!(
            pick_locale(&supported(), "zh-Hant-TW", None).as_deref(),
            Some("zh_TW")
        );
    }

    #[test]
    fn an_unsupported_language_has_no_locale() {
        assert_eq!(pick_locale(&supported(), "cy", Some("GB")), None);
        assert_eq!(pick_locale(&supported(), "", None), None);
        assert_eq!(pick_locale(&supported(), "yu", None), None);
    }
}
