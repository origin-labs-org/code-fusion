//! Release-excluded counts stripped before the shipping observation decoder.
use std::sync::atomic::{AtomicBool, Ordering};
#[path = "agentic_media_name_probe.rs"]
mod names;
pub(crate) use names::NameRows;
static ENABLED: AtomicBool = AtomicBool::new(false);
pub(super) fn configure(public: bool, account: bool) {
    ENABLED.store(public && !account, Ordering::Release);
    names::configure(public && !account);
}
pub(super) fn enabled() -> bool {
    ENABLED.load(Ordering::Acquire)
}

pub(super) fn source(original: &str) -> Option<String> {
    let replacements = [
        ("const snapshots=new Map(), style=", "let md=[0,0,0,0],mr=[0,0,0,0];const snapshots=new Map(), style="),
        ("function evidence(records, invocation, generation, helpers) {", "function evidence(records, invocation, generation, helpers) {md=[0,0,0,0];"),
        ("    let work=0;", "    let work=0;md[1]=candidates.length;"),
        ("if(work>16384 || !images.length)return [];", "if(work>16384)return (md[0]=2,md[2]=Math.min(work,16385),[]);if(!images.length)return (md[0]=1,[]);"),
        ("    remember(invocation,generation,records,rows);", "    md[2]=Math.min(work,16385);md[3]=rows.length;remember(invocation,generation,records,rows);"),
        ("Object.freeze({evidence,invoke})", "Object.freeze({evidence,invoke,diagnostic:()=>md})"),
        ("  function mediaEvidence(records, request) {", "  let mediaDiagnostic=[0,0,0,0];\n  function mediaEvidence(records, request) {"),
        ("try { return globalThis.__zephiumRecordMediaV1.evidence(records,", "try { const result=globalThis.__zephiumRecordMediaV1.evidence(records,"),
        ("imageNaturalWidthGetter,pageTitleText}); } catch (_) { return []; }", "imageNaturalWidthGetter,pageTitleText});mediaDiagnostic=globalThis.__zephiumRecordMediaV1.diagnostic();return result; } catch (_) {mediaDiagnostic=[3,0,0,0]; return []; }"),
        ("if (utf8Length(enriched,request.b.w+1) <= request.b.w) value = enriched;", "if (utf8Length(enriched,request.b.w+1) <= request.b.w) value = enriched;else mediaDiagnostic[0]=4;"),
        ("    return encoded.value;", "    return 'MD1:'+mediaDiagnostic.join(',')+'\\n'+encoded.value;"),
        ("  async function invoke(encoded,privacy) {", "  async function invoke(encoded,privacy){mr=[0,0,0,0];const result=await runMedia(encoded,privacy);return 'MR1:'+mr.join(',')+'\\n'+result;}\n  async function runMedia(encoded,privacy) {"),
        ("    const current=target(request);if(!current)return stringify({v:1,s:\"unavailable\"});", "    const current=target(request);if(!current)return stringify({v:1,s:\"unavailable\"});mr[0]=[\"image\",\"background\",\"poster\",\"svg\",\"canvas\",\"page_image\",\"graphic\",\"record\"].indexOf(current.entry.kind)+1;"),
        ("    const url=current.url;", "    mr[1]=1;const url=current.url;"),
        ("    let parsed;try {parsed=new URL(url,document.baseURI);}", "    mr[1]=2;let parsed;try {parsed=new URL(url,document.baseURI);}"),
        ("    const abort=new AbortController();pending=abort;", "    mr[1]=3;const abort=new AbortController();pending=abort;"),
        ("      if(!response.ok || ![\"image/png\",\"image/jpeg\",\"image/webp\"].includes(type) ||", "      mr[1]=4;mr[2]=([\"image/png\",\"image/jpeg\",\"image/webp\"].indexOf(type)+1)||4;\n      if(!response.ok || ![\"image/png\",\"image/jpeg\",\"image/webp\"].includes(type) ||"),
        ("      const reader=response.body.getReader(),parts=[];let total=0;", "      mr[1]=5;const reader=response.body.getReader(),parts=[];let total=0;"),
        ("      const output=await sanitize(parts,total,type,abort.signal);", "      mr[1]=6;const output=await sanitize(parts,total,type,abort.signal);mr[1]=7;"),
        ("      return stringify({v:1,s:\"fetch\",i:request.i,g:request.g,k:request.k,n:request.n,bytes:encode(binary)});", "      mr[1]=8;return stringify({v:1,s:\"fetch\",i:request.i,g:request.g,k:request.k,n:request.n,bytes:encode(binary)});"),
        ("    } catch(_) {\n      if(request.p===1", "    } catch(_) {mr[3]=Number(abort.signal.aborted);\n      if(request.p===1"),
    ];
    let mut source = original.to_owned();
    for (from, to) in replacements {
        if source.matches(from).count() != 1 {
            return None;
        }
        source = source.replacen(from, to, 1);
    }
    let start = source.find("  function evidence(")?;
    let end = source[start..].find("\n  function target(")? + start;
    let body = &source[start..end];
    if body.matches("return [];").count() != 3 || body.matches("break association;").count() != 4 {
        return None;
    }
    let body = body
        .replace(
            "return [];",
            "return (md[0]=2,md[2]=Math.min(work,16385),[]);",
        )
        .replace("break association;", "{md[0]=2;break association;}");
    source.replace_range(start..end, &body);
    if source.len() > original.len() + 4096 {
        return None;
    }
    names::instrument(&source)
}

