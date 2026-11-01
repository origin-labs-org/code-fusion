//! Hand-written outlines of well-known pages and the stylesheets a small
//! model should write for them. They pin how the style prompt renders real
//! structure, and how the validator and guard treat realistic output.
use crate::outline::{Outline, OutlineKind as K, OutlineNode, Rgb};

pub(crate) struct Fixture {
    pub name: &'static str,
    pub outline: Outline,
    /// A sheet a small model writes when it follows the instructions.
    pub good: &'static str,
}

fn rgb(hex: u32) -> Rgb {
    Rgb((hex >> 16) as u8, (hex >> 8) as u8, hex as u8)
}

fn node(
    selector: &str,
    kind: K,
    count: u16,
    bg: Option<u32>,
    fg: Option<u32>,
    px: u16,
) -> OutlineNode {
    OutlineNode {
        selector: selector.into(),
        kind,
        count,
        background: bg.map(rgb),
        color: fg.map(rgb),
        font_size_px: (px > 0).then_some(px),
    }
}

#[allow(clippy::too_many_arguments)]
fn outline(
    nodes: Vec<OutlineNode>,
    background: u32,
    text: u32,
    link: u32,
    accent: u32,
    fonts: &[&str],
    dark: bool,
) -> Outline {
    Outline {
        nodes,
        background: Some(rgb(background)),
        text: Some(rgb(text)),
        link: Some(rgb(link)),
        accent: Some(rgb(accent)),
        fonts: fonts.iter().map(|font| (*font).to_owned()).collect(),
        dark,
    }
}

pub(crate) fn all() -> Vec<Fixture> {
    vec![wikipedia(), youtube(), reddit(), x(), hacker_news(), blog()]
}

fn wikipedia() -> Fixture {
    Fixture {
        name: "wikipedia",
        outline: outline(
            vec![
                node("header.vector-header", K::Header, 1, Some(0xffffff), Some(0x202122), 14),
                node("div#vector-main-menu", K::Navigation, 1, Some(0xffffff), Some(0x202122), 14),
                node("main#content.mw-body", K::Main, 1, Some(0xffffff), Some(0x202122), 14),
                node("div#mw-content-text.mw-body-content", K::Article, 1, None, Some(0x202122), 14),
                node("h1#firstHeading", K::Heading, 1, None, Some(0x000000), 29),
                node("h2.mw-heading2", K::Heading, 9, None, Some(0x000000), 22),
                node("table.infobox", K::Aside, 1, Some(0xf8f9fa), Some(0x202122), 12),
                node("div.vector-toc", K::Aside, 1, None, Some(0x202122), 14),
                node("div.thumb", K::Content, 6, None, None, 12),
                node("input.cdx-text-input__input", K::Control, 1, Some(0xffffff), Some(0x202122), 14),
                node("footer#footer", K::Footer, 1, None, Some(0x54595d), 12),
            ],
            0xffffff,
            0x202122,
            0x0645ad,
            0x3366cc,
            &["Helvetica Neue", "Arial"],
            false,
        ),
        good: "body{background-color:#f6f6f4!important;color:#1f2023!important;font-family:system-ui,sans-serif;font-size:17px;line-height:1.6}\n\
main#content{background-color:#ffffff!important;border-radius:12px;padding:24px;box-shadow:0 1px 3px rgb(0 0 0 / 8%)}\n\
div#mw-content-text{max-width:72ch;margin-left:auto;margin-right:auto}\n\
p{margin-bottom:1em}\n\
a{color:#0b57b0!important}\n\
a:visited{color:#6b3fa0!important}\n\
h1,h2,h3{font-weight:650;line-height:1.2;letter-spacing:-0.01em;color:#111214!important}\n\
h1{font-size:2em}\nh2{font-size:1.5em;border-bottom:1px solid #e3e3e0}\nh3{font-size:1.25em}\n\
table.infobox{background-color:#fbfbfa!important;border:1px solid #dcdcd8;border-radius:10px}\n\
input.cdx-text-input__input{border-radius:10px;border:1px solid #cfcfca}\n\
footer#footer{color:#55585e!important;font-size:14px}\n\
@media (prefers-color-scheme: dark){\n\
body{background-color:#131316!important;color:#e8e8ec!important}\n\
main#content{background-color:#1a1a1e!important;box-shadow:none}\n\
a{color:#8ab4f8!important}\na:visited{color:#c4a7e7!important}\n\
h1,h2,h3{color:#f5f5f7!important}\n\
h2{border-bottom:1px solid #2e2e34}\n\
table.infobox{background-color:#202026!important;border:1px solid #2e2e34}\n\
input.cdx-text-input__input{background-color:#202026!important;color:#e8e8ec!important;border:1px solid #3a3a42}\n\
footer#footer{color:#a0a0a8!important}\n}",
    }
}

