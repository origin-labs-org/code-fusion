//! One session per site between the person's tabs and Work's pages in their
//! account on Windows.
//!
//! WebView2 extensions are profile-wide, so Work's pages cannot use the
//! person's own profile without running their extensions; each site keeps an
//! extension-free store of its own instead. These decisions keep that store
//! and the profile in step for the site: the profile's site cookies are added
//! to the store before each page, and a sign-in made in a Work page is added
//! back to the profile. Neither direction deletes a cookie the other lacks.

use zephium_agentic::{ContextCookieOrigin, ContextCookieScope, ContextNavigationTarget};

/// What is known about a site store when one of its pages asks to open.
#[derive(Clone, Copy, Debug, Default)]
pub(crate) struct AdmissionFacts {
    /// Another page of this store is open.
    pub(crate) pages_open: bool,
    /// A page of this store opened on the origin before.
    pub(crate) initialized: bool,
    /// The store holds a cookie for the origin.
    pub(crate) store_has_cookies: bool,
    /// The person's own profile cookies can be read now.
    pub(crate) profile_available: bool,
    /// A sign-in made in a Work page of this store has not reached the
    /// person's profile yet.
    pub(crate) return_pending: bool,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum Admission {
    /// Open the page on the store as it is; `stamp` records the origin.
    Open { stamp: bool },
    /// Wait until the store's open pages close.
    Wait,
    /// Add the profile's site cookies to the store, then open.
    Refresh,
    /// Add the store's site cookies to the profile first, then refresh.
    ReturnThenRefresh,
}

pub(crate) fn admission(facts: AdmissionFacts) -> Admission {
    if facts.pages_open {
        // No cookie compare-and-swap exists: a write under an open page could
        // replace a sign-in that page is in the middle of.
        return if facts.initialized || facts.store_has_cookies {
            Admission::Open { stamp: true }
        } else {
            Admission::Wait
        };
    }
    if !facts.profile_available {
        // Unstamped, so the next page refreshes once the profile is readable.
        return Admission::Open { stamp: false };
    }
    if facts.return_pending && facts.store_has_cookies {
        Admission::ReturnThenRefresh
    } else {
        Admission::Refresh
    }
}

/// How one scoped add-or-update between the profile and a store ended.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum SyncResult {
    Applied,
    /// Nothing it wrote remains.
    Refused,
    /// A failed write's cleanup was not proven; the profile must quarantine.
    Unproven,
}

impl SyncResult {
    pub(crate) const fn new(applied: bool, cleanup_unproven: bool) -> Self {
        if cleanup_unproven {
            Self::Unproven
        } else if applied {
            Self::Applied
        } else {
            Self::Refused
        }
    }
}

/// Refused returns a store keeps trying before it lets the profile refresh
/// it again; a cookie the bridge always refuses must not hold a site's
/// refresh back for good.
pub(crate) const MAX_RETURN_ATTEMPTS: u8 = 3;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum AfterReturn {
    /// The profile has the store's sign-in, or the return gave up; the
    /// return is no longer pending and the store refreshes as usual.
    Refresh,
    /// Keep the return pending and open without a refresh, so the profile's
    /// older cookies cannot replace the sign-in the store holds.
    Open,
    Fail,
}

