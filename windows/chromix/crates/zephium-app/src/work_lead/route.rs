//! Which way a part reaches a service the person uses: through their own
//! connection (an installed CLI or an MCP server they added), offered once
//! per work, or else through the website in their session. The run decides
//! this, not the model.
use zephium_core::work::parts::{WorkHelperV1, WorkPartServiceV1};
use zephium_ipc::work::WorkServerV1;

/// Services people reach both ways, by the name the lead may use for them.
const SERVICES: [(&str, &str, &str); 11] = [
    ("slack", "Slack", "app.slack.com"),
    ("github", "GitHub", "github.com"),
    ("gmail", "Gmail", "mail.google.com"),
    ("calendar", "Google Calendar", "calendar.google.com"),
    ("notion", "Notion", "app.notion.com"),
    ("linear", "Linear", "linear.app"),
    ("figma", "Figma", "www.figma.com"),
    ("discord", "Discord", "discord.com"),
    ("todoist", "Todoist", "app.todoist.com"),
    ("sentry", "Sentry", "sentry.io"),
    ("stripe", "Stripe", "dashboard.stripe.com"),
];

/// Services with an MCP server people add in Settings → Connections, by
/// the brand the lead names them with (the presets Settings offers).
const KNOWN_SERVERS: [(&str, &str); 6] = [
    ("linear", "Linear"),
    ("notion", "Notion"),
    ("todoist", "Todoist"),
    ("sentry", "Sentry"),
    ("stripe", "Stripe"),
    ("figma", "Figma"),
];

/// The name of the server people add for a service, when there is one.
pub(crate) fn known_server(brand: &str) -> Option<&'static str> {
    KNOWN_SERVERS
        .iter()
        .find(|(key, _)| *key == brand)
        .map(|(_, name)| *name)
}

pub(crate) const USE_CONNECTION: &str = "Use connection";
pub(crate) const USE_WEBSITE: &str = "Use the website";
pub(crate) const ALWAYS_WEBSITE: &str = "Always the website";
pub(crate) const NOT_NOW: &str = "Not now";
const CONNECT: &str = "Connect ";

/// How the person has a part reach a service.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum Way {
    Connection,
    Website,
    AlwaysWebsite,
    /// Connect it in Settings first; the part ends with that need.
    Connect,
    NotNow,
}

/// The one question a part about the person's own data in a service asks:
/// their connection or the website when they have a connection, the website
/// or connecting first when the service has one they could add.
pub(crate) fn question(name: &str, connected: bool) -> (String, Vec<String>) {
    let (prompt, first) = if connected {
        (
            format!("Use your {name} connection, or work on the website?"),
            USE_CONNECTION.to_owned(),
        )
    } else {
        (
            format!("Work on the {name} website, or connect {name} first?"),
            USE_WEBSITE.to_owned(),
        )
    };
    let second = if connected {
        USE_WEBSITE.to_owned()
    } else {
        format!("{CONNECT}{name}")
    };
    (
        prompt,
        vec![first, second, ALWAYS_WEBSITE.to_owned(), NOT_NOW.to_owned()],
    )
}

/// What an answer to the question chooses; anything unknown is a no.
pub(crate) fn way(answer: &str) -> Way {
    let answer = answer.trim();
    if answer.eq_ignore_ascii_case(USE_CONNECTION) {
        Way::Connection
    } else if answer.eq_ignore_ascii_case(USE_WEBSITE) {
        Way::Website
    } else if answer.eq_ignore_ascii_case(ALWAYS_WEBSITE) {
        Way::AlwaysWebsite
    } else if answer
        .get(..CONNECT.len())
        .is_some_and(|start| start.eq_ignore_ascii_case(CONNECT))
    {
        Way::Connect
    } else {
        Way::NotNow
    }
}

/// A connection the person has for a service.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct Offer {
    /// What the part's service names, for the connection helper's tools.
    pub connection: String,
    /// "Use Slack": the connection helper's own first-use answer.
    pub yes: String,
}

/// The service a part is about, in lower case: "slack" for app.slack.com,
/// a connection named Slack or a part titled Slack.
pub(crate) fn brand(service: Option<&WorkPartServiceV1>, title: &str) -> Option<String> {
    if let Some(host) = service.and_then(|s| s.host.as_deref()) {
        if host == "mail.google.com" {
            return Some("gmail".into());
        }
        if host == "calendar.google.com" {
            return Some("calendar".into());
        }
        let labels: Vec<&str> = host.split('.').collect();
        return labels
            .len()
            .checked_sub(2)
            .and_then(|at| labels.get(at))
            .map(|label| (*label).to_owned());
    }
    let named = service
        .and_then(|s| s.connection.as_deref())
        .unwrap_or(title)
        .to_lowercase();
    let word = named
        .split(|c: char| !c.is_alphanumeric())
        .find(|w| !w.is_empty())?
        .to_owned();
    Some(if word == "gh" { "github".into() } else { word })
}

