use super::*;
use crate::work_connections::{Decision, HostFuture};
use std::sync::{
    atomic::{AtomicBool, AtomicUsize, Ordering},
    Mutex,
};
use zephium_core::work::{runtime::WorkConfirmV1, WorkError};
#[derive(Default)]
struct Host {
    answer: Option<String>,
    asks: AtomicUsize,
    records: Mutex<Vec<CallFact>>,
    stopped: AtomicBool,
}
impl ConnectionHost for Host {
    fn cancelled(&self) -> HostFuture<'_, bool> {
        Box::pin(async { self.stopped.load(Ordering::Acquire) })
    }
    fn record(
        &self,
        fact: CallFact,
        _: bool,
        _: Option<String>,
    ) -> HostFuture<'_, Result<(), WorkError>> {
        self.records.lock().unwrap().push(fact);
        Box::pin(async { Ok(()) })
    }
    fn confirm(&self, _: WorkConfirmV1) -> HostFuture<'_, Result<Decision, WorkError>> {
        panic!("read-only broker must never ask for write confirmation")
    }
    fn ask<'a>(
        &'a self,
        prompt: &'a str,
        options: &'a [&'a str],
    ) -> HostFuture<'a, Result<Option<String>, WorkError>> {
        assert!(prompt.contains("CLI (gh)") && prompt.contains("public"));
        assert_eq!(options.first(), Some(&gh::USE));
        self.asks.fetch_add(1, Ordering::Relaxed);
        Box::pin(async { Ok(self.answer.clone()) })
    }
}
#[tokio::test]
async fn generic_service_consent_never_authorizes_cli_and_stop_never_asks() {
    for answer in [None, Some("Use GitHub".into()), Some(gh::DECLINE.into())] {
        let host = Host {
            answer,
            ..Default::default()
        };
        let result = call_with_fetch(
            &host,
            "github_cli_issue",
            &json!({"repo":"fixture/project","number":3}),
            |_| async { panic!("no remote fetch or child allowed without explicit CLI choice") },
        )
        .await;
        assert!(result.is_error);
        assert_eq!(host.asks.load(Ordering::Relaxed), 1);
        assert!(host.records.lock().unwrap().is_empty());
    }
    let host = Host {
        answer: Some(gh::USE.into()),
        stopped: AtomicBool::new(true),
        ..Default::default()
    };
    assert!(
        call_with_fetch(
            &host,
            "github_cli_issue",
            &json!({"repo":"fixture/project","number":3}),
            |_| async { panic!("stopped") }
        )
        .await
        .is_error
    );
    assert_eq!(host.asks.load(Ordering::Relaxed), 0);
}
#[tokio::test]
async fn malformed_or_credential_arguments_never_reach_consent_or_native_runner() {
    let host = Host {
        answer: Some(gh::USE.into()),
        ..Default::default()
    };
    for (name, args) in [
        ("github_api", json!({"repo":"fixture/project"})),
        (
            "github_cli_issue",
            json!({"repo":"fixture/../../project","number":3}),
        ),
        (
            "github_cli_issue",
            json!({"repo":"fixture/project","number":0}),
        ),
        (
            "github_cli_repository",
            json!({"repo":"fixture/project","cwd":"/private/tmp"}),
        ),
        (
            "github_cli_issue",
            json!({"repo":"fixture/ghp_inertFixtureToken","number":3}),
        ),
    ] {
        assert!(
            call_with_fetch(&host, name, &args, |_| async {
                panic!("malformed request")
            })
            .await
            .is_error
        );
    }
    assert_eq!(host.asks.load(Ordering::Relaxed), 0);
    assert!(host.records.lock().unwrap().is_empty());
}
#[test]
fn render_binds_public_identity_and_checks_original_content_before_excerpt() {
    let repo = Request::parse("github_cli_repository", &json!({"repo":"fixture/project"})).unwrap();
    assert!(render(&repo, &json!({"full_name":"other/project","private":false})).is_err());
    assert!(render(
        &repo,
        &json!({"full_name":"fixture/project","private":true})
    )
    .is_err());
    let issue = Request::parse(
        "github_cli_issue",
        &json!({"repo":"fixture/project","number":3}),
    )
    .unwrap();
    assert!(render(&issue, &json!({"number":4,"title":"Wrong"})).is_err());
    let body = format!("{}ghp_inertFixtureToken", "ordinary text ".repeat(1000));
    let error = render(&issue, &json!({"number":3,"title":"Fixture","body":body})).unwrap_err();
    assert!(!error.contains("inertFixtureToken"));
    let (text, fact) = render(
        &issue,
        &json!({"number":3,"title":"Fixture","body":"Public text","state":"open","comments":2}),
    )
    .unwrap();
    assert!(text.contains("2 comments (not included)"));
    assert_eq!(fact.target.as_deref(), Some("fixture/project#3"));
}
#[cfg(target_os = "macos")]
#[tokio::test]
#[ignore = "Connected native public-gh receipt qualification; captured inert responses, no remote service"]
async fn native_public_github_cli_consent_result_and_receipt_are_connected() {
    let host = Host {
        answer: Some(gh::USE.into()),
        ..Default::default()
    };
    let args = json!({"repo":"fixture/project","number":3});
    let response=call_with_fetch(&host,"github_cli_issue",&args,|request|async move {
        assert_eq!(request.endpoint(),"/repos/fixture/project/issues/3");
        Ok(br#"{"number":3,"title":"Inert fixture","body":"Public fixture text","state":"open","comments":0}"#.to_vec())
    }).await;
    assert!(!response.is_error, "{}", response.content);
    assert!(
        !response.content.contains("127.0.0.1")
            && !response.content.contains("work-local-broker-placeholder")
    );
    {
        let records = host.records.lock().unwrap();
        assert_eq!(records.len(), 1);
        assert_eq!(records[0].service, "github");
        assert_eq!(records[0].tool, "github_cli_issue");
        assert_eq!(
            records[0].url.as_deref(),
            Some("https://github.com/fixture/project/issues/3")
        );
    }
    let withheld = call_with_fetch(&host, "github_cli_issue", &args, |_| async {
        Ok(br#"{"number":3,"title":"Fixture","body":"ghp_inertFixtureToken"}"#.to_vec())
    })
    .await;
    assert!(withheld.is_error && !withheld.content.contains("inertFixtureToken"));
    assert_eq!(
        host.records.lock().unwrap().len(),
        1,
        "withheld response must not create a success receipt"
    );
}
