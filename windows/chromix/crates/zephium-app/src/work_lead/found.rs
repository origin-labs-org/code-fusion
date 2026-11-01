//! What a browser part's pages found, as the part's picks. A part that ends
//! without an object of its own still shows the records its pages gave, so a
//! request whose pages gave records never ends on a reply alone.
use serde_json::{json, Map, Value};
use zephium_core::work::{
    artifact::{WorkArtifactDataV1, WorkCellValue, WorkEvidenceLink},
    objects::limit,
    runtime::{WorkExecutionFact, WorkStepKindV1, WorkStepStatus},
    WorkPartId,
};

use super::call::clip;

/// Items a part's own picks hold: enough to choose between, small on its row.
const MAX_ITEMS: usize = 6;

/// One record a page gave, with the evidence its values rest on.
#[derive(Clone, Debug, Default, PartialEq)]
pub(crate) struct Row {
    pub name: String,
    pub subtitle: Option<String>,
    pub url: Option<String>,
    pub images: Vec<String>,
    pub price: Option<String>,
    pub rating: Option<String>,
    pub facts: Vec<(String, String)>,
    pub source: Option<WorkEvidenceLink>,
    /// The page the record was read on.
    pub page: String,
}

/// How surely a column holds the price to show, lower first: a nightly
/// rate, then a price, then a total or a bare amount. None for no price.
pub(super) fn price_rank(name: &str) -> Option<u8> {
    let has = |words: &[&str]| words.iter().any(|w| name.contains(w));
    if has(&["night", "per_day", "daily"]) {
        Some(0)
    } else if has(&["price", "cost", "fare", "rate", "cena", "preis", "prix"]) && !has(&["rating"])
    {
        Some(1)
    } else if has(&["total", "amount", "eur", "usd", "pln", "gbp"]) {
        Some(2)
    } else {
        None
    }
}

/// What kind of things the picks hold.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum Facet {
    Product,
    Stay,
    Flight,
    Place,
}
impl Facet {
    fn wire(self) -> &'static str {
        match self {
            Self::Product => "product",
            Self::Stay => "stay",
            Self::Flight => "flight",
            Self::Place => "place",
        }
    }
    fn noun(self) -> &'static str {
        match self {
            Self::Product => "Offers",
            Self::Stay => "Stays",
            Self::Flight => "Flights",
            Self::Place => "Results",
        }
    }
}

/// The records the part's pages gave, in the order the pages showed them.
pub(crate) fn rows(execution: &WorkExecutionFact, part: WorkPartId) -> Vec<Row> {
    let mut out = Vec::new();
    for step in execution.steps.iter().filter(|s| {
        s.part == Some(part)
            && s.status == WorkStepStatus::Succeeded
            && matches!(s.kind, WorkStepKindV1::Read { .. })
    }) {
        let WorkStepKindV1::Read { url, .. } = &step.kind else {
            continue;
        };
        for artifact in step
            .artifacts
            .iter()
            .filter_map(|id| execution.artifacts.iter().find(|a| a.id == *id))
        {
            let WorkArtifactDataV1::ComparisonMatrix {
                subjects,
                criteria,
                cells,
                ..
            } = &artifact.data
            else {
                continue;
            };
            for (subject, row) in subjects.iter().zip(cells) {
                let mut found = Row {
                    name: subject.name.trim().to_owned(),
                    subtitle: subject.descriptor.clone(),
                    url: subject.homepage.clone(),
                    images: subject.image_candidates.clone(),
                    page: url.clone(),
                    ..Row::default()
                };
                let mut prices: Vec<(u8, String, String)> = Vec::new();
                for (criterion, cell) in criteria.iter().zip(row) {
                    let value = match &cell.value {
                        WorkCellValue::Text { text } => text.trim().to_owned(),
                        WorkCellValue::Measurement { value } => value.clone(),
                        WorkCellValue::Money {
                            amount, currency, ..
                        } => format!("{amount} {currency}"),
                        WorkCellValue::Rating { value } => value.to_string(),
                        WorkCellValue::Presence { present } => {
                            if *present { "yes" } else { "no" }.into()
                        }
                        WorkCellValue::Unknown => continue,
                    };
                    if value.is_empty() {
                        continue;
                    }
                    if found.source.is_none() {
                        found.source = cell
                            .evidence
                            .first()
                            .and_then(|i| artifact.evidence.get(usize::from(*i)))
                            .cloned();
                    }
                    let name = criterion.name.to_ascii_lowercase();
                    let is = |words: &[&str]| words.iter().any(|w| name.contains(w));
                    if let Some(rank) = price_rank(&name) {
                        prices.push((rank, criterion.name.clone(), value));
                    } else if is(&["rating", "stars", "score", "review", "ocena"])
                        && found.rating.is_none()
                    {
                        found.rating = Some(value);
                    } else if is(&["url", "link"]) {
                        if found.url.is_none() && value.starts_with("https://") {
                            found.url = Some(value);
                        }
                    } else if is(&["image", "photo", "picture", "img"]) {
                        if value.starts_with("https://") && !found.images.contains(&value) {
                            found.images.push(value);
                        }
                    } else {
                        found.facts.push((criterion.name.clone(), value));
                    }
                }
                // A nightly price leads a stay; any other price is a fact
                // beside it.
                prices.sort_by_key(|(rank, ..)| *rank);
                let mut prices = prices.into_iter();
                found.price = prices.next().map(|(_, _, value)| value);
                for (_, name, value) in prices.rev() {
                    found.facts.insert(0, (name, value));
                }
                if found.source.is_none() {
                    found.source = artifact.evidence.first().cloned();
                }
                if !found.name.is_empty() {
                    out.push(found);
                }
            }
        }
    }
    out
}

