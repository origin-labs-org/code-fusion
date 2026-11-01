//! Well-known bot checks a site shows in place of its page, told apart by
//! Rust from the first look: no model is asked whether a Cloudflare,
//! DataDome, hCaptcha or reCAPTCHA page is a check. A check that runs by
//! itself is waited out briefly and never shown to the person; one only a
//! person can pass goes to them at once.

use zephium_agentic::*;

use super::MAX_HUMAN_CHALLENGE_NODES;

/// What the check on a page asks for.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) enum KnownCheck {
    /// A script check that usually clears and reloads the page by itself.
    Automatic,
    /// A widget or step only a person can pass.
    Person,
}

/// Lines a script check shows while it runs. Matched at the start of short
/// node names and texts; page text is never kept or shown.
const AUTOMATIC_PHRASES: [&str; 7] = [
    "just a moment",
    "checking your browser",
    "checking if the site connection is secure",
    "verifying you are human",
    "performing security verification",
    "please wait while we verify",
    "please stand by, while we are checking your browser",
];
/// Lines of a check that waits for a person.
const PERSON_PHRASES: [&str; 14] = [
    "verify you are human",
    "please verify you are human",
    "let's confirm you are human",
    "confirm you are human",
    "are you a human",
    "are you a robot",
    "prove you are human",
    "press & hold",
    "press and hold",
    "human verification",
    "please complete the security check",
    "complete the security check",
    "i'm not a robot",
    "pardon our interruption",
];
/// Titles of a check widget's frame that runs by itself (Cloudflare
/// Turnstile, DataDome's device check). The frame is never read.
const AUTOMATIC_FRAME_TITLES: [&str; 2] = ["cloudflare security challenge", "device check"];
/// Titles of a check widget's frame a person has to answer.
const PERSON_FRAME_TITLES: [&str; 5] = [
    "hcaptcha",
    "recaptcha challenge",
    "captcha",
    "verify you are human",
    "arkose",
];
/// reCAPTCHA's checkbox and the score badge many pages carry share one frame
/// title; the checkbox is the wider one (304 against 256 CSS pixels).
const RECAPTCHA_CHECKBOX_MIN_WIDTH: u32 = 290;
/// Longest node text matched against the phrases.
const MAX_PHRASE_TEXT: usize = 96;

fn starts_with_any(text: &str, phrases: &[&str]) -> bool {
    let lower = text.trim().to_lowercase();
    phrases.iter().any(|phrase| lower.starts_with(phrase))
}

/// The check this look shows, if it is a small page of a well-known one.
pub(super) fn known_check(observation: &SemanticObservation) -> Option<KnownCheck> {
    let nodes = || {
        observation
            .frames()
            .iter()
            .flat_map(SemanticSnapshot::nodes)
    };
    if nodes().count() > MAX_HUMAN_CHALLENGE_NODES {
        return None;
    }
    let mut automatic = false;
    let mut person = false;
    let mut client_challenge_title = false;
    let mut browser_verification = false;
    for node in nodes() {
        if node.role() == SemanticRole::FrameBoundary {
            let Some(name) = node.name() else {
                continue;
            };
            let name = name.as_str().trim().to_lowercase();
            if name == "recaptcha" {
                person |= node
                    .geometry()
                    .is_some_and(|rect| rect.width() >= RECAPTCHA_CHECKBOX_MIN_WIDTH);
            } else if AUTOMATIC_FRAME_TITLES
                .iter()
                .any(|title| name.contains(title))
            {
                automatic = true;
            } else if PERSON_FRAME_TITLES.iter().any(|title| name.contains(title)) {
                person = true;
            }
            continue;
        }
        for text in [node.name(), node.text()].into_iter().flatten() {
            let text = text.as_str();
            if text.trim().len() > MAX_PHRASE_TEXT {
                continue;
            }
            let lower = text.trim().to_lowercase();
            client_challenge_title |=
                matches!(node.role(), SemanticRole::Document | SemanticRole::Heading)
                    && lower == "client challenge";
            browser_verification |= lower.starts_with("verifying your browser")
                || lower.contains(" is verifying your browser");
            if starts_with_any(text, &PERSON_PHRASES) {
                person = true;
            } else if starts_with_any(text, &AUTOMATIC_PHRASES) {
                automatic = true;
            }
        }
    }
    if person {
        return Some(KnownCheck::Person);
    }
    if automatic || (client_challenge_title && browser_verification) || frame_only(observation) {
        return Some(KnownCheck::Automatic);
    }
    None
}