fn youtube() -> Fixture {
    Fixture {
        name: "youtube",
        outline: outline(
            vec![
                node("ytd-masthead#masthead", K::Header, 1, Some(0x0f0f0f), Some(0xf1f1f1), 14),
                node("ytd-guide-renderer", K::Navigation, 1, Some(0x0f0f0f), Some(0xf1f1f1), 14),
                node("ytd-page-manager#page-manager", K::Main, 1, None, None, 14),
                node("ytd-watch-flexy", K::Article, 1, None, None, 14),
                node("h1.ytd-watch-metadata", K::Heading, 1, None, Some(0xf1f1f1), 20),
                node("ytd-rich-item-renderer", K::Content, 24, Some(0x0f0f0f), None, 14),
                node("ytd-comments#comments", K::Content, 1, None, Some(0xf1f1f1), 14),
                node("div#secondary", K::Aside, 1, None, None, 14),
                node("button.yt-spec-button-shape-next", K::Control, 18, Some(0x272727), Some(0xf1f1f1), 14),
            ],
            0x0f0f0f,
            0xf1f1f1,
            0x3ea6ff,
            0xff0000,
            &["Roboto", "Arial"],
            true,
        ),
        good: "body{background-color:#0c0c0e!important;color:#ececf0!important;font-family:system-ui,sans-serif;line-height:1.5;color-scheme:dark}\n\
ytd-masthead#masthead{background-color:#101013!important;border-bottom:1px solid #26262c}\n\
ytd-guide-renderer{background-color:#101013!important}\n\
ytd-rich-item-renderer{border-radius:14px}\n\
h1.ytd-watch-metadata{font-size:22px;font-weight:650;line-height:1.25;letter-spacing:-0.01em;color:#f7f7fa!important}\n\
ytd-comments#comments{max-width:72ch}\n\
a{color:#7db8ff!important}\n\
button.yt-spec-button-shape-next{background-color:#25252b!important;color:#f1f1f5!important;border-radius:999px;border:1px solid #34343c}\n\
button.yt-spec-button-shape-next:hover{background-color:#30303a!important}\n\
div#secondary{padding:8px}",
    }
}

