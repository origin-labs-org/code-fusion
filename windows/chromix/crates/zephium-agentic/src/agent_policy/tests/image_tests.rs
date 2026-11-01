use super::*;
use crate::{
    ContextProfileStorageClass, SemanticModelImageHost, SemanticModelImagePlan as Plan,
    SemanticScreenshot, SemanticScreenshotSource, SemanticScreenshotSourcePort,
    WorkBrowserAnonymousReadAuthority, WorkBrowserExecutionLease, WorkBrowserResourceEvent,
    WorkBrowserResourceId, WorkBrowserResourceNativeOutcome as Native, WorkBrowserResources,
};
use std::{
    future::Future,
    pin::Pin,
    sync::{
        atomic::{AtomicBool, AtomicU8, Ordering},
        Arc, Mutex,
    },
    task::{Context, Poll},
    time::{Duration, Instant},
};
use zephium_core::work::model::WorkModelImageFence;
struct NativeSource {
    id: crate::SemanticScreenshotRequestId,
    digest: [u8; 32],
    context: ContextJoin,
    live: Arc<AtomicBool>,
    deadline: Instant,
}
impl SemanticScreenshotSource for NativeSource {
    fn authenticates(&self, image: &SemanticScreenshot) -> bool {
        self.id == image.id()
            && self.digest == image.native_image_digest()
            && self.context == image.context()
    }
    fn while_current(&self, operation: &mut dyn FnMut()) -> bool {
        if !self.live.load(Ordering::Acquire) {
            return false;
        }
        operation();
        true
    }
    fn poll_lost(&self, _: &mut Context<'_>) -> Poll<()> {
        if self.live.load(Ordering::Acquire) {
            Poll::Pending
        } else {
            Poll::Ready(())
        }
    }
    fn deadline(&self) -> Instant {
        self.deadline
    }
}
struct SourcePort {
    _registry: Mutex<WorkBrowserResources>,
    lease: WorkBrowserExecutionLease,
    live: Arc<AtomicBool>,
    public: bool,
    missing: bool,
    substitute: bool,
}
impl SemanticScreenshotSourcePort for SourcePort {
    fn lease(&self) -> &WorkBrowserExecutionLease {
        &self.lease
    }
    fn public_candidate(&self, context: ContextJoin) -> bool {
        self.public && self.lease.resource().identity().context() == context.identity().id()
    }
    fn claim(&self, image: &SemanticScreenshot) -> Option<Arc<dyn SemanticScreenshotSource>> {
        (!self.missing).then(|| {
            Arc::new(NativeSource {
                id: image.id(),
                digest: if self.substitute {
                    [0; 32]
                } else {
                    image.native_image_digest()
                },
                context: image.context(),
                live: self.live.clone(),
                deadline: Instant::now() + Duration::from_secs(30),
            }) as Arc<dyn SemanticScreenshotSource>
        })
    }
}
struct Host {
    gate: crate::lead::ModelImageGate,
    prepared: Mutex<
        Option<(
            crate::SemanticScreenshotRequestId,
            ContextJoin,
            String,
            bool,
        )>,
    >,
    fence: Mutex<Option<Arc<dyn WorkModelImageFence>>>,
    ack: AtomicU8,
    private: AtomicBool,
}
impl Host {
    fn new() -> Arc<Self> {
        Arc::new(Self {
            gate: crate::lead::ModelImageGate::new(Some(true)),
            prepared: Mutex::new(None),
            fence: Mutex::new(None),
            ack: AtomicU8::new(1),
            private: AtomicBool::new(false),
        })
    }
}
impl SemanticModelImageHost for Host {
    fn admits_source(&self, _: &WorkBrowserExecutionLease) -> bool {
        true
    }
    fn private_disclosure_recorded(&self) -> bool {
        self.private.load(Ordering::Acquire)
    }
    fn enabled(&self) -> bool {
        self.gate.enabled()
    }
    fn prepare(
        &self,
        id: crate::SemanticScreenshotRequestId,
        context: ContextJoin,
        origin: &str,
        public: bool,
    ) -> Plan {
        if !self.enabled() {
            return Plan::Unavailable;
        }
        *self.prepared.lock().unwrap() = Some((id, context, origin.into(), public));
        if public {
            Plan::Public
        } else {
            Plan::Consented
        }
    }
    fn require_consent(&self, _: ContextJoin, _: &str) -> Plan {
        Plan::Waiting
    }
    fn handoff(&self) -> Option<Plan> {
        None
    }
    fn finish_handoff(&self) {}
    fn before_disclosure<'a>(
        &'a self,
        id: crate::SemanticScreenshotRequestId,
        context: ContextJoin,
        origin: &'a str,
        public: bool,
        _: Instant,
    ) -> Pin<Box<dyn Future<Output = Option<Arc<dyn WorkModelImageFence>>> + Send + 'a>> {
        Box::pin(async move {
            if self.prepared.lock().unwrap().take() != Some((id, context, origin.into(), public))
                || self.ack.load(Ordering::Acquire) == 0
            {
                return None;
            }
            if !public {
                self.private.store(true, Ordering::Release);
            }
            if self.ack.load(Ordering::Acquire) == 2 {
                self.gate.begin_change();
                return None;
            }
            let mut slot = self.fence.lock().unwrap();
            if slot.is_none() {
                *slot = self.gate.fence();
            }
            slot.clone()
        })
    }
}
fn native_lease(
    context: ContextJoin,
    proof: &WorkBrowserAnonymousReadAuthority,
    source: &SemanticOrigin,
) -> (WorkBrowserExecutionLease, WorkBrowserResources) {
    let mut rows = WorkBrowserResources::new(1u128.into(), context.identity().profile());
    let now = AgentPolicyInstant::from_millis(NOW);
    let request = rows
        .construct_document_with_original_read(
            WorkBrowserResourceId::from_raw(1),
            context.identity().id(),
            ContextProfileStorageClass::Ephemeral,
            crate::ContextNavigationTarget::parse(source.as_url().as_str()).unwrap(),
            crate::WorkBrowserDocumentPolicy::Exact,
            true,
            proof.clone(),
            now,
        )
        .unwrap();
    let WorkBrowserResourceEvent::Retained(resource) = rows
        .settle_at(request.complete(Native::Constructed), now)
        .unwrap()
    else {
        panic!()
    };
    let request = rows
        .acquire(
            &resource,
            context.identity().owner(),
            now,
            AgentPolicyInstant::from_millis(EXPIRES_AT - 1),
        )
        .unwrap();
    let WorkBrowserResourceEvent::Acquired(lease) = rows
        .settle_at(request.complete(Native::Acquired), now)
        .unwrap()
    else {
        panic!()
    };
    (lease, rows)
}
fn setup(
    public: bool,
    missing: bool,
    substitute: bool,
) -> (
    PolicyFixture,
    SemanticObservation,
    SemanticScreenshot,
    Arc<Host>,
    Arc<AtomicBool>,
    WorkBrowserAnonymousReadAuthority,
) {
    let source = origin("joined-image");
    let context = make_context(931, 932, 933);
    let observed = actionable_observation(context, source.clone(), 1);
    let baseline = observation_payload(&observed, 10)
        .settle_delivery(SemanticModelDeliverySettlement::Committed)
        .unwrap();
    let image = crate::semantic_screenshot::admitted_test_screenshot_mode(
        &observed, &baseline, 81, 0x33, public,
    );
    let mut fixture = policy_fixture(
        931,
        932,
        source.clone(),
        SemanticSensitivity::Public,
        &[SemanticEffectClass::Read],
        run_budget(10, 5000, 10000),
    );
    let proof = WorkBrowserAnonymousReadAuthority::from_original_read(
        fixture.policy.manifest(),
        AgentPlanLeaseBinding::new(fixture.lease, AgentPlanNodeId::from_raw(1)),
        context.identity(),
        &crate::ContextNavigationTarget::parse(source.as_url().as_str()).unwrap(),
        AgentPolicyInstant::from_millis(NOW),
        Instant::now() + Duration::from_secs(30),
    )
    .unwrap();
    let host = Host::new();
    let live = Arc::new(AtomicBool::new(true));
    let (lease, rows) = native_lease(context, &proof, &source);
    let port = Arc::new(SourcePort {
        _registry: Mutex::new(rows),
        lease,
        live: live.clone(),
        public,
        missing,
        substitute,
    });
    fixture
        .policy
        .bind_model_image_owners(fixture.lease, port, host.clone(), Some(proof.clone()))
        .unwrap();
    assert_eq!(
        fixture.policy.model_image_plan(
            image.id(),
            context,
            &source.as_url().origin().ascii_serialization(),
            AgentPolicyInstant::from_millis(NOW)
        ),
        if public {
            Plan::Public
        } else {
            Plan::Consented
        }
    );
    (fixture, observed, image, host, live, proof)
}
#[tokio::test]
async fn joined_image_public_claim_is_exact_and_never_grants_text_or_crop_scope() {
    let (mut fixture, observed, image, _, _, _) = setup(true, false, false);
    let account = account(image.context(), NOW - 1);
    fixture
        .policy
        .admit_model_image(
            &image,
            &observed,
            account,
            AgentPolicyInstant::from_millis(NOW),
        )
        .await
        .unwrap();
    assert!(!fixture.policy.permits_screenshot_sensitivity(fixture.lease));
    let cohorts = screenshot_taints(&observed, account, image.delivery_guard()).unwrap();
    assert!(cohorts
        .iter()
        .all(|cohort| fixture.policy.permits_exact_image_cohort(cohort)));
    let mut different = cohorts[0].clone();
    different.source_guard = [7; 32];
    assert!(!fixture.policy.permits_exact_image_cohort(&different));
    different = cohorts[0].clone();
    different.sensitivity = SemanticSensitivity::Secret;
    assert!(!fixture.policy.permits_exact_image_cohort(&different));
    assert!(fixture
        .policy
        .admit_model_image(
            &image,
            &observed,
            account,
            AgentPolicyInstant::from_millis(NOW)
        )
        .await
        .is_err());
}
#[tokio::test]
async fn joined_image_missing_substituted_source_and_missing_ack_refuse() {
    for (missing, substitute, ack) in [(true, false, 1), (false, true, 1), (false, false, 0)] {
        let (mut fixture, observed, image, host, _, _) = setup(true, missing, substitute);
        host.ack.store(ack, Ordering::Release);
        assert!(fixture
            .policy
            .admit_model_image(
                &image,
                &observed,
                account(image.context(), NOW - 1),
                AgentPolicyInstant::from_millis(NOW)
            )
            .await
            .is_err());
        assert!(fixture.policy.model_image_fence().is_none());
    }
}
#[tokio::test]
async fn joined_image_off_on_and_human_handoff_cannot_revive_old_history() {
    let (mut fixture, observed, image, host, _, proof) = setup(true, false, false);
    fixture
        .policy
        .admit_model_image(
            &image,
            &observed,
            account(image.context(), NOW - 1),
            AgentPolicyInstant::from_millis(NOW),
        )
        .await
        .unwrap();
    let fence = fixture.policy.model_image_fence().unwrap();
    let epoch = host.gate.begin_change().unwrap();
    assert!(host.gate.confirm(epoch, true));
    assert!(!fence.while_current(&mut || panic!("old image dispatched")));
    assert!(fixture.policy.model_image_fence().is_none());
    assert!(fixture.policy.has_model_image_history());
    let (mut fresh, observed, image, _, _, proof2) = setup(true, false, false);
    fresh
        .policy
        .admit_model_image(
            &image,
            &observed,
            account(image.context(), NOW - 1),
            AgentPolicyInstant::from_millis(NOW),
        )
        .await
        .unwrap();
    let fence = fresh.policy.model_image_fence().unwrap();
    proof2.revoke(crate::WorkBrowserAnonymousReadStatus::HumanHandoff);
    assert!(!fence.while_current(&mut || panic!("handoff image dispatched")));
    assert!(fresh.policy.model_image_fence().is_none());
    assert_eq!(
        proof.status(AgentPolicyInstant::from_millis(NOW)),
        crate::WorkBrowserAnonymousReadStatus::Current
    );
    // A new text-only policy has no old image/server-retention authority to replay.
    let text = policy_fixture(
        934,
        932,
        origin("joined-image"),
        SemanticSensitivity::Public,
        &[SemanticEffectClass::Read],
        run_budget(10, 5000, 10000),
    );
    assert!(!text.policy.has_model_image_history());
}
#[tokio::test]
async fn joined_image_private_ack_removes_anonymous_authority_even_if_dispatch_is_revoked() {
    for ack in [1, 2] {
        let (mut fixture, observed, image, host, _, proof) = setup(false, false, false);
        host.ack.store(ack, Ordering::Release);
        let result = fixture
            .policy
            .admit_model_image(
                &image,
                &observed,
                account(image.context(), NOW - 1),
                AgentPolicyInstant::from_millis(NOW),
            )
            .await;
        assert_eq!(result.is_ok(), ack == 1);
        assert!(host.private_disclosure_recorded());
        assert_eq!(
            proof.status(AgentPolicyInstant::from_millis(NOW)),
            crate::WorkBrowserAnonymousReadStatus::PrivateDisclosure
        );
    }
}