/// A native SSO/login route together with an identity control is a wall,
/// including providers that name their only button merely "Continue".
/// Route text alone never turns documentation or an empty app shell into proof.
pub(super) fn sign_in_route(
    document: &ContextNavigationTarget,
    observation: &SemanticObservation,
) -> bool {
    let route = document
        .as_url()
        .path_segments()
        .into_iter()
        .flatten()
        .any(|part| {
            matches!(
                part.to_ascii_lowercase().as_str(),
                "login"
                    | "signin"
                    | "sign-in"
                    | "sign_in"
                    | "sso"
                    | "oauth"
                    | "authorize"
                    | "mfa"
                    | "2fa"
                    | "otp"
                    | "accountchooser"
            )
        });
    route
        && observation
            .frames()
            .iter()
            .flat_map(SemanticSnapshot::nodes)
            .any(|node| {
                node.geometry().is_some()
                    && (node.role() == SemanticRole::Password
                        || (node.role() == SemanticRole::Textbox
                            && (node.sensitivity() != SemanticSensitivity::Public
                                || node.name().is_some_and(|name| {
                                    let name = name.as_str().to_ascii_lowercase();
                                    [
                                        "email",
                                        "username",
                                        "workspace",
                                        "organization",
                                        "verification",
                                        "authentication",
                                        "code",
                                    ]
                                    .iter()
                                    .any(|word| name.contains(word))
                                }))))
            })
}

/// A page that is only an embedded frame it cannot read: DataDome and
/// similar checks, which either clear by themselves or show a captcha.
fn frame_only(observation: &SemanticObservation) -> bool {
    let nodes = || {
        observation
            .frames()
            .iter()
            .flat_map(SemanticSnapshot::nodes)
    };
    nodes().count() <= 4
        && nodes().any(|node| node.role() == SemanticRole::FrameBoundary)
        && nodes().all(|node| {
            matches!(
                node.role(),
                SemanticRole::Document | SemanticRole::FrameBoundary
            ) || (node.role() != SemanticRole::Heading
                && !node.operations().contains(SemanticOperationClass::Click)
                && !node.operations().contains(SemanticOperationClass::Fill))
        })
        && nodes()
            .map(|node| {
                node.text().map_or(0, |text| text.len()) + node.name().map_or(0, |name| name.len())
            })
            .sum::<usize>()
            < 64
}

#[cfg(test)]
mod tests {
    use super::*;