fn reddit() -> Fixture {
    Fixture {
        name: "reddit",
        outline: outline(
            vec![
                node("header.bg-neutral-background", K::Header, 1, Some(0xffffff), Some(0x0f1a1c), 14),
                node("nav#left-sidebar", K::Navigation, 1, Some(0xffffff), Some(0x0f1a1c), 14),
                node("main#main-content", K::Main, 1, Some(0xffffff), Some(0x0f1a1c), 14),
                node("shreddit-post", K::Article, 25, Some(0xffffff), Some(0x0f1a1c), 14),
                node("h1.font-semibold", K::Heading, 1, None, Some(0x0f1a1c), 24),
                node("shreddit-comment", K::Content, 40, None, Some(0x0f1a1c), 14),
                node("aside#right-sidebar-container", K::Aside, 1, Some(0xf6f7f8), Some(0x0f1a1c), 14),
                node("button.button-secondary", K::Control, 30, Some(0xe5ebee), Some(0x0f1a1c), 14),
                node("footer", K::Footer, 1, None, Some(0x576f76), 12),
            ],
            0xffffff,
            0x0f1a1c,
            0x0045ac,
            0xff4500,
            &["Noto Sans", "Arial"],
            false,
        ),
        good: "body{background-color:#f4f5f6!important;color:#14201f!important;font-family:system-ui,sans-serif;line-height:1.55}\n\
main#main-content{max-width:760px;margin-left:auto;margin-right:auto}\n\
shreddit-post{background-color:#ffffff!important;border-radius:14px;border:1px solid #e1e5e7;box-shadow:0 1px 2px rgb(0 0 0 / 6%)}\n\
shreddit-comment{line-height:1.6}\n\
h1.font-semibold{font-size:1.6em;line-height:1.25;letter-spacing:-0.01em}\n\
a{color:#0a4fb4!important}\n\
button.button-secondary{background-color:#eceff1!important;color:#14201f!important;border-radius:999px}\n\
aside#right-sidebar-container{background-color:#ffffff!important;border-radius:14px;border:1px solid #e1e5e7}\n\
footer{color:#566a70!important}\n\
@media (prefers-color-scheme: dark){\n\
body{background-color:#0e1113!important;color:#e6ebed!important}\n\
shreddit-post{background-color:#16191c!important;border:1px solid #262b2f;box-shadow:none}\n\
a{color:#7fb2ff!important}\n\
button.button-secondary{background-color:#232a2e!important;color:#e6ebed!important}\n\
aside#right-sidebar-container{background-color:#16191c!important;border:1px solid #262b2f}\n\
footer{color:#93a4aa!important}\n}",
    }
}

fn x() -> Fixture {
    Fixture {
        name: "x",
        outline: outline(
            vec![
                node("header.css-175oi2r", K::Header, 1, Some(0x000000), Some(0xe7e9ea), 15),
                node("nav.css-175oi2r", K::Navigation, 1, Some(0x000000), Some(0xe7e9ea), 15),
                node("main.css-175oi2r", K::Main, 1, Some(0x000000), Some(0xe7e9ea), 15),
                node("article.css-175oi2r", K::Article, 14, Some(0x000000), Some(0xe7e9ea), 15),
                node("h2.css-146c3p1", K::Heading, 3, None, Some(0xe7e9ea), 20),
                node("div.r-1igl3o0", K::Aside, 1, None, Some(0xe7e9ea), 15),
                node("button.css-175oi2r", K::Control, 40, None, Some(0xe7e9ea), 15),
            ],
            0x000000,
            0xe7e9ea,
            0x1d9bf0,
            0x1d9bf0,
            &["TwitterChirp", "Helvetica Neue"],
            true,
        ),
        good: "body{background-color:#08080a!important;color:#e9eaee!important;font-family:system-ui,sans-serif;line-height:1.5;color-scheme:dark}\n\
main.css-175oi2r{max-width:620px}\n\
article.css-175oi2r{border-bottom:1px solid #1f1f25;padding-bottom:4px}\n\
article.css-175oi2r:hover{background-color:#0e0e12!important}\n\
h2.css-146c3p1{font-weight:650;letter-spacing:-0.01em}\n\
a{color:#5cb8ff!important}\n\
button.css-175oi2r{border-radius:999px}\n\
div.r-1igl3o0{border:1px solid #1f1f25;border-radius:16px}",
    }
}