/// What the picks hold, from what the part was asked to search.
pub(crate) fn facet(
    search: Option<&super::recipes::SiteSearch>,
    words: &str,
    rows: &[Row],
) -> Facet {
    if let Some(search) = search {
        if search.from.is_some() && search.to.is_some() {
            return Facet::Flight;
        }
        if search.place.is_some() && search.checkin.is_some() {
            return Facet::Stay;
        }
        if search.query.is_some() {
            return Facet::Product;
        }
    }
    let words = words.to_lowercase();
    let has = |list: &[&str]| list.iter().any(|w| words.contains(w));
    if has(&["flight", "fare", "airline"]) {
        Facet::Flight
    } else if has(&[
        "hotel",
        "stay",
        "apartment",
        "airbnb",
        "booking.com",
        "room",
        "hostel",
        "home",
    ]) {
        Facet::Stay
    } else if rows.iter().any(|row| row.price.is_some()) {
        Facet::Product
    } else {
        Facet::Place
    }
}

/// Words that ask for the lowest price first.
pub(crate) fn wants_cheapest(text: &str) -> bool {
    let text = text.to_lowercase();
    [
        "cheap",
        "lowest price",
        "best price",
        "least expensive",
        "najtań",
        "najtan",
        "günstig",
        "billigst",
        "le moins cher",
        "más barato",
    ]
    .iter()
    .any(|word| text.contains(word))
}