/// The website a service lives on, when it is a known one.
pub(crate) fn site(brand: &str) -> Option<&'static str> {
    SERVICES
        .iter()
        .find(|(key, ..)| *key == brand)
        .map(|(.., host)| *host)
}

/// Whether a browsing part opens the person's own app for the service (its
/// signed-in home), not the service's public site: only then is their
/// connection the better way in. A part with no host names the service itself,
/// and so does any host on the app's site (the lead writes todoist.com for
/// app.todoist.com): a public read there (pricing, docs) is told apart by its
/// goal before this.
pub(crate) fn reaches_own_app(brand: &str, host: Option<&str>) -> bool {
    host.is_none_or(|host| {
        let site_of = |host: &str| crate::work_sites::site_of(&format!("https://{host}/"));
        site(brand).is_some_and(|app| {
            app == host || site_of(app).is_some_and(|app| site_of(host).as_deref() == Some(&*app))
        }) || FORMER_SITES
            .iter()
            .any(|(key, former)| *key == brand && site_of(host).as_deref() == Some(*former))
    })
}

/// The app's own host for a service named by a bare site that only
/// redirects to it on another site: gmail.com for mail.google.com.
pub(crate) fn app_host(host: &str) -> Option<&'static str> {
    let host = host.trim_start_matches("www.").to_ascii_lowercase();
    let site_of = |host: &str| crate::work_sites::site_of(&format!("https://{host}/"));
    let bare = site_of(&host).is_some_and(|site| site == host);
    let app = site(&brand(
        Some(&WorkPartServiceV1 {
            host: Some(host.clone()),
            connection: None,
        }),
        "",
    )?)?;
    (bare && site_of(app) != site_of(&host)).then_some(app)
}

/// Sites an app moved away from, which models still name it by.
const FORMER_SITES: [(&str, &str); 1] = [("notion", "notion.so")];

/// The person's connection for the service: gh for GitHub when it is
/// installed and signed in, else an enabled MCP server named for it.
pub(crate) fn offer(brand: &str, gh_ready: bool, servers: &[WorkServerV1]) -> Option<Offer> {
    if brand == "github" && gh_ready {
        return Some(Offer {
            connection: "GitHub".into(),
            yes: crate::work_connections::gh::USE.into(),
        });
    }
    let server = servers.iter().find(|server| {
        let id = server.id.to_lowercase();
        let name = server.name.to_lowercase();
        server.enabled
            && !id.is_empty()
            && (id == brand
                || name
                    .split(|c: char| !c.is_alphanumeric())
                    .any(|w| w == brand)
                || id.split('-').any(|w| w == brand))
    })?;
    Some(Offer {
        connection: server.name.clone(),
        yes: format!("Use {}", server.name),
    })
}