fn hacker_news() -> Fixture {
    Fixture {
        name: "hacker-news",
        outline: outline(
            vec![
                node("table#hnmain", K::Main, 1, Some(0xf6f6ef), Some(0x000000), 13),
                node("span.pagetop", K::Navigation, 1, Some(0xff6600), Some(0x000000), 13),
                node("tr.athing", K::Content, 30, None, Some(0x000000), 13),
                node("span.titleline", K::Heading, 30, None, Some(0x000000), 13),
                node("td.subtext", K::Other, 30, None, Some(0x828282), 10),
                node("table.fatitem", K::Article, 1, None, Some(0x000000), 13),
                node("textarea", K::Control, 1, Some(0xffffff), Some(0x000000), 13),
            ],
            0xf6f6ef,
            0x000000,
            0x000000,
            0xff6600,
            &["Verdana", "Geneva"],
            false,
        ),
        good: "body{background-color:#f3f1ec!important;color:#1d1d1f!important;font-family:system-ui,sans-serif;font-size:16px;line-height:1.5}\n\
table#hnmain{background-color:#fbfaf7!important;border-radius:12px;max-width:960px;margin-left:auto;margin-right:auto}\n\
span.titleline{font-size:17px;font-weight:600;line-height:1.35}\n\
span.titleline a{color:#17171a!important}\n\
td.subtext{color:#5f5f66!important;font-size:13px}\n\
tr.athing{line-height:1.5}\n\
a:visited{color:#6a5acd!important}\n\
textarea{border-radius:10px;border:1px solid #cfcdc6;background-color:#ffffff!important;color:#1d1d1f!important;font-size:15px}\n\
@media (prefers-color-scheme: dark){\n\
body{background-color:#121214!important;color:#e6e6ea!important}\n\
table#hnmain{background-color:#1a1a1d!important}\n\
span.titleline a{color:#f0f0f3!important}\n\
td.subtext{color:#a0a0a8!important}\n\
a:visited{color:#b8a9f0!important}\n\
textarea{background-color:#222226!important;color:#e6e6ea!important;border:1px solid #38383e}\n}",
    }
}