/// The picks a part's records make: the records that name the searched thing
/// (for a store search), at most six, the cheapest first when the request
/// asks for it, each pointing at the evidence its values came from. `None`
/// when no record stands.
pub(crate) fn picks(
    rows: &[Row],
    facet: Facet,
    query: Option<&str>,
    cheapest: bool,
    mut cite: impl FnMut(&WorkEvidenceLink, &str) -> String,
) -> Option<(Value, Vec<String>)> {
    let wanted = query.map(tokens).unwrap_or_default();
    let mut kept: Vec<&Row> = Vec::new();
    for row in rows {
        if facet == Facet::Product && !names_it(&row.name, row.url.as_deref(), &wanted) {
            continue;
        }
        let duplicate = kept.iter().any(|known| {
            known.name.eq_ignore_ascii_case(&row.name)
                && (known.price == row.price
                    || (known.url.is_some() && known.url == row.url && !root(row.url.as_deref())))
        });
        if !duplicate {
            kept.push(row);
        }
    }
    // One address on records of different things belongs to none of them
    // for sure: they stand without a link rather than with a wrong one.
    let shared: Vec<String> = kept
        .iter()
        .filter_map(|row| row.url.clone())
        .filter(|url| {
            kept.iter()
                .filter(|row| row.url.as_ref() == Some(url))
                .count()
                > 1
        })
        .collect();
    if cheapest {
        let shared = currency_of(&kept);
        kept.sort_by(|a, b| {
            let amount = |row: &Row| {
                row.price
                    .as_deref()
                    .map(price)
                    .filter(|(_, currency)| shared.is_none() || *currency == shared)
                    .and_then(|(amount, _)| amount)
                    .and_then(|a| a.parse::<f64>().ok())
            };
            match (amount(a), amount(b)) {
                (Some(x), Some(y)) => x.total_cmp(&y),
                (Some(_), None) => std::cmp::Ordering::Less,
                (None, Some(_)) => std::cmp::Ordering::Greater,
                (None, None) => std::cmp::Ordering::Equal,
            }
        });
    }
    // Records with nothing to choose by (no price, rating or picture) are
    // facts about one thing, not picks: the lead shapes them.
    if facet == Facet::Place
        && !kept
            .iter()
            .any(|row| row.price.is_some() || row.rating.is_some() || !row.images.is_empty())
    {
        return None;
    }
    kept.truncate(MAX_ITEMS);
    if kept.is_empty() {
        return None;
    }
    let mut sources: Vec<String> = Vec::new();
    let items: Vec<Value> = kept
        .iter()
        .map(|row| {
            let mut item = Map::new();
            item.insert("name".into(), json!(short(&row.name, limit::PICK_NAME)));
            if let Some(subtitle) = row
                .subtitle
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty() && !s.eq_ignore_ascii_case(&row.name))
            {
                item.insert(
                    "subtitle".into(),
                    json!(short(subtitle, limit::PICK_SUBTITLE)),
                );
            }
            if let Some(url) = row
                .url
                .as_deref()
                .filter(|url| !root(Some(url)) && !shared.iter().any(|s| s == url))
            {
                item.insert("url".into(), json!(url));
            }
            let images: Vec<&String> = row.images.iter().take(limit::PICK_IMAGES).collect();
            if !images.is_empty() {
                item.insert("image_candidates".into(), json!(images));
            }
            if let Some(display) = row.price.as_deref() {
                let (amount, currency) = price(display);
                let display = if display.chars().count() <= limit::PICK_PRICE {
                    Some(display.to_owned())
                } else {
                    amount.as_ref().map(|a| {
                        format!("{a} {}", currency.unwrap_or_default())
                            .trim()
                            .to_owned()
                    })
                };
                if let Some(display) = display {
                    let mut price = Map::new();
                    price.insert("display".into(), json!(display));
                    if let (Some(amount), Some(currency)) = (amount, currency) {
                        price.insert("amount".into(), json!(amount));
                        price.insert("currency".into(), json!(currency));
                    }
                    item.insert("price".into(), Value::Object(price));
                }
            }
            let mut facts: Vec<Value> = Vec::new();
            match row.rating.as_deref().and_then(rating) {
                Some((value, max)) => {
                    item.insert("rating".into(), json!({"value": value, "max": max}));
                }
                None => {
                    if let Some(said) = &row.rating {
                        facts.push(fact("Rating", said));
                    }
                }
            }
            for (label, value) in &row.facts {
                facts.push(fact(label, value));
            }
            facts.truncate(limit::PICK_FACTS);
            if !facts.is_empty() {
                item.insert("facts".into(), Value::Array(facts));
            }
            if let Some(link) = &row.source {
                let key = cite(link, &row.page);
                if !sources.contains(&key) {
                    sources.push(key.clone());
                }
                item.insert("source".into(), json!(key));
            }
            Value::Object(item)
        })
        .collect();
    Some((json!({"facet": facet.wire(), "items": items}), sources))
}