    fn look(nodes: &str) -> SemanticObservation {
        let identity = ContextIdentity::new(
            ContextId::generate(),
            ContextRunId::generate(),
            1_u128.into(),
            ContextKind::Owned,
        );
        let mut registry = ContextRegistry::new();
        registry
            .reserve(
                identity,
                ContextCapabilities::try_new(ContextKind::Owned, &[ContextCapability::Observe])
                    .unwrap(),
            )
            .unwrap();
        let operation = registry
            .begin_context(identity.id(), ContextOperationId::new(1).unwrap())
            .unwrap();
        registry
            .settle_construction(identity.id(), operation, ContextSettlement::Applied)
            .unwrap();
        let context = registry.join(identity.id()).unwrap();
        let frame = SemanticFrameJoin::try_new(
            context,
            FrameId::MAIN,
            context.frame_generation(),
            SemanticOrigin::parse("https://shop.example.test/").unwrap(),
            SemanticFrameTrust::SameOrigin,
        )
        .unwrap();
        let wire = format!(r#"{{"v":1,"i":1,"g":1,"c":"complete","n":[{nodes}]}}"#);
        let snapshot = decode_semantic_snapshot(
            SemanticDecodeContext::new(
                SemanticInvocationId::new(1).unwrap(),
                frame.clone(),
                SemanticSnapshotGeneration::new(1).unwrap(),
            ),
            wire.as_bytes(),
        )
        .unwrap();
        let boundaries = snapshot
            .nodes()
            .iter()
            .filter(|node| node.role() == SemanticRole::FrameBoundary)
            .map(SemanticNode::reference)
            .collect::<Vec<_>>();
        let mut assembler = SemanticObservationAssembler::new(
            SemanticObservationRequest::initial(
                SemanticObservationId::new(1).unwrap(),
                frame.context(),
                SemanticObservationBudget::INITIAL_FILTERED,
            ),
            snapshot,
        )
        .unwrap();
        for boundary in boundaries {
            assembler
                .mark_frame_unsupported(
                    FrameId::MAIN,
                    boundary,
                    SemanticFrameUnsupported::PolicyBlocked,
                )
                .unwrap();
        }
        assembler.finish().unwrap()
    }

    #[test]
    fn sso_route_requires_a_visible_identity_control_not_just_a_url() {
        let field = look(
            r#"{"k":1,"r":"document","o":16},{"k":2,"p":0,"r":"textbox","n":"Email","q":"sensitive","o":2,"b":{"x":1,"y":1,"w":200,"h":30}}"#,
        );
        let shell = look(r#"{"k":1,"r":"document","o":16}"#);
        let sso = ContextNavigationTarget::parse("https://login.example.test/sso/start").unwrap();
        assert!(sign_in_route(&sso, &field));
        assert!(!sign_in_route(&sso, &shell));
        assert!(!sign_in_route(
            &ContextNavigationTarget::parse("https://example.test/contact").unwrap(),
            &field
        ));
    }

    #[test]
    fn a_script_check_is_waited_out_and_a_widget_goes_to_the_person() {
        let cloudflare = look(
            r#"{"k":1,"r":"document","n":"Just a moment...","o":16},{"k":2,"p":0,"r":"heading","n":"shop.example.test","l":1},{"k":3,"p":0,"r":"paragraph","t":"Verifying you are human. This may take a few seconds."},{"k":4,"p":0,"r":"frame_boundary","n":"Widget containing a Cloudflare security challenge","b":{"x":10,"y":200,"w":300,"h":65}}"#,
        );
        assert_eq!(known_check(&cloudflare), Some(KnownCheck::Automatic));

        let turnstile = look(
            r#"{"k":1,"r":"document","n":"Just a moment...","o":16},{"k":2,"p":0,"r":"paragraph","t":"Verify you are human by completing the action below."},{"k":3,"p":0,"r":"frame_boundary","n":"Widget containing a Cloudflare security challenge","b":{"x":10,"y":200,"w":300,"h":65}}"#,
        );
        assert_eq!(known_check(&turnstile), Some(KnownCheck::Person));

        let hcaptcha = look(
            r#"{"k":1,"r":"document","o":16},{"k":2,"p":0,"r":"heading","n":"One more step","l":1},{"k":3,"p":0,"r":"frame_boundary","n":"Widget containing checkbox for hCaptcha security challenge","b":{"x":10,"y":200,"w":300,"h":78}}"#,
        );
        assert_eq!(known_check(&hcaptcha), Some(KnownCheck::Person));

        // DataDome's page is one frame it cannot read.
        let datadome = look(
            r#"{"k":1,"r":"document","o":16},{"k":2,"p":0,"r":"frame_boundary","n":"DataDome","b":{"x":0,"y":0,"w":1280,"h":800}}"#,
        );
        assert_eq!(known_check(&datadome), Some(KnownCheck::Automatic));
        let captcha = look(
            r#"{"k":1,"r":"document","o":16},{"k":2,"p":0,"r":"frame_boundary","n":"DataDome CAPTCHA","b":{"x":0,"y":0,"w":1280,"h":800}}"#,
        );
        assert_eq!(known_check(&captcha), Some(KnownCheck::Person));
    }

    #[test]
    fn client_challenge_requires_both_wall_title_and_browser_verification() {
        let page = |role: &str, title: &str, text: &str| {
            let level = if role == "heading" { r#", "l":1"# } else { "" };
            look(&format!(
                r#"{{"k":1,"r":"document","o":16}},{{"k":2,"p":0,"r":"{role}","n":"{title}"{level}}},{{"k":3,"p":0,"r":"paragraph","t":"{text}"}}"#
            ))
        };
        for text in [
            "Verifying your browser...",
            "example.test is verifying your browser...",
        ] {
            assert_eq!(
                known_check(&page("heading", "Client Challenge", text)),
                Some(KnownCheck::Automatic)
            );
        }
        for (role, title, text) in [
            ("heading", "Client Challenge", "How browser checks work"),
            (
                "heading",
                "Troubleshooting",
                "example.test is verifying your browser...",
            ),
            (
                "paragraph",
                "Client Challenge",
                "example.test is verifying your browser...",
            ),
        ] {
            assert_eq!(known_check(&page(role, title, text)), None);
        }
    }

    #[test]
    fn a_page_that_only_mentions_a_check_is_not_one() {
        // reCAPTCHA's score badge on an ordinary page.
        let badge = look(
            r#"{"k":1,"r":"document","o":16},{"k":2,"p":0,"r":"heading","n":"Contact us","l":1},{"k":3,"p":0,"r":"textbox","n":"Email","o":2},{"k":4,"p":0,"r":"frame_boundary","n":"reCAPTCHA","b":{"x":10,"y":700,"w":256,"h":60}}"#,
        );
        assert_eq!(known_check(&badge), None);

        let mut nodes = vec![r#"{"k":1,"r":"document","o":16}"#.to_owned()];
        nodes.push(
            r#"{"k":2,"p":0,"r":"heading","n":"Just a moment: our spring sale ends soon","l":1}"#
                .to_owned(),
        );
        for k in 3..60 {
            nodes.push(format!(
                r#"{{"k":{k},"p":0,"r":"paragraph","t":"Item {k}"}}"#
            ));
        }
        assert_eq!(known_check(&look(&nodes.join(","))), None);
    }
}