fn blog() -> Fixture {
    Fixture {
        name: "blog",
        outline: outline(
            vec![
                node("header.site-header", K::Header, 1, Some(0xffffff), Some(0x333333), 16),
                node("nav.site-nav", K::Navigation, 1, None, Some(0x0073aa), 15),
                node("main#main", K::Main, 1, None, Some(0x333333), 16),
                node("article.post", K::Article, 1, None, Some(0x333333), 16),
                node("h1.entry-title", K::Heading, 1, None, Some(0x111111), 32),
                node("div.entry-content", K::Content, 1, None, Some(0x333333), 16),
                node("aside.sidebar", K::Aside, 1, Some(0xf7f7f7), Some(0x333333), 14),
                node("a.button", K::Control, 3, Some(0x0073aa), Some(0xffffff), 15),
                node("footer.site-footer", K::Footer, 1, Some(0xf0f0f0), Some(0x666666), 13),
            ],
            0xffffff,
            0x333333,
            0x0073aa,
            0x0073aa,
            &["Open Sans", "Arial"],
            false,
        ),
        good: "body{background-color:#fcfbf9!important;color:#26272b!important;font-family:Georgia,serif;font-size:18px;line-height:1.7}\n\
article.post{max-width:68ch;margin-left:auto;margin-right:auto}\n\
h1.entry-title{font-size:2.1em;line-height:1.15;letter-spacing:-0.015em;font-weight:700;color:#111114!important}\n\
h2,h3{font-family:system-ui,sans-serif;font-weight:650;line-height:1.25}\n\
h2{font-size:1.5em}\nh3{font-size:1.25em}\n\
div.entry-content p{margin-bottom:1.2em}\n\
a{color:#00608c!important}\n\
a.button{background-color:#00608c!important;color:#ffffff!important;border-radius:10px;padding:10px 16px}\n\
aside.sidebar{background-color:#f3f1ed!important;border-radius:12px;padding:16px;font-size:16px}\n\
blockquote{border-left:3px solid #00608c;padding-left:16px;color:#44454a!important}\n\
footer.site-footer{background-color:#f3f1ed!important;color:#58595e!important}\n\
@media (prefers-color-scheme: dark){\n\
body{background-color:#141416!important;color:#e7e7ea!important}\n\
h1.entry-title{color:#f6f6f8!important}\n\
a{color:#6cc2f0!important}\n\
a.button{background-color:#6cc2f0!important;color:#0b1a22!important}\n\
aside.sidebar{background-color:#1d1d20!important}\n\
blockquote{border-left:3px solid #6cc2f0;color:#b9b9c0!important}\n\
footer.site-footer{background-color:#1d1d20!important;color:#a3a3ab!important}\n}",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::css::{self, Rejection};
    use crate::guard;
    use crate::prompt;

    #[test]
    fn realistic_outlines_survive_admission_whole() {
        for fixture in all() {
            let admitted = Outline::admit(fixture.outline.clone());
            assert_eq!(
                admitted, fixture.outline,
                "{}: every hand-written node is a valid, admitted shape",
                fixture.name
            );
            assert!(
                !admitted.primary_selectors().is_empty(),
                "{}: names a main region",
                fixture.name
            );
        }
    }

    #[test]
    fn outline_blocks_stay_cheap_and_name_the_scheme_and_main() {
        for fixture in all() {
            let rendered = prompt::outline_block(&fixture.outline);
            assert!(rendered.len() < 2_600, "{}: stays cheap", fixture.name);
            assert!(rendered.starts_with("<<<OUTLINE"));
            assert!(rendered.contains(if fixture.outline.dark {
                "scheme: dark"
            } else {
                "scheme: light"
            }));
            assert!(rendered.contains("main "));
        }
    }

    #[test]
    fn well_formed_redesigns_pass_validator_and_guard_unchanged() {
        for fixture in all() {
            let validated = css::validate(fixture.good)
                .unwrap_or_else(|rejection| panic!("{}: {rejection:?}", fixture.name));
            assert_eq!(validated.dropped, 0, "{}: nothing unknown", fixture.name);
            assert!(validated.css.len() < 3_500, "{}", fixture.name);
            let guarded = guard::guard(&validated, Some(&fixture.outline)).unwrap();
            assert_eq!(guarded.hiding_removed, 0, "{}", fixture.name);
            assert_eq!(guarded.contrast_repaired, 0, "{}", fixture.name);
            assert_eq!(guarded.css, validated.css, "{}", fixture.name);
        }
    }

    #[test]
    fn light_pages_get_a_dark_counterpart_and_dark_pages_stay_dark() {
        for fixture in all() {
            let has_media = fixture.good.contains("@media (prefers-color-scheme: dark)");
            assert_eq!(
                has_media, !fixture.outline.dark,
                "{}: dark pages restyle dark, others offer both",
                fixture.name
            );
        }
    }

    #[test]
    fn a_model_that_hides_the_page_is_repaired_on_every_fixture() {
        for fixture in all() {
            let primary = fixture.outline.primary_selectors();
            let hostile = format!(
                "{}{{display:none}}\n{}{{opacity:0}}\nbody{{background-color:#888;color:#999}}\np{{margin-bottom:1em}}",
                primary[0],
                primary.last().unwrap()
            );
            let validated = css::validate(&hostile).unwrap();
            let guarded = guard::guard(&validated, Some(&fixture.outline)).unwrap();
            assert_eq!(guarded.hiding_removed, 2, "{}", fixture.name);
            assert_eq!(guarded.contrast_repaired, 1, "{}", fixture.name);
            assert!(!guarded.css.contains("display:none"));
            assert!(guarded.css.contains("p{margin-bottom:1em}"));
        }
    }

    #[test]
    fn smuggling_in_a_realistic_sheet_rejects_all_of_it() {
        for fixture in all() {
            let tampered = format!(
                "{}\nbody{{background:url(https://evil.example/t.png)}}",
                fixture.good
            );
            assert_eq!(css::validate(&tampered), Err(Rejection::Forbidden));
        }
    }
}