/// The picks' title: what they are and where they came from.
pub(crate) fn title(facet: Facet, site: Option<&str>, part: &str) -> String {
    let title = match site {
        Some(site) => format!("{} on {site}", facet.noun()),
        None => part.to_owned(),
    };
    clip(&title, super::objects::MAX_TITLE_CHARS)
}

fn fact(label: &str, value: &str) -> Value {
    let label = label.replace('_', " ");
    let mut chars = label.trim().chars();
    let label = match chars.next() {
        Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
        None => String::new(),
    };
    json!({
        "label": short(&label, limit::FACT_LABEL),
        "value": short(value, limit::PICK_FACT_VALUE),
        "kind": "text",
    })
}

/// At most `max` characters, cut at a word when one is near, one line.
fn short(text: &str, max: usize) -> String {
    let text = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if text.chars().count() <= max {
        return text;
    }
    let cut: String = text.chars().take(max.saturating_sub(1)).collect();
    let cut = match cut.rfind(' ') {
        Some(at) if at * 3 >= cut.len() * 2 => cut[..at].to_owned(),
        _ => cut,
    };
    format!("{}…", cut.trim_end_matches([',', ';', ':', '-', ' ']))
}

/// A site's front page, which says nothing about the record.
fn root(url: Option<&str>) -> bool {
    url.and_then(|url| url::Url::parse(url).ok())
        .is_some_and(|url| url.path().trim_matches('/').is_empty() && url.query().is_none())
}

const SMALL: [&str; 24] = [
    "new", "the", "and", "for", "with", "set", "buy", "best", "cheap", "cheapest", "price",
    "lowest", "nowy", "nowa", "nowe", "neu", "cena", "preis", "used", "sale", "shop", "store",
    "online", "deal",
];

/// The significant words of a search, folded: letters and digits only.
fn tokens(query: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for word in query.split_whitespace() {
        let folded: String = word
            .chars()
            .filter(|c| c.is_alphanumeric())
            .flat_map(char::to_lowercase)
            .collect();
        if folded.chars().count() >= 3
            && !SMALL.contains(&folded.as_str())
            && !out.contains(&folded)
        {
            out.push(folded);
        }
    }
    out
}