/// Borrows precisely the original snapshot tail; invalid envelopes remain invalid
/// shipping input. No parsed counter can become a semantic node or receipt.
pub(super) fn split(bytes: &[u8]) -> Option<([u32; 4], &[u8])> {
    let rest = bytes.strip_prefix(b"MD1:")?;
    let end = rest.iter().take(48).position(|b| *b == b'\n')?;
    let header = std::str::from_utf8(&rest[..end]).ok()?;
    let values = header.split(',').collect::<Vec<_>>();
    if values.len() != 4 {
        return None;
    }
    let mut counts = [0; 4];
    for (value, out) in values.into_iter().zip(&mut counts) {
        if value.is_empty() || !value.bytes().all(|b| b.is_ascii_digit()) {
            return None;
        }
        *out = value.parse().ok()?;
    }
    if counts[0] > 4 || counts[1] > 1536 || counts[2] > 16385 || counts[3] > 48 {
        return None;
    }
    let payload = &rest[end + 1..];
    payload.starts_with(b"{").then_some((counts, payload))
}
#[allow(clippy::print_stderr)]
pub(super) fn normalize(bytes: &[u8]) -> &[u8] {
    if enabled() {
        if let Some((counts, payload)) = split(bytes) {
            eprintln!(
                "record-media-native: status={} candidates={} work={} rows={} content=redacted",
                counts[0], counts[1], counts[2], counts[3]
            );
            return payload;
        }
    }
    bytes
}
/// Separates native-only per-node counters before even the shipping decoder sees
/// the body. A malformed envelope remains invalid; it cannot add semantic nodes.
pub(super) fn normalize_names(bytes: &[u8]) -> (Option<NameRows>, &[u8]) {
    if enabled() {
        if let Some((rows, original)) = names::split(bytes) {
            return (Some(rows), normalize(original));
        }
    }
    (None, normalize(bytes))
}
pub(super) fn remember_names(
    snapshot: &zephium_agentic::SemanticSnapshot,
    rows: Option<NameRows>,
    original: &[u8],
) {
    if let Some(rows) = rows {
        names::remember(snapshot, rows, original);
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_bounded_closed_counts_are_stripped_and_payload_is_exact() {
        let original =
            b"{\"v\":1,\"i\":7,\"g\":9,\"c\":\"complete\",\"n\":[{\"k\":1,\"r\":\"document\"}]}";
        for status in 0..=4 {
            let mut wrapped = format!("MD1:{status},24,16385,48\n").into_bytes();
            wrapped.extend_from_slice(original);
            let (counts, tail) = split(&wrapped).unwrap();
            assert_eq!(tail, original);
            assert!(std::ptr::eq(
                tail.as_ptr(),
                wrapped[wrapped.len() - original.len()..].as_ptr()
            ));
            assert_eq!(counts, [status, 24, 16385, 48]);
        }
        for invalid in [
            "MD1:5,0,0,0\n{}",
            "MD1:0,1537,0,0\n{}",
            "MD1:0,0,16386,0\n{}",
            "MD1:0,0,0,49\n{}",
            "MD1:0,0,0,0,0\n{}",
            "MD1:secret,0,0,0\n{}",
            "MD1:0,0,0,0\nE1:unsupported_scope",
        ] {
            assert!(split(invalid.as_bytes()).is_none());
        }
    }
    #[test]
    fn account_activity_disables_activation_and_normalization() {
        let bytes = b"MD1:0,1,2,3\n{}";
        let media = b"MR1:1,8,1,0\n{\"s\":\"fetch\",\"bytes\":\"SYNTHETIC_PIXEL_SENTINEL\"}";
        for (public, account) in [(false, false), (true, false), (false, true), (true, true)] {
            configure(public, account);
            assert_eq!(enabled(), public && !account);
            let name_bytes = b"MN1:[[4,0,[]]]\nMD1:0,1,2,3\n{}";
            let (rows, original) = normalize_names(name_bytes);
            assert_eq!(rows.is_some(), public && !account);
            assert_eq!(
                original,
                if public && !account {
                    b"{}".as_slice()
                } else {
                    name_bytes.as_slice()
                }
            );
            let malformed = b"MN1:[[4,\"not-a-count\",[]]]\nMD1:0,1,2,3\n{}";
            let (rows, original) = normalize_names(malformed);
            assert!(rows.is_none());
            assert_eq!(original, malformed);

            assert_eq!(
                normalize_media(media),
                if public && !account {
                    &media[12..]
                } else {
                    media.as_slice()
                }
            );
            assert_eq!(
                normalize(bytes),
                if public && !account {
                    b"{}".as_slice()
                } else {
                    bytes.as_slice()
                }
            );
        }
        configure(false, false);
    }
    #[test]
    fn exact_source_anchors_fail_closed_without_changing_shipping_program() {
        let original = zephium_agentic::SEMANTIC_RUNTIME_PROGRAM.installation_source();
        let instrumented = source(original).unwrap();
        assert!(instrumented.contains("MD1:"));
        assert!(!original.contains("MD1:"));
        assert!(source(&original.replace(
            "function mediaEvidence(records, request)",
            "function mediaEvidenceChanged(records, request)"
        ))
        .is_none());
        assert!(!instrumented.contains("console.log"));
    }
}

/// Pixel-bearing result normalization is local only. The original payload is
/// borrowed intact; only four bounded integers can enter the probe log.
fn split_media(bytes: &[u8]) -> Option<([u32; 4], &[u8])> {
    let rest = bytes.strip_prefix(b"MR1:")?;
    let end = rest.iter().take(32).position(|b| *b == b'\n')?;
    let header = std::str::from_utf8(&rest[..end]).ok()?;
    let mut values = header.split(',');
    let mut counts = [0; 4];
    for (out, limit) in counts.iter_mut().zip([8, 8, 4, 1]) {
        let value = values.next()?;
        if value.is_empty() || !value.bytes().all(|b| b.is_ascii_digit()) {
            return None;
        }
        *out = value.parse().ok()?;
        if *out > limit {
            return None;
        }
    }
    if values.next().is_some() {
        return None;
    }
    let payload = &rest[end + 1..];
    payload.starts_with(b"{").then_some((counts, payload))
}
#[allow(clippy::print_stderr)]
pub(super) fn normalize_media(bytes: &[u8]) -> &[u8] {
    if enabled() {
        if let Some((counts, payload)) = split_media(bytes) {
            let stage = [
                "TargetOrInput",
                "MissingSource",
                "UnsupportedSource",
                "NetworkOrCors",
                "ResponseAdmission",
                "BodyRead",
                "Decode",
                "SourceCheck",
                "Fetched",
            ][counts[1] as usize];
            eprintln!(
                "record-media-result: kind={} stage={stage} format={} aborted={} content=redacted",
                counts[0], counts[2], counts[3]
            );
            return payload;
        }
    }
    bytes
}
#[cfg(test)]
mod media_result_tests {
    use super::*;
    #[test]
    fn media_envelope_is_bounded_and_retains_exact_local_payload() {
        let payload = b"{\"v\":1,\"s\":\"fetch\",\"bytes\":\"SYNTHETIC_PIXEL_SENTINEL\"}";
        let mut wrapped = b"MR1:1,8,1,0\n".to_vec();
        wrapped.extend_from_slice(payload);
        let (counts, original) = split_media(&wrapped).unwrap();
        assert_eq!(counts, [1, 8, 1, 0]);
        assert_eq!(original, payload);
        assert!(std::ptr::eq(
            original.as_ptr(),
            wrapped[wrapped.len() - payload.len()..].as_ptr()
        ));
        for bad in [
            "MR1:9,0,0,0\n{}",
            "MR1:0,9,0,0\n{}",
            "MR1:0,0,5,0\n{}",
            "MR1:0,0,0,2\n{}",
            "MR1:0,0,0,0,1\n{}",
            "MR1:secret,0,0,0\n{}",
        ] {
            assert!(split_media(bad.as_bytes()).is_none());
        }
    }
}