/// `attempts` counts refused returns of this store, this one included.
pub(crate) const fn after_return(result: SyncResult, attempts: u8) -> AfterReturn {
    match result {
        SyncResult::Applied => AfterReturn::Refresh,
        SyncResult::Refused if attempts >= MAX_RETURN_ATTEMPTS => AfterReturn::Refresh,
        SyncResult::Refused => AfterReturn::Open,
        SyncResult::Unproven => AfterReturn::Fail,
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum AfterRefresh {
    Open { stamp: bool },
    Fail,
}

/// A refused refresh opens the page on the store as it was rather than
/// refusing the site, and stays unstamped so the next page tries again.
pub(crate) const fn after_refresh(result: SyncResult) -> AfterRefresh {
    match result {
        SyncResult::Applied => AfterRefresh::Open { stamp: true },
        SyncResult::Refused => AfterRefresh::Open { stamp: false },
        SyncResult::Unproven => AfterRefresh::Fail,
    }
}

/// The origins a site's session is carried for: the page's document origin,
/// the site's own origin (where sign-in pages usually set host cookies), and
/// the page's current origin when it is another host of the same site. Every
/// origin keeps the document's scheme and port.
pub(crate) fn session_scope(
    document: &ContextNavigationTarget,
    current: Option<&url::Url>,
) -> Result<ContextCookieScope, ()> {
    let site = zephium_agentic::registrable_site(document).ok_or(())?;
    let mut root = document.as_url().clone();
    root.set_host(Some(&site)).map_err(|_| ())?;
    let mut candidates = vec![document.as_url().clone(), root];
    if let Some(current) = current {
        let same_site = ContextNavigationTarget::parse(current.as_str())
            .ok()
            .and_then(|target| zephium_agentic::registrable_site(&target))
            .is_some_and(|current_site| current_site == site);
        if same_site
            && current.scheme() == document.as_url().scheme()
            && current.port_or_known_default() == document.as_url().port_or_known_default()
        {
            candidates.push(current.clone());
        }
    }
    let mut origins: Vec<ContextCookieOrigin> = Vec::new();
    for candidate in candidates {
        let origin = ContextCookieOrigin::parse(candidate.as_str()).map_err(|_| ())?;
        if !origins.contains(&origin) {
            origins.push(origin);
        }
    }
    ContextCookieScope::try_new(origins).map_err(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn facts() -> AdmissionFacts {
        AdmissionFacts {
            profile_available: true,
            ..AdmissionFacts::default()
        }
    }

    #[test]
    fn a_tab_sign_in_reaches_every_later_page_even_after_the_store_was_seeded() {
        for store_has_cookies in [false, true] {
            assert_eq!(
                admission(AdmissionFacts {
                    initialized: true,
                    store_has_cookies,
                    ..facts()
                }),
                Admission::Refresh
            );
        }
    }

    #[test]
    fn a_work_sign_in_goes_to_the_profile_before_the_profile_refreshes_the_store() {
        assert_eq!(
            admission(AdmissionFacts {
                initialized: true,
                store_has_cookies: true,
                return_pending: true,
                ..facts()
            }),
            Admission::ReturnThenRefresh
        );
        assert_eq!(
            admission(AdmissionFacts {
                return_pending: true,
                ..facts()
            }),
            Admission::Refresh
        );
    }

    #[test]
    fn an_open_page_is_never_written_under() {
        let open = AdmissionFacts {
            pages_open: true,
            return_pending: true,
            ..facts()
        };
        assert_eq!(admission(open), Admission::Wait);
        assert_eq!(
            admission(AdmissionFacts {
                store_has_cookies: true,
                ..open
            }),
            Admission::Open { stamp: true }
        );
        assert_eq!(
            admission(AdmissionFacts {
                initialized: true,
                ..open
            }),
            Admission::Open { stamp: true }
        );
    }

    #[test]
    fn an_unreadable_profile_never_marks_the_origin_settled() {
        assert_eq!(
            admission(AdmissionFacts {
                profile_available: false,
                ..AdmissionFacts::default()
            }),
            Admission::Open { stamp: false }
        );
    }

    #[test]
    fn a_failed_return_keeps_the_store_sign_in_and_only_unproven_cleanup_fails() {
        assert_eq!(after_return(SyncResult::Applied, 0), AfterReturn::Refresh);
        assert_eq!(after_return(SyncResult::Refused, 1), AfterReturn::Open);
        assert_eq!(
            after_return(SyncResult::Refused, MAX_RETURN_ATTEMPTS - 1),
            AfterReturn::Open
        );
        assert_eq!(
            after_return(SyncResult::Refused, MAX_RETURN_ATTEMPTS),
            AfterReturn::Refresh
        );
        assert_eq!(
            after_return(SyncResult::Unproven, MAX_RETURN_ATTEMPTS),
            AfterReturn::Fail
        );
        assert_eq!(
            after_refresh(SyncResult::Applied),
            AfterRefresh::Open { stamp: true }
        );
        assert_eq!(
            after_refresh(SyncResult::Refused),
            AfterRefresh::Open { stamp: false }
        );
        assert_eq!(after_refresh(SyncResult::Unproven), AfterRefresh::Fail);
        assert_eq!(SyncResult::new(true, true), SyncResult::Unproven);
        assert_eq!(SyncResult::new(false, true), SyncResult::Unproven);
        assert_eq!(SyncResult::new(false, false), SyncResult::Refused);
    }

    fn origins(scope: &ContextCookieScope) -> Vec<&str> {
        scope
            .origins()
            .iter()
            .map(|origin| origin.as_url().as_str())
            .collect()
    }

    #[test]
    fn the_session_scope_is_the_page_site_and_never_another_site() {
        let document = ContextNavigationTarget::parse("https://app.slack.com/client/T1").unwrap();
        let scope = session_scope(&document, None).unwrap();
        assert_eq!(
            origins(&scope),
            vec!["https://app.slack.com/", "https://slack.com/"]
        );
        let current = url::Url::parse("https://team.slack.com/signin?x=1").unwrap();
        let scope = session_scope(&document, Some(&current)).unwrap();
        assert_eq!(
            origins(&scope),
            vec![
                "https://app.slack.com/",
                "https://slack.com/",
                "https://team.slack.com/"
            ]
        );
        for elsewhere in [
            "https://accounts.google.com/o/oauth2",
            "http://team.slack.com/",
            "https://team.slack.com:8443/",
            "https://slack.com.evil.test/",
        ] {
            let current = url::Url::parse(elsewhere).unwrap();
            assert_eq!(
                session_scope(&document, Some(&current)).unwrap().len(),
                2,
                "{elsewhere}"
            );
        }
        let root = ContextNavigationTarget::parse("https://linear.app/team").unwrap();
        assert_eq!(
            origins(&session_scope(&root, None).unwrap()),
            vec!["https://linear.app/"]
        );
        let port = ContextNavigationTarget::parse("http://127.0.0.1:8080/a").unwrap();
        assert_eq!(
            origins(&session_scope(&port, None).unwrap()),
            vec!["http://127.0.0.1:8080/"]
        );
    }
}