/// Where a part goes once the person answered, or when there is nothing to
/// offer: a connection part with no connection works on the website.
pub(crate) fn settle(
    helper: WorkHelperV1,
    brand: &str,
    offer: Option<&Offer>,
    accepted: bool,
) -> Option<(WorkHelperV1, WorkPartServiceV1)> {
    match (helper, offer, accepted) {
        (WorkHelperV1::Browser | WorkHelperV1::Connection, Some(offer), true) => Some((
            WorkHelperV1::Connection,
            WorkPartServiceV1 {
                host: None,
                connection: Some(offer.connection.clone()),
            },
        )),
        (WorkHelperV1::Connection, _, _) => site(brand).map(|host| {
            (
                WorkHelperV1::Browser,
                WorkPartServiceV1 {
                    host: Some(host.into()),
                    connection: None,
                },
            )
        }),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use zephium_ipc::work::WorkServerTransportV1;

    fn server(id: &str, name: &str, enabled: bool) -> WorkServerV1 {
        WorkServerV1 {
            id: id.into(),
            name: name.into(),
            transport: WorkServerTransportV1::Stdio {
                command: "/usr/local/bin/slack-mcp".into(),
                args: vec![],
                env: vec![],
            },
            enabled,
        }
    }
    fn host(host: &str) -> WorkPartServiceV1 {
        WorkPartServiceV1 {
            host: Some(host.into()),
            connection: None,
        }
    }

    #[test]
    fn a_service_is_named_by_its_site_its_connection_or_its_part() {
        assert_eq!(
            brand(Some(&host("app.slack.com")), "Today").as_deref(),
            Some("slack")
        );
        assert_eq!(
            brand(Some(&host("mail.google.com")), "Mail").as_deref(),
            Some("gmail")
        );
        let gh = WorkPartServiceV1 {
            host: None,
            connection: Some("gh".into()),
        };
        assert_eq!(brand(Some(&gh), "Code").as_deref(), Some("github"));
        assert_eq!(brand(None, "Linear issues").as_deref(), Some("linear"));
    }

    #[test]
    fn a_connection_is_offered_before_the_website_and_never_invented() {
        let servers = [
            server("slack", "Slack", true),
            server("notion", "Notion", false),
        ];
        let slack = offer("slack", false, &servers).unwrap();
        assert_eq!(slack.yes, "Use Slack");
        assert_eq!(offer("notion", false, &servers), None);
        assert_eq!(
            offer("github", true, &servers).unwrap().yes,
            "Use GitHub CLI (gh)"
        );
        assert_eq!(offer("github", false, &servers), None);
        assert_eq!(offer("sla", false, &servers), None);
        assert!(reaches_own_app("notion", Some("app.notion.com")));
        assert!(reaches_own_app("slack", None));
        assert!(reaches_own_app("notion", Some("www.notion.so")));
        assert!(!reaches_own_app("notion", Some("notion.site")));
        assert!(reaches_own_app("todoist", Some("todoist.com")));
        assert!(!reaches_own_app("todoist", Some("doist.com")));

        let used = settle(WorkHelperV1::Browser, "slack", Some(&slack), true).unwrap();
        assert_eq!(used.0, WorkHelperV1::Connection);
        assert_eq!(used.1.connection.as_deref(), Some("Slack"));
        assert_eq!(
            settle(WorkHelperV1::Browser, "slack", Some(&slack), false),
            None
        );
        assert_eq!(known_server("linear"), Some("Linear"));
        assert_eq!(known_server("slack"), None);
        let website = settle(WorkHelperV1::Connection, "linear", None, false).unwrap();
        assert_eq!(website.0, WorkHelperV1::Browser);
        assert_eq!(website.1.host.as_deref(), Some("linear.app"));
    }

    #[test]
    fn a_service_named_by_a_site_that_only_redirects_opens_its_app() {
        assert_eq!(app_host("gmail.com"), Some("mail.google.com"));
        assert_eq!(app_host("www.gmail.com"), Some("mail.google.com"));
        assert_eq!(app_host("mail.google.com"), None);
        assert_eq!(app_host("slack.com"), None);
        assert_eq!(app_host("example.com"), None);
    }

    #[test]
    fn the_way_question_names_the_choices_and_reads_each_answer() {
        let (prompt, options) = question("Linear", true);
        assert_eq!(
            prompt,
            "Use your Linear connection, or work on the website?"
        );
        assert_eq!(
            options,
            [
                "Use connection",
                "Use the website",
                "Always the website",
                "Not now"
            ]
        );
        let (prompt, options) = question("Linear", false);
        assert_eq!(
            prompt,
            "Work on the Linear website, or connect Linear first?"
        );
        assert_eq!(
            options,
            [
                "Use the website",
                "Connect Linear",
                "Always the website",
                "Not now"
            ]
        );
        assert_eq!(way("Use connection"), Way::Connection);
        assert_eq!(way("Use the website"), Way::Website);
        assert_eq!(way("Always the website"), Way::AlwaysWebsite);
        assert_eq!(way("Connect Linear"), Way::Connect);
        assert_eq!(way("Not now"), Way::NotNow);
        assert_eq!(way("maybe"), Way::NotNow);
    }

    #[test]
    fn the_popular_services_with_an_official_server_are_known_and_have_a_website() {
        for brand in ["linear", "notion", "todoist", "sentry", "stripe", "figma"] {
            assert!(known_server(brand).is_some(), "{brand}");
            assert!(site(brand).is_some(), "{brand}");
        }
        assert_eq!(known_server("slack"), None);
        assert!(reaches_own_app("todoist", Some("app.todoist.com")));
        assert_eq!(
            brand(Some(&host("app.todoist.com")), "Tasks").as_deref(),
            Some("todoist")
        );
    }
}