/// A record names the searched thing when most of the search's words, and
/// any model number in it, are in its name or address.
fn names_it(name: &str, url: Option<&str>, wanted: &[String]) -> bool {
    if wanted.is_empty() {
        return true;
    }
    let folded: String = format!("{name} {}", url.unwrap_or_default())
        .chars()
        .filter(|c| c.is_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect();
    let numbers: Vec<&String> = wanted
        .iter()
        .filter(|w| w.chars().filter(char::is_ascii_digit).count() >= 4)
        .collect();
    let hits = wanted
        .iter()
        .filter(|w| folded.contains(w.as_str()))
        .count();
    (numbers.is_empty() || numbers.iter().any(|n| folded.contains(n.as_str())))
        && hits * 2 >= wanted.len()
}

/// The one currency most kept records are priced in.
fn currency_of(rows: &[&Row]) -> Option<&'static str> {
    let mut counts: Vec<(&'static str, usize)> = Vec::new();
    for currency in rows
        .iter()
        .filter_map(|row| row.price.as_deref().map(price).and_then(|(_, c)| c))
    {
        match counts.iter_mut().find(|(known, _)| *known == currency) {
            Some((_, n)) => *n += 1,
            None => counts.push((currency, 1)),
        }
    }
    counts.into_iter().max_by_key(|(_, n)| *n).map(|(c, _)| c)
}

/// A price as a page shows it ("1 219,00 zł", "€339.99", "PLN 1,922.03"):
/// its plain decimal amount and ISO currency, each when it is clear.
pub(crate) fn price(display: &str) -> (Option<String>, Option<&'static str>) {
    let lower = display.to_lowercase();
    let currency = if lower.contains("zł") || lower.contains("pln") {
        Some("PLN")
    } else if lower.contains('€') || lower.contains("eur") {
        Some("EUR")
    } else if lower.contains('£') || lower.contains("gbp") {
        Some("GBP")
    } else if lower.contains("chf") {
        Some("CHF")
    } else if lower.contains("kč") || lower.contains("czk") {
        Some("CZK")
    } else if lower.contains("usd") || lower.contains("us$") || lower.contains('$') {
        Some("USD")
    } else {
        None
    };
    let start = display.find(|c: char| c.is_ascii_digit());
    let Some(start) = start else {
        return (None, currency);
    };
    let raw: String = display[start..]
        .chars()
        .take_while(|c| c.is_ascii_digit() || matches!(c, '.' | ',' | ' ' | '\u{a0}' | '\u{202f}'))
        .filter(|c| !c.is_whitespace() && *c != '\u{a0}' && *c != '\u{202f}')
        .collect();
    let raw = raw.trim_end_matches(['.', ',']);
    let decimal_at = match (raw.rfind('.'), raw.rfind(',')) {
        (Some(dot), Some(comma)) => Some(dot.max(comma)),
        (None, Some(comma)) if raw.len() - comma - 1 != 3 => Some(comma),
        (Some(dot), None)
            if raw.len() - dot - 1 != 3
                || raw.matches('.').count() == 1 && currency == Some("USD") =>
        {
            Some(dot)
        }
        _ => None,
    };
    let amount: String = raw
        .char_indices()
        .filter_map(|(at, c)| match c {
            '0'..='9' => Some(c),
            _ if Some(at) == decimal_at => Some('.'),
            _ => None,
        })
        .collect();
    let amount = amount.trim_start_matches('0');
    let amount = if amount.starts_with('.') || amount.is_empty() {
        format!("0{amount}")
    } else {
        amount.to_owned()
    };
    (
        amount
            .parse::<f64>()
            .ok()
            .filter(|v| *v > 0.0)
            .map(|_| amount),
        currency,
    )
}

/// A rating as a page shows it ("4.5 out of 5 stars", "8,7", "4.6/5"): its
/// value and scale, when both are clear.
fn rating(said: &str) -> Option<(String, u8)> {
    let lower = said.to_lowercase();
    let start = lower.find(|c: char| c.is_ascii_digit())?;
    let number: String = lower[start..]
        .chars()
        .take_while(|c| c.is_ascii_digit() || matches!(c, '.' | ','))
        .collect();
    let number = number.trim_end_matches(['.', ',']).replace(',', ".");
    let value: f64 = number.parse().ok()?;
    let rest = &lower[start + number.len()..];
    // "7,210 ratings" counts ratings; it is not one.
    if rest.trim_start().starts_with("rating")
        || rest.trim_start().starts_with("review")
        || rest.trim_start().starts_with("opini")
        || rest.trim_start().starts_with("bewertung")
    {
        return None;
    }
    let max = if lower.contains("/10") || lower.contains("of 10") || value > 5.0 {
        10
    } else {
        5
    };
    (value <= f64::from(max)).then_some((number, max))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(name: &str, price: Option<&str>, url: &str) -> Row {
        Row {
            name: name.into(),
            price: price.map(str::to_owned),
            url: Some(url.into()),
            page: "https://example.com/s?k=x".into(),
            ..Row::default()
        }
    }

    #[test]
    fn prices_read_as_pages_print_them() {
        assert_eq!(price("1 219,00 zł"), (Some("1219.00".into()), Some("PLN")));
        assert_eq!(price("€339.99"), (Some("339.99".into()), Some("EUR")));
        assert_eq!(price("PLN 1,922.03"), (Some("1922.03".into()), Some("PLN")));
        assert_eq!(price("1.299 €"), (Some("1299".into()), Some("EUR")));
        assert_eq!(price("$1,240 total"), (Some("1240".into()), Some("USD")));
        assert_eq!(price("$89.50 / night"), (Some("89.50".into()), Some("USD")));
        assert_eq!(price("Price on request"), (None, None));
    }

    #[test]
    fn ratings_keep_their_scale_and_counts_are_not_ratings() {
        assert_eq!(rating("4.5 out of 5 stars"), Some(("4.5".into(), 5)));
        assert_eq!(rating("Scored 8,7"), Some(("8.7".into(), 10)));
        assert_eq!(rating("4.6/5"), Some(("4.6".into(), 5)));
        assert_eq!(rating("7,210 ratings"), None);
    }

    #[test]
    fn a_store_search_keeps_the_records_that_name_the_thing_cheapest_first() {
        let rows = vec![
            row(
                "LEGO Technic 42115 Lamborghini Sián FKP 37, Model Kit for Adults, Collector's Item",
                Some("PLN 2,101.49"),
                "https://www.amazon.de/dp/B08G4LJY4Q",
            ),
            row("LEGO Technic 42143 Ferrari Daytona SP3", Some("PLN 1,499.00"), "https://www.amazon.de/dp/B0B"),
            row("Technic Lamborghini Sián 42115", Some("1 922,03 zł"), "https://www.amazon.de/dp/B0C"),
            row("Technic Lamborghini Sián 42115", Some("1 922,03 zł"), "https://www.amazon.de/dp/B0C"),
        ];
        let mut cited = 0;
        let (data, _) = picks(
            &rows,
            Facet::Product,
            Some("LEGO Technic 42115 Lamborghini Sián new"),
            true,
            |_, _| {
                cited += 1;
                format!("s{cited}")
            },
        )
        .unwrap();
        let items = data["items"].as_array().unwrap();
        assert_eq!(items.len(), 2, "{data}");
        assert_eq!(items[0]["price"]["amount"], "1922.03");
        assert_eq!(items[0]["price"]["currency"], "PLN");
        assert!(items[1]["name"].as_str().unwrap().chars().count() <= limit::PICK_NAME);
        assert_eq!(data["facet"], "product");
    }

    #[test]
    fn stays_show_their_nightly_price_and_no_link_shared_by_different_homes() {
        let home = |name: &str, total: &str, nightly: &str| Row {
            name: name.into(),
            url: Some("https://www.airbnb.com/rooms/17587616?adults=2".into()),
            price: Some(nightly.into()),
            facts: vec![("stay_total_eur".into(), total.into())],
            page: "https://www.airbnb.com/s/Lisbon/homes".into(),
            ..Row::default()
        };
        let rows = vec![
            home("Green Apartment", "€220 total", "€73.33 per night"),
            home("Studio with bathtub", "€235 total", "€78.33 per night"),
        ];
        let (data, _) = picks(&rows, Facet::Stay, None, false, |_, _| "s1".into()).unwrap();
        let items = data["items"].as_array().unwrap();
        assert_eq!(items.len(), 2, "{data}");
        assert!(items.iter().all(|item| item.get("url").is_none()), "{data}");
        assert_eq!(items[0]["price"]["display"], "€73.33 per night");
        assert_eq!(price_rank("stay_total_eur"), Some(2));
        assert_eq!(price_rank("nightly_eur"), Some(0));
        assert_eq!(price_rank("guest_rating"), None);
    }

    #[test]
    fn a_front_page_link_is_no_records_link() {
        let rows = vec![row(
            "Hotel Lisboa",
            Some("€120"),
            "https://www.booking.com/",
        )];
        let (data, _) = picks(&rows, Facet::Stay, None, false, |_, _| "s1".into()).unwrap();
        assert!(data["items"][0].get("url").is_none(), "{data}");
        assert!(wants_cheapest("Find the cheapest new LEGO set"));
        assert!(!wants_cheapest("Find a hotel in Lisbon"));
        assert_eq!(facet(None, "Find a hotel in Lisbon", &rows), Facet::Stay);
    }

    #[test]
    fn facts_about_one_thing_are_not_picks() {
        let facts = vec![
            row(
                "PR #1337",
                None,
                "https://github.com/crynta/terax/pull/1337",
            ),
            row(
                "PR author and date",
                None,
                "https://github.com/crynta/terax/pull/1337",
            ),
        ];
        assert!(picks(&facts, Facet::Place, None, false, |_, _| "s1".into()).is_none());
        let mut pictured = facts.clone();
        pictured[0].images = vec!["https://i.ytimg.com/vi/a/hqdefault.jpg".into()];
        assert!(picks(&pictured, Facet::Place, None, false, |_, _| "s1".into()).is_some());
    }
}
