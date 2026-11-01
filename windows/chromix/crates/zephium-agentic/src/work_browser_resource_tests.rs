use super::*;

impl WorkBrowserResources {
    // Most schedules settle on their last supplied tick; timing adversaries
    // call the production settle_at boundary explicitly with a changed clock.
    fn settle(
        &mut self,
        completion: WorkBrowserResourceCompletion,
    ) -> Result<WorkBrowserResourceEvent, WorkBrowserResourceError> {
        let now = self
            .rows
            .get(&completion.operation.resource.identity.resource)
            .map(|row| row.last_tick)
            .unwrap_or(tick(0));
        self.settle_at(completion, now)
    }
}

fn tick(value: u64) -> AgentPolicyInstant {
    AgentPolicyInstant::from_millis(value)
}

#[derive(Default)]
struct HealthWake(std::sync::atomic::AtomicUsize);
impl std::task::Wake for HealthWake {
    fn wake(self: Arc<Self>) {
        self.0.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    }
}

#[test]
fn health_is_exact_private_resource_bound_and_finite_sticky_coalesced() {
    use WorkBrowserResourceHealthState as H;
    let mut rows = registry();
    let resource = create(&mut rows, 701);
    let (mut health, reporter) = health::track(resource.clone());
    let wake = Arc::new(HealthWake::default());
    assert_eq!(health.register(wake.clone().into()), H::Pending);
    assert!(reporter.install(&resource));
    assert_eq!(health.snapshot(), H::Current);
    assert_eq!(wake.0.load(std::sync::atomic::Ordering::SeqCst), 1);
    for _ in 0..10_000 {
        reporter.invalidate();
    }
    assert_eq!(health.snapshot(), H::Uncertain);
    assert_eq!(wake.0.load(std::sync::atomic::Ordering::SeqCst), 1);
    assert_eq!(health.poll(), H::Uncertain);
    reporter.invalidate();
    assert_eq!(wake.0.load(std::sync::atomic::Ordering::SeqCst), 2);
    drop(reporter);
    assert_eq!(health.poll(), H::Uncertain);
    assert!(!rows.is_quiescent());

    let mut identical_ids = registry();
    let foreign = create(&mut identical_ids, 701);
    assert_eq!(resource.identity(), foreign.identity());
    assert_ne!(resource, foreign);
    let (mut health, reporter) = health::track(resource.clone());
    health.register(wake.clone().into());
    assert!(!reporter.install(&foreign));
    assert!(!reporter.is_current(&resource));
    assert_eq!(health.poll(), H::Uncertain);
}

#[test]
fn health_original_registration_cannot_be_rebound_and_retirement_is_not_absence() {
    use WorkBrowserResourceHealthState as H;
    let mut rows = registry();
    let resource = create(&mut rows, 702);
    let (mut health, reporter) = health::track(resource.clone());
    health.register(Arc::new(HealthWake::default()).into());
    assert!(reporter.install(&resource));
    health.poll();
    drop(reporter);
    assert_eq!(health.poll(), H::Retired);
    assert!(!rows.is_quiescent());
    let (mut health, reporter) = health::track(resource.clone());
    health.register(Arc::new(HealthWake::default()).into());
    assert!(reporter.install(&resource));
    assert_eq!(
        health.register(Arc::new(HealthWake::default()).into()),
        H::Uncertain
    );
    assert!(!reporter.is_current(&resource));
}

#[test]
fn health_missing_registration_receiver_or_reporter_and_duplicate_install_close_admission() {
    use WorkBrowserResourceHealthState as H;
    let mut rows = registry();
    let resource = create(&mut rows, 703);
    let (mut health, reporter) = health::track(resource.clone());
    assert!(!reporter.install(&resource));
    // Register-then-recheck observes a publication preceding registration;
    // it cannot heal the original missing delivery owner.
    let wake = Arc::new(HealthWake::default());
    assert_eq!(health.register(wake.clone().into()), H::Uncertain);
    assert_eq!(wake.0.load(std::sync::atomic::Ordering::SeqCst), 1);
    let (mut health, reporter) = health::track(resource.clone());
    health.register(wake.clone().into());
    assert!(reporter.install(&resource));
    assert!(!reporter.install(&resource));
    assert_eq!(health.poll(), H::Uncertain);
    let (mut health, reporter) = health::track(resource.clone());
    health.register(wake.into());
    assert!(reporter.install(&resource));
    drop(health);
    assert!(!reporter.is_current(&resource));
    let (health, reporter) = health::track(resource);
    drop(reporter);
    assert_eq!(health.snapshot(), H::Uncertain);
}

#[test]
fn health_wake_panic_is_contained_and_cannot_authorize_native_execution() {
    struct Panics;
    impl std::task::Wake for Panics {
        fn wake(self: Arc<Self>) {
            panic!("intentional health wake failure");
        }
    }
    let mut rows = registry();
    let resource = create(&mut rows, 704);
    let (mut health, reporter) = health::track(resource.clone());
    health.register(Arc::new(Panics).into());
    assert!(!reporter.install(&resource));
    assert_eq!(health.poll(), WorkBrowserResourceHealthState::Uncertain);
    assert!(!reporter.is_current(&resource));
}

#[test]
fn health_request_attachment_is_construct_only_move_only_and_unhandled_fails_closed() {
    let mut rows = registry();
    let request = rows
        .construct(
            WorkBrowserResourceId::from_raw(705),
            ContextId::from_raw(805),
            ContextProfileStorageClass::Ephemeral,
            tick(0),
        )
        .unwrap();
    let (request, mut health) = request.track_resource_health().unwrap();
    let request = *request.track_resource_health().unwrap_err();
    health.register(Arc::new(HealthWake::default()).into());
    let resource = request.resource().clone();
    let _ = rows
        .settle(request.complete(WorkBrowserResourceNativeOutcome::Constructed))
        .unwrap();
    assert_eq!(health.poll(), WorkBrowserResourceHealthState::Uncertain);
    let request = rows
        .acquire(&resource, ContextRunId::from_raw(706), tick(1), tick(100))
        .unwrap();
    assert!(request.track_resource_health().is_err());
}

#[test]
fn health_consume_acquires_coalesced_publication_or_preserves_a_successor_wake() {
    use std::sync::atomic::Ordering;
    use WorkBrowserResourceHealthState as H;
    let mut rows = registry();
    let resource = create(&mut rows, 707);
    for before in [false, true] {
        let (mut health, reporter) = health::track(resource.clone());
        let wake = Arc::new(HealthWake::default());
        health.register(wake.clone().into());
        assert!(reporter.install(&resource));
        if before {
            reporter.invalidate();
            assert_eq!(health.poll(), H::Uncertain);
            assert_eq!(wake.0.load(Ordering::Acquire), 1); // publication coalesced
        } else {
            assert_eq!(health.poll(), H::Current);
            reporter.invalidate();
            assert_eq!(health.poll(), H::Uncertain);
            assert_eq!(wake.0.load(Ordering::Acquire), 2); // consume won; next wake
        }
    }
}
fn registry() -> WorkBrowserResources {
    WorkBrowserResources::new(WorkId::from(1), ProfileId::from(2))
}

#[test]
fn native_shutdown_joins_original_sealed_retained_registry_once_without_proving_zero() {
    let mut rows = registry();
    assert!(matches!(
        rows.begin_native_shutdown(),
        Err(WorkBrowserResourceError::Phase)
    ));
    let resource = create(&mut rows, 804);
    rows.seal();
    assert!(matches!(
        rows.begin_native_shutdown(),
        Err(WorkBrowserResourceError::Phase)
    ));
    let destruction = rows.destroy(&resource).unwrap();
    assert!(matches!(
        rows.begin_native_shutdown(),
        Err(WorkBrowserResourceError::Phase)
    ));
    assert!(matches!(
        rows.settle(destruction.complete(WorkBrowserResourceNativeOutcome::Destroyed))
            .unwrap(),
        WorkBrowserResourceEvent::Destroyed(_)
    ));
    let coordinator = rows.begin_native_shutdown().unwrap();
    assert_eq!(
        coordinator.status().stage(),
        crate::AgentNativeShutdownStage::ReadyToSeal
    );
    assert_eq!(coordinator.status().attempts(), 0);
    assert!(
        coordinator.finish().is_err(),
        "local destruction cannot manufacture native zero"
    );
    assert!(matches!(
        rows.begin_native_shutdown(),
        Err(WorkBrowserResourceError::Sealed)
    ));
    assert!(matches!(
        rows.acquire(&resource, ContextRunId::from_raw(804), tick(3), tick(90)),
        Err(WorkBrowserResourceError::Sealed)
    ));
}
#[test]
fn finalized_document_receipt_keeps_requested_lineage_and_binds_only_effective_source() {
    let mut rows = registry();
    let requested = ContextNavigationTarget::parse("https://example.test/product").unwrap();
    let effective =
        ContextNavigationTarget::parse("https://example.test/product?opaque=one").unwrap();
    let request = rows
        .construct_document_with_policy(
            WorkBrowserResourceId::from_raw(40),
            ContextId::from_raw(140),
            ContextProfileStorageClass::Ephemeral,
            requested.clone(),
            crate::WorkBrowserDocumentPolicy::InitialQueryFinalization,
            tick(0),
        )
        .unwrap();
    let resource = request.resource().clone();
    assert!(rows
        .acquire(&resource, ContextRunId::from_raw(1), tick(0), tick(100))
        .is_err());
    assert!(matches!(
        rows.settle(request.complete_document(effective.clone()))
            .unwrap(),
        WorkBrowserResourceEvent::Retained(_)
    ));
    let acquire_request = rows
        .acquire(&resource, ContextRunId::from_raw(1), tick(0), tick(100))
        .unwrap();
    assert_eq!(acquire_request.document(), Some(&requested));
    assert_eq!(
        acquire_request.document_policy(),
        crate::WorkBrowserDocumentPolicy::InitialQueryFinalization
    );
    let WorkBrowserResourceEvent::Acquired(lease) = rows
        .settle(acquire_request.complete(WorkBrowserResourceNativeOutcome::Acquired))
        .unwrap()
    else {
        panic!("exact lease")
    };
    let binding = rows.read_binding(&lease, tick(0)).unwrap();
    assert_eq!(binding.requested_document(), &requested);
    assert_eq!(binding.document(), &effective);
    assert_eq!(
        binding.document_policy(),
        crate::WorkBrowserDocumentPolicy::InitialQueryFinalization
    );
    assert_eq!(binding.lease().resource(), &resource);
}
#[test]
fn missing_changed_or_foreign_finalization_receipts_never_retain() {
    for policy in [
        crate::WorkBrowserDocumentPolicy::Exact,
        crate::WorkBrowserDocumentPolicy::InitialQueryFinalization,
    ] {
        for final_url in [
            None,
            Some("https://example.test/product?opaque=one"),
            Some("https://example.test/other?opaque=one"),
        ] {
            let mut rows = registry();
            let request = rows
                .construct_document_with_policy(
                    WorkBrowserResourceId::from_raw(40),
                    ContextId::from_raw(140),
                    ContextProfileStorageClass::Ephemeral,
                    ContextNavigationTarget::parse("https://example.test/product").unwrap(),
                    policy,
                    tick(0),
                )
                .unwrap();
            let completion = match final_url {
                Some(url) => {
                    request.complete_document(ContextNavigationTarget::parse(url).unwrap())
                }
                None => request.complete(WorkBrowserResourceNativeOutcome::Constructed),
            };
            let accepted = matches!(
                rows.settle(completion).unwrap(),
                WorkBrowserResourceEvent::Retained(_)
            );
            assert_eq!(
                accepted,
                (policy == crate::WorkBrowserDocumentPolicy::Exact && final_url.is_none())
                    || (policy == crate::WorkBrowserDocumentPolicy::InitialQueryFinalization
                        && final_url == Some("https://example.test/product?opaque=one"))
            );
        }
    }
    let mut rows = registry();
    let mut foreign = registry();
    let make = |rows: &mut WorkBrowserResources| {
        rows.construct_document_with_policy(
            WorkBrowserResourceId::from_raw(40),
            ContextId::from_raw(140),
            ContextProfileStorageClass::Ephemeral,
            ContextNavigationTarget::parse("https://example.test/product").unwrap(),
            crate::WorkBrowserDocumentPolicy::InitialQueryFinalization,
            tick(0),
        )
        .unwrap()
    };
    let original = make(&mut rows);
    let other = make(&mut foreign);
    assert_eq!(
        rows.settle(other.complete_document(
            ContextNavigationTarget::parse("https://example.test/product?opaque=one").unwrap()
        ))
        .unwrap_err(),
        WorkBrowserResourceError::Stale
    );
    assert!(matches!(
        rows.settle(original.complete_document(
            ContextNavigationTarget::parse("https://example.test/product").unwrap()
        ))
        .unwrap(),
        WorkBrowserResourceEvent::Retained(_)
    ));
}
fn create(registry: &mut WorkBrowserResources, id: u128) -> WorkBrowserResourceJoin {
    let request = registry
        .construct(
            WorkBrowserResourceId::from_raw(id),
            ContextId::from_raw(id + 100),
            ContextProfileStorageClass::Ephemeral,
            tick(0),
        )
        .unwrap();
    match registry
        .settle(request.complete(WorkBrowserResourceNativeOutcome::Constructed))
        .unwrap()
    {
        WorkBrowserResourceEvent::Retained(resource) => resource,
        _ => panic!("construction must retain resource"),
    }
}
fn acquire(
    registry: &mut WorkBrowserResources,
    resource: &WorkBrowserResourceJoin,
    run: u128,
) -> WorkBrowserExecutionLease {
    let request = registry
        .acquire(resource, ContextRunId::from_raw(run), tick(1), tick(100))
        .unwrap();
    match registry
        .settle(request.complete(WorkBrowserResourceNativeOutcome::Acquired))
        .unwrap()
    {
        WorkBrowserResourceEvent::Acquired(lease) => lease,
        _ => panic!("native lease binding"),
    }
}
fn drained() -> WorkBrowserResourceNativeOutcome {
    WorkBrowserResourceNativeOutcome::Revoked {
        debt: WorkBrowserLeaseNativeDebt::default(),
        resource_retained: true,
    }
}

fn ended(
    registry: &mut WorkBrowserResources,
    request: WorkBrowserResourceRequest,
) -> WorkBrowserLeaseEnded {
    match registry.settle(request.complete(drained())).unwrap() {
        WorkBrowserResourceEvent::LeaseEnded(ended) => ended,
        _ => panic!("exact lease ended"),
    }
}

#[test]
fn delivery_requires_normal_native_return_beside_exact_core_terminal_and_consumes_once() {
    let mut rows = registry();
    let resource = create(&mut rows, 301);
    let lease = acquire(&mut rows, &resource, 302);
    let (mut request, mut ticket) = rows.revoke_with_delivery(&lease).unwrap();
    let native = request.take_lease_delivery_completion().unwrap();
    assert!(request.take_lease_delivery_completion().is_none());
    let ended = ended(&mut rows, request);
    assert!(ticket.try_take().unwrap().is_none());
    assert!(!rows.is_quiescent());
    assert!(native.publish_returned());
    let receipt = ticket.try_take().unwrap().unwrap();
    assert!(receipt.returned());
    assert_eq!(
        ticket.try_take().unwrap_err(),
        WorkBrowserLeaseDeliveryPollError::Consumed
    );
    let proof = ended.join_delivery(receipt).unwrap();
    assert_eq!(proof.lease(), &lease);
    assert!(!rows.is_quiescent());
    assert!(rows.observe_initial(&lease, tick(2)).is_err());
    destroy(&mut rows, &resource);
}

#[test]
fn delivery_unhandled_adapter_or_dropped_native_half_is_never_returned() {
    for explicitly_taken in [false, true] {
        let mut rows = registry();
        let resource = create(&mut rows, 303);
        let lease = acquire(&mut rows, &resource, 304);
        let (mut request, mut ticket) = rows.revoke_with_delivery(&lease).unwrap();
        if explicitly_taken {
            drop(request.take_lease_delivery_completion());
        }
        let ended = ended(&mut rows, request);
        let receipt = ticket.try_take().unwrap().unwrap();
        assert!(!receipt.returned());
        let refusal = ended.join_delivery(receipt).unwrap_err();
        let (ended, receipt) = refusal.into_parts();
        assert_eq!(ended.lease(), &lease);
        assert!(!receipt.returned());
        assert!(!rows.is_quiescent());
    }
}

#[test]
fn delivery_consumer_loss_cannot_acknowledge_normal_return() {
    let mut rows = registry();
    let resource = create(&mut rows, 305);
    let lease = acquire(&mut rows, &resource, 306);
    let (mut request, ticket) = rows.revoke_with_delivery(&lease).unwrap();
    let native = request.take_lease_delivery_completion().unwrap();
    drop(ticket);
    assert!(!native.publish_returned());
    let _ended = ended(&mut rows, request);
    assert!(!rows.is_quiescent());
}

#[test]
fn delivery_same_public_lease_cannot_substitute_another_private_request_slot() {
    let mut rows = registry();
    let resource = create(&mut rows, 307);
    let lease = acquire(&mut rows, &resource, 308);
    let (mut request, mut ticket) = rows.revoke_with_delivery(&lease).unwrap();
    let native = request.take_lease_delivery_completion().unwrap();
    let (mut foreign, mut foreign_ticket) = delivery::track(lease.clone());
    assert!(foreign.completion.take().unwrap().publish_returned());
    let ended = ended(&mut rows, request);
    let foreign_receipt = foreign_ticket.try_take().unwrap().unwrap();
    let refusal = ended.join_delivery(foreign_receipt).unwrap_err();
    let (ended, _) = refusal.into_parts();
    assert!(native.publish_returned());
    let proof = ended
        .join_delivery(ticket.try_take().unwrap().unwrap())
        .unwrap();
    assert_eq!(proof.lease(), &lease);
}

#[test]
fn delivery_legacy_lease_terminal_cannot_join_a_tracked_slot() {
    let mut rows = registry();
    let resource = create(&mut rows, 309);
    let lease = acquire(&mut rows, &resource, 310);
    let request = rows.revoke(&lease).unwrap();
    let ended = ended(&mut rows, request);
    let (mut foreign, mut ticket) = delivery::track(lease);
    assert!(foreign.completion.take().unwrap().publish_returned());
    assert!(ended
        .join_delivery(ticket.try_take().unwrap().unwrap())
        .is_err());
}

#[test]
fn delivery_stale_lease_receipts_refuse_without_losing_either_exact_owner() {
    let mut rows = registry();
    let resource = create(&mut rows, 311);
    let lease_a = acquire(&mut rows, &resource, 312);
    let (mut request_a, mut ticket_a) = rows.revoke_with_delivery(&lease_a).unwrap();
    let native_a = request_a.take_lease_delivery_completion().unwrap();
    let ended_a = ended(&mut rows, request_a);
    assert!(native_a.publish_returned());
    let lease_b = acquire(&mut rows, &resource, 313);
    let (mut request_b, mut ticket_b) = rows.revoke_with_delivery(&lease_b).unwrap();
    let native_b = request_b.take_lease_delivery_completion().unwrap();
    let ended_b = ended(&mut rows, request_b);
    assert!(native_b.publish_returned());
    let refused = ended_a
        .join_delivery(ticket_b.try_take().unwrap().unwrap())
        .unwrap_err();
    let (ended_a, receipt_b) = refused.into_parts();
    assert_eq!(ended_b.join_delivery(receipt_b).unwrap().lease(), &lease_b);
    assert_eq!(
        ended_a
            .join_delivery(ticket_a.try_take().unwrap().unwrap())
            .unwrap()
            .lease(),
        &lease_a
    );
    assert!(!rows.is_quiescent());
}

#[test]
fn delivery_synchronous_non_admission_retains_refusal_without_a_callback_proof() {
    let mut rows = registry();
    let resource = create(&mut rows, 314);
    let lease = acquire(&mut rows, &resource, 315);
    let (request, mut ticket) = rows.revoke_with_delivery(&lease).unwrap();
    assert!(matches!(
        rows.dispatch_refused(request, ContextPortFailure::Unsupported)
            .unwrap(),
        WorkBrowserResourceEvent::AdmissionRefused {
            operation: WorkBrowserResourceOperation::Revoke,
            failure: ContextPortFailure::Unsupported,
            ..
        }
    ));
    assert_eq!(
        rows.phase(&resource).unwrap(),
        WorkBrowserResourcePhase::Quarantined
    );
    assert!(!ticket.try_take().unwrap().unwrap().returned());
    assert!(rows
        .acquire(&resource, ContextRunId::from_raw(316), tick(2), tick(100))
        .is_err());
    assert!(!rows.is_quiescent());
}
fn destroy(registry: &mut WorkBrowserResources, resource: &WorkBrowserResourceJoin) {
    let request = registry.destroy(resource).unwrap();
    assert!(matches!(
        registry
            .settle(request.complete(WorkBrowserResourceNativeOutcome::Destroyed))
            .unwrap(),
        WorkBrowserResourceEvent::Destroyed(_)
    ));
}

#[test]
fn work_identity_persists_across_distinct_run_leases_without_page_relabeling() {
    let mut registry = registry();
    let resource = create(&mut registry, 3);
    let persisted = serde_json::to_string(&resource.identity()).unwrap();
    let restored: WorkBrowserResourceIdentity = serde_json::from_str(&persisted).unwrap();
    assert_eq!(restored, resource.identity());
    assert!(!persisted.contains("run"));
    let first = acquire(&mut registry, &resource, 4);
    assert!(registry.admits_lease(&first, tick(1)).is_ok());
    let request = registry.revoke(&first).unwrap();
    assert_eq!(
        registry.admits_lease(&first, tick(1)),
        Err(WorkBrowserResourceError::Phase)
    );
    let ended = match registry.settle(request.complete(drained())).unwrap() {
        WorkBrowserResourceEvent::LeaseEnded(receipt) => receipt,
        _ => panic!("exact lease-only drain"),
    };
    assert_eq!(ended.lease(), &first);
    assert_eq!(
        registry.phase(&resource).unwrap(),
        WorkBrowserResourcePhase::Retained
    );
    assert!(!registry.is_quiescent());
    let second = acquire(&mut registry, &resource, 5);
    assert_eq!(first.resource(), second.resource());
    assert_ne!(first.run(), second.run());
    assert_eq!(
        registry.admits_lease(&first, tick(1)),
        Err(WorkBrowserResourceError::Stale)
    );
    assert!(registry.admits_lease(&second, tick(1)).is_ok());
    let request = registry.revoke(&second).unwrap();
    let _ = registry.settle(request.complete(drained())).unwrap();
    registry.seal();
    assert!(!registry.is_quiescent());
    destroy(&mut registry, &resource);
    assert!(registry.is_quiescent());
}

#[test]
fn restored_identical_ids_cannot_substitute_registry_or_native_receipt_authority() {
    let mut original = registry();
    let resource = create(&mut original, 3);
    let mut restored = registry();
    let replacement = create(&mut restored, 3);
    assert_eq!(resource.identity(), replacement.identity());
    assert_ne!(resource, replacement);
    let request = original
        .acquire(&resource, ContextRunId::from_raw(4), tick(1), tick(100))
        .unwrap();
    let completion = request.complete(WorkBrowserResourceNativeOutcome::Acquired);
    assert_eq!(
        restored.settle(completion).unwrap_err(),
        WorkBrowserResourceError::Stale
    );
    assert_eq!(
        restored.phase(&replacement).unwrap(),
        WorkBrowserResourcePhase::Retained
    );
    assert_eq!(
        original.phase(&resource).unwrap(),
        WorkBrowserResourcePhase::Acquiring
    );
}

#[test]
fn every_native_debt_class_and_absent_page_refuses_lease_only_retirement() {
    for index in 0..8 {
        let mut registry = registry();
        let resource = create(&mut registry, 3);
        let lease = acquire(&mut registry, &resource, 4);
        let request = registry.revoke(&lease).unwrap();
        let mut debt = WorkBrowserLeaseNativeDebt::default();
        match index {
            0 => debt.queued_tasks = 1,
            1 => debt.observations = 1,
            2 => debt.actions = 1,
            3 => debt.navigations = 1,
            4 => debt.captures = 1,
            5 => debt.callbacks = 1,
            6 => debt.callbacks = u8::MAX,
            _ => {}
        }
        let result = WorkBrowserResourceNativeOutcome::Revoked {
            debt,
            resource_retained: index != 7,
        };
        assert!(matches!(
            registry.settle(request.complete(result)).unwrap(),
            WorkBrowserResourceEvent::Quarantined(WorkBrowserResourceFailure::DrainUnproven)
        ));
        assert_eq!(
            registry.admits_lease(&lease, tick(1)),
            Err(WorkBrowserResourceError::Quarantined)
        );
        assert!(registry
            .acquire(&resource, ContextRunId::from_raw(5), tick(1), tick(100))
            .is_err());
        assert!(!registry.is_quiescent());
        destroy(&mut registry, &resource);
        registry.seal();
        assert!(registry.is_quiescent());
    }
}

#[test]
fn uncertain_callback_never_blocks_reserved_destruction_or_disappears_as_clean() {
    for destruction_first in [false, true] {
        let mut registry = registry();
        let resource = create(&mut registry, 3);
        let request = registry
            .acquire(&resource, ContextRunId::from_raw(4), tick(1), tick(100))
            .unwrap();
        registry.quarantine(&resource).unwrap();
        let close = registry.destroy(&resource).unwrap();
        registry.seal();
        if destruction_first {
            let _ = registry
                .settle(close.complete(WorkBrowserResourceNativeOutcome::Destroyed))
                .unwrap();
            assert!(!registry.is_quiescent());
            assert_eq!(
                registry.reap(&resource),
                Err(WorkBrowserResourceError::Pending)
            );
            assert!(matches!(
                registry
                    .settle(request.complete(WorkBrowserResourceNativeOutcome::Acquired))
                    .unwrap(),
                WorkBrowserResourceEvent::DebtSettled(_)
            ));
        } else {
            assert!(matches!(
                registry
                    .settle(request.complete(WorkBrowserResourceNativeOutcome::Acquired))
                    .unwrap(),
                WorkBrowserResourceEvent::DebtSettled(_)
            ));
            assert_eq!(
                registry.phase(&resource).unwrap(),
                WorkBrowserResourcePhase::Destroying
            );
            assert!(!registry.is_quiescent());
            let _ = registry
                .settle(close.complete(WorkBrowserResourceNativeOutcome::Destroyed))
                .unwrap();
        }
        assert!(registry.is_quiescent());
        assert_eq!(registry.reap(&resource).unwrap(), resource.identity());
    }
}

#[test]
fn quarantine_is_scoped_sticky_and_retains_execution_capacity() {
    let mut registry = registry();
    let resources: Vec<_> = (3..8).map(|id| create(&mut registry, id)).collect();
    let mut leases = Vec::new();
    for (index, resource) in resources.iter().take(MAX_EXECUTING_CONTEXTS).enumerate() {
        leases.push(acquire(&mut registry, resource, 20 + index as u128));
    }
    registry.quarantine(&resources[0]).unwrap();
    assert_eq!(
        registry.admits_lease(&leases[0], tick(1)),
        Err(WorkBrowserResourceError::Quarantined)
    );
    assert!(registry.admits_lease(&leases[1], tick(1)).is_ok());
    assert_eq!(
        registry
            .acquire(
                &resources[4],
                ContextRunId::from_raw(25),
                tick(1),
                tick(100)
            )
            .unwrap_err(),
        WorkBrowserResourceError::Capacity
    );
    destroy(&mut registry, &resources[0]);
    let lease = acquire(&mut registry, &resources[4], 25);
    assert!(registry.admits_lease(&lease, tick(1)).is_ok());
}

#[test]
fn expiry_clock_regression_and_seal_do_not_erase_cleanup_authority() {
    let mut registry = registry();
    let resource = create(&mut registry, 3);
    let lease = acquire(&mut registry, &resource, 4);
    assert_eq!(
        registry.admits_lease(&lease, tick(100)),
        Err(WorkBrowserResourceError::Expired)
    );
    let request = registry.revoke(&lease).unwrap();
    let _ = registry.settle(request.complete(drained())).unwrap();
    assert_eq!(
        registry
            .acquire(&resource, ContextRunId::from_raw(5), tick(99), tick(200))
            .unwrap_err(),
        WorkBrowserResourceError::Quarantined
    );
    registry.seal();
    assert_eq!(
        registry.admits_lease(&lease, tick(101)),
        Err(WorkBrowserResourceError::Sealed)
    );
    destroy(&mut registry, &resource);
    assert!(registry.is_quiescent());
}

#[test]
fn exhausted_acquisition_ids_cannot_block_revoke_or_reserved_destruction() {
    let mut registry = registry();
    let resource = create(&mut registry, 3);
    let lease = acquire(&mut registry, &resource, 4);
    registry.sequence = u64::MAX;
    let request = registry.revoke(&lease).unwrap();
    let _ = registry.settle(request.complete(drained())).unwrap();
    assert_eq!(
        registry
            .acquire(&resource, ContextRunId::from_raw(5), tick(1), tick(100))
            .unwrap_err(),
        WorkBrowserResourceError::Exhausted
    );
    destroy(&mut registry, &resource);
    registry.seal();
    assert!(registry.is_quiescent());
}

#[test]
fn wrong_phase_duplicate_and_old_incarnation_receipts_cannot_reopen_resources() {
    let mut registry = registry();
    let resource = create(&mut registry, 3);
    let request = registry
        .acquire(&resource, ContextRunId::from_raw(4), tick(1), tick(100))
        .unwrap();
    let duplicate = WorkBrowserResourceCompletion {
        effective_document: None,
        operation: (*request.operation).clone(),
        outcome: WorkBrowserResourceNativeOutcome::Acquired,
        delivery: None,
    };
    assert!(matches!(
        registry
            .settle(request.complete(WorkBrowserResourceNativeOutcome::Constructed))
            .unwrap(),
        WorkBrowserResourceEvent::Quarantined(WorkBrowserResourceFailure::Contract)
    ));
    assert_eq!(
        registry.settle(duplicate).unwrap_err(),
        WorkBrowserResourceError::Stale
    );
    destroy(&mut registry, &resource);
    registry.reap(&resource).unwrap();
    let replacement = create(&mut registry, 3);
    assert_eq!(resource.identity(), replacement.identity());
    assert_ne!(resource, replacement);
    assert_eq!(
        registry.phase(&resource),
        Err(WorkBrowserResourceError::Stale)
    );
}

#[test]
fn bounds_duplicate_contexts_and_shutdown_remain_exact() {
    let mut registry = registry();
    for id in 3..(3 + MAX_LIVE_CONTEXTS as u128) {
        create(&mut registry, id);
    }
    assert_eq!(
        registry
            .construct(
                WorkBrowserResourceId::from_raw(99),
                ContextId::from_raw(103),
                ContextProfileStorageClass::Ephemeral,
                tick(0)
            )
            .unwrap_err(),
        WorkBrowserResourceError::Duplicate
    );
    assert_eq!(
        registry
            .construct(
                WorkBrowserResourceId::from_raw(99),
                ContextId::from_raw(199),
                ContextProfileStorageClass::Ephemeral,
                tick(0)
            )
            .unwrap_err(),
        WorkBrowserResourceError::Capacity
    );
    registry.seal();
    assert!(!registry.is_quiescent());
    assert_eq!(
        registry
            .construct(
                WorkBrowserResourceId::from_raw(99),
                ContextId::from_raw(199),
                ContextProfileStorageClass::Ephemeral,
                tick(0)
            )
            .unwrap_err(),
        WorkBrowserResourceError::Sealed
    );
}

#[test]
fn synchronous_nonadmission_is_not_a_native_receipt_or_unknown_construction() {
    let mut registry = registry();
    let request = registry
        .construct(
            WorkBrowserResourceId::from_raw(3),
            ContextId::from_raw(103),
            ContextProfileStorageClass::Ephemeral,
            tick(0),
        )
        .unwrap();
    let resource = request.resource().clone();
    assert!(matches!(
        registry
            .dispatch_refused(request, ContextPortFailure::Unsupported)
            .unwrap(),
        WorkBrowserResourceEvent::AdmissionRefused {
            operation: WorkBrowserResourceOperation::Construct,
            ..
        }
    ));
    registry.seal();
    assert!(registry.is_quiescent());
    assert_eq!(registry.reap(&resource).unwrap(), resource.identity());
}

#[test]
fn refused_acquire_preserves_resource_but_refused_revoke_preserves_native_debt() {
    let mut registry = registry();
    let resource = create(&mut registry, 3);
    let request = registry
        .acquire(&resource, ContextRunId::from_raw(4), tick(1), tick(100))
        .unwrap();
    let unused = request.lease().unwrap().clone();
    let _ = registry
        .dispatch_refused(request, ContextPortFailure::Unsupported)
        .unwrap();
    assert_eq!(
        registry.phase(&resource).unwrap(),
        WorkBrowserResourcePhase::Retained
    );
    assert_eq!(
        registry.admits_lease(&unused, tick(1)),
        Err(WorkBrowserResourceError::Stale)
    );
    let lease = acquire(&mut registry, &resource, 5);
    let request = registry.revoke(&lease).unwrap();
    let _ = registry
        .dispatch_refused(request, ContextPortFailure::ResourceExhausted)
        .unwrap();
    assert_eq!(
        registry.phase(&resource).unwrap(),
        WorkBrowserResourcePhase::Quarantined
    );
    let close = registry.destroy(&resource).unwrap();
    let _ = registry
        .dispatch_refused(close, ContextPortFailure::Shutdown)
        .unwrap();
    assert!(registry.destroy(&resource).is_err());
    registry.seal();
    assert!(!registry.is_quiescent());
}

#[test]
fn late_or_shutdown_raced_acquisition_requires_revocation_without_ever_becoming_leased() {
    for sealed in [false, true] {
        let mut registry = registry();
        let resource = create(&mut registry, 3);
        let request = registry
            .acquire(&resource, ContextRunId::from_raw(4), tick(1), tick(100))
            .unwrap();
        if sealed {
            registry.seal();
        }
        let now = tick(if sealed { 2 } else { 100 });
        let lease = match registry
            .settle_at(
                request.complete(WorkBrowserResourceNativeOutcome::Acquired),
                now,
            )
            .unwrap()
        {
            WorkBrowserResourceEvent::RevocationRequired(lease) => lease,
            _ => panic!("late acquisition must not activate"),
        };
        assert_eq!(
            registry.phase(&resource).unwrap(),
            WorkBrowserResourcePhase::RevocationRequired
        );
        assert!(registry.admits_lease(&lease, now).is_err());
        let request = registry.revoke(&lease).unwrap();
        assert!(matches!(
            registry
                .settle_at(request.complete(drained()), now)
                .unwrap(),
            WorkBrowserResourceEvent::LeaseEnded(_)
        ));
        destroy(&mut registry, &resource);
        registry.seal();
        assert!(registry.is_quiescent());
    }
}

#[test]
fn quarantine_during_acquiring_is_sticky_on_late_native_success() {
    let mut registry = registry();
    let resource = create(&mut registry, 3);
    let request = registry
        .acquire(&resource, ContextRunId::from_raw(4), tick(1), tick(100))
        .unwrap();
    let lease = request.lease().unwrap().clone();
    registry.quarantine(&resource).unwrap();
    assert!(matches!(
        registry
            .settle_at(
                request.complete(WorkBrowserResourceNativeOutcome::Acquired),
                tick(2)
            )
            .unwrap(),
        WorkBrowserResourceEvent::Quarantined(WorkBrowserResourceFailure::CallbackUncertain)
    ));
    assert_eq!(
        registry.admits_lease(&lease, tick(2)),
        Err(WorkBrowserResourceError::Quarantined)
    );
    destroy(&mut registry, &resource);
}

#[test]
fn settlement_clock_failure_keeps_exact_terminal_and_independent_cleanup_owner() {
    let mut registry = registry();
    let resource = create(&mut registry, 3);
    let request = registry
        .acquire(&resource, ContextRunId::from_raw(4), tick(1), tick(100))
        .unwrap();
    assert!(matches!(
        registry
            .settle_at(
                request.complete(WorkBrowserResourceNativeOutcome::Acquired),
                tick(0)
            )
            .unwrap(),
        WorkBrowserResourceEvent::Quarantined(WorkBrowserResourceFailure::ClockRegression)
    ));
    let close = registry.destroy(&resource).unwrap();
    let _ = registry
        .settle_at(
            close.complete(WorkBrowserResourceNativeOutcome::Destroyed),
            tick(0),
        )
        .unwrap();
    assert_eq!(
        registry
            .rows
            .get(&resource.identity.resource)
            .unwrap()
            .failure,
        Some(WorkBrowserResourceFailure::ClockRegression)
    );
    registry.seal();
    assert!(registry.is_quiescent()); // native/local closure only, not a clock/audit success
}

#[test]
fn stale_lease_and_incompatible_acquire_cannot_mutate_the_current_clock_or_owner() {
    let mut registry = registry();
    let resource = create(&mut registry, 3);
    let old = acquire(&mut registry, &resource, 4);
    let revoke = registry.revoke(&old).unwrap();
    let _ = registry.settle(revoke.complete(drained())).unwrap();
    let current = acquire(&mut registry, &resource, 5);
    assert!(registry.admits_lease(&current, tick(10)).is_ok());
    assert_eq!(
        registry.admits_lease(&old, tick(0)),
        Err(WorkBrowserResourceError::Stale)
    );
    assert_eq!(
        registry
            .acquire(&resource, ContextRunId::from_raw(6), tick(0), tick(100))
            .unwrap_err(),
        WorkBrowserResourceError::Phase
    );
    assert!(registry.admits_lease(&current, tick(10)).is_ok());
}

#[test]
fn resource_protocol_payloads_have_fixed_bounded_width_and_redacted_debug() {
    assert!(std::mem::size_of::<WorkBrowserResourceRequest>() <= 256);
    assert!(std::mem::size_of::<WorkBrowserResourceCompletion>() <= 256);
    assert!(std::mem::size_of::<WorkBrowserResourceDispatch>() <= 32);
    let mut registry = registry();
    let resource = create(&mut registry, 3);
    let lease = acquire(&mut registry, &resource, 4);
    let serialized = serde_json::to_string(&resource.identity()).unwrap();
    assert!(serialized.len() <= 192);
    let debug = format!("{lease:?}");
    assert!(debug.contains("[redacted]"));
    assert!(!debug.contains("ProfileId("));
    assert!(!debug.contains(&serde_json::to_string(&lease.run()).unwrap()));
}

#[test]
fn exact_nonadmission_survives_quarantine_without_retaining_a_fictitious_native_lease() {
    let mut registry = registry();
    let request = registry
        .construct(
            WorkBrowserResourceId::from_raw(3),
            ContextId::from_raw(103),
            ContextProfileStorageClass::Ephemeral,
            tick(0),
        )
        .unwrap();
    let resource = request.resource().clone();
    registry.quarantine(&resource).unwrap();
    let _ = registry
        .dispatch_refused(request, ContextPortFailure::Unsupported)
        .unwrap();
    assert_eq!(
        registry.phase(&resource).unwrap(),
        WorkBrowserResourcePhase::Destroyed
    );
    registry.reap(&resource).unwrap();
    let resource = create(&mut registry, 3);
    let request = registry
        .acquire(&resource, ContextRunId::from_raw(4), tick(1), tick(100))
        .unwrap();
    registry.quarantine(&resource).unwrap();
    let _ = registry
        .dispatch_refused(request, ContextPortFailure::Unsupported)
        .unwrap();
    let row = registry.rows.get(&resource.identity.resource).unwrap();
    assert!(row.lease.is_none());
    assert_eq!(row.phase, WorkBrowserResourcePhase::Quarantined);
    assert_eq!(
        row.failure,
        Some(WorkBrowserResourceFailure::CallbackUncertain)
    );
    destroy(&mut registry, &resource);
    registry.seal();
    assert!(registry.is_quiescent());
}

#[test]
fn anonymous_session_attachment_requires_exact_owner_and_isolated_construction() {
    use std::time::{Duration, Instant};
    let profile = ProfileId::from(2_u128);
    let work = WorkId::from(1_u128);
    let deadline = Instant::now() + Duration::from_secs(60);
    for (isolated, session, expected) in [
        (
            true,
            crate::WorkBrowserSession::new(profile, work, deadline),
            true,
        ),
        (
            false,
            crate::WorkBrowserSession::new(profile, work, deadline),
            false,
        ),
        (
            true,
            crate::WorkBrowserSession::new(3_u128.into(), work, deadline),
            false,
        ),
        (
            true,
            crate::WorkBrowserSession::new(profile, WorkId::from(3_u128), deadline),
            false,
        ),
    ] {
        let mut rows = registry();
        let request = rows
            .construct_document_with_isolation(
                WorkBrowserResourceId::generate(),
                ContextId::generate(),
                ContextProfileStorageClass::Durable,
                ContextNavigationTarget::parse("https://example.test/").unwrap(),
                crate::WorkBrowserDocumentPolicy::Exact,
                isolated,
                tick(1),
            )
            .unwrap();
        let result = request.with_anonymous_session(session.clone());
        assert_eq!(result.is_ok(), expected);
        if let Ok(request) = result {
            assert_eq!(request.anonymous_session().unwrap().id(), session.id());
            let request = request.with_anonymous_session(session.clone()).unwrap_err();
            session.close();
            assert!(!request.anonymous_session().unwrap().is_current());
        }
    }
    let mut rows = registry();
    let session = crate::WorkBrowserSession::new(profile, work, deadline);
    session.close();
    let request = rows
        .construct_document_with_isolation(
            WorkBrowserResourceId::generate(),
            ContextId::generate(),
            ContextProfileStorageClass::Durable,
            ContextNavigationTarget::parse("https://example.test/").unwrap(),
            crate::WorkBrowserDocumentPolicy::Exact,
            true,
            tick(1),
        )
        .unwrap();
    assert!(request.with_anonymous_session(session).is_err());
}

#[test]
fn work_website_data_is_isolated_construction_only_and_excludes_run_storage() {
    use std::time::{Duration, Instant};
    let profile = ProfileId::from(2_u128);
    let work = WorkId::from(1_u128);
    let deadline = Instant::now() + Duration::from_secs(60);
    let construct = |rows: &mut WorkBrowserResources, isolated| {
        rows.construct_document_with_isolation(
            WorkBrowserResourceId::generate(),
            ContextId::generate(),
            ContextProfileStorageClass::Durable,
            ContextNavigationTarget::parse("https://example.test/").unwrap(),
            crate::WorkBrowserDocumentPolicy::Exact,
            isolated,
            tick(1),
        )
        .unwrap()
    };
    let mut rows = registry();
    assert!(construct(&mut rows, false)
        .with_work_website_data()
        .is_err());
    let request = construct(&mut rows, true).with_work_website_data().unwrap();
    assert!(request.work_website_data());
    let session = crate::WorkBrowserSession::new(profile, work, deadline);
    let request = request.with_anonymous_session(session.clone()).unwrap_err();
    assert!(request.anonymous_session().is_none());
    assert!(request.with_work_website_data().is_err());
    let sessioned = construct(&mut rows, true)
        .with_anonymous_session(session)
        .unwrap();
    let refused = sessioned.with_work_website_data().unwrap_err();
    assert!(!refused.work_website_data());
}

#[test]
fn public_asset_retry_needs_frozen_public_isolation_not_a_cookie_free_claim() {
    use crate::WorkBrowserMediaFetchMode as Mode;
    use crate::{
        ContextCapabilities, ContextCapability, ContextIdentity, ContextKind, ContextOperationId,
        ContextRegistry, ContextRunId, ContextSettlement, FrameGeneration, FrameId,
        SemanticFrameJoin, SemanticFrameTrust, SemanticInvocationId, SemanticOrigin,
        SemanticSnapshotGeneration,
    };
    for storage in [
        ContextProfileStorageClass::Durable,
        ContextProfileStorageClass::Ephemeral,
    ] {
        for isolated in [false, true] {
            for policy in [
                crate::WorkBrowserDocumentPolicy::PublicQueryFinalization,
                crate::WorkBrowserDocumentPolicy::SiteSession,
            ] {
                for mode in [Mode::SessionOnly, Mode::PublicAssetRetry] {
                    let mut rows = registry();
                    let target =
                        ContextNavigationTarget::parse("https://example.test/catalog").unwrap();
                    let request = rows
                        .construct_document_with_isolation(
                            WorkBrowserResourceId::from_raw(901),
                            ContextId::from_raw(1001),
                            storage,
                            target.clone(),
                            policy,
                            isolated,
                            tick(0),
                        )
                        .unwrap();
                    let WorkBrowserResourceEvent::Retained(resource) =
                        rows.settle(request.complete_document(target)).unwrap()
                    else {
                        panic!()
                    };
                    let identity = ContextIdentity::new(
                        ContextId::from_raw(1001),
                        ContextRunId::from_raw(2),
                        ProfileId::from(2),
                        ContextKind::Owned,
                    );
                    let mut contexts = ContextRegistry::new();
                    contexts
                        .reserve(
                            identity,
                            ContextCapabilities::try_new(
                                ContextKind::Owned,
                                &[ContextCapability::Observe],
                            )
                            .unwrap(),
                        )
                        .unwrap();
                    let construction = contexts
                        .begin_context(identity.id(), ContextOperationId::new(1).unwrap())
                        .unwrap();
                    contexts
                        .settle_construction(
                            identity.id(),
                            construction,
                            ContextSettlement::Applied,
                        )
                        .unwrap();
                    let plan = crate::SemanticRecordMediaPlan {
                        outcome: Default::default(),
                        fetch_stage: Default::default(),
                        crop: None,
                        record: 0,
                        source: [1; 32],
                        frame: SemanticFrameJoin::try_new(
                            contexts.join(identity.id()).unwrap(),
                            FrameId::MAIN,
                            FrameGeneration::INITIAL,
                            SemanticOrigin::parse("https://example.test").unwrap(),
                            SemanticFrameTrust::SameOrigin,
                        )
                        .unwrap(),
                        invocation: SemanticInvocationId::new(1).unwrap(),
                        snapshot: SemanticSnapshotGeneration::new(1).unwrap(),
                        key: 1,
                        name_key: 2,
                    };
                    let result =
                        rows.read_record_media(&resource, vec![plan], mode, tick(1), tick(1000));
                    let allowed = mode == Mode::SessionOnly; // No original construction proof in this legacy fixture.
                    assert_eq!(
                        result.is_ok(),
                        allowed,
                        "storage={storage:?} isolated={isolated} policy={policy:?} mode={mode:?}"
                    );
                    if let Ok((request, _)) = result {
                        assert_eq!(request.media_fetch_mode(), mode);
                    }
                }
            }
        }
    }
}

#[test]
fn original_read_registry_construction_claim_is_exact_and_cannot_be_reused() {
    let proof = anonymous::tests::proof();
    let target = ContextNavigationTarget::parse("https://example.test/").unwrap();
    for (profile, context, target) in [
        (ProfileId::from(2), ContextId::from_raw(3), target.clone()),
        (ProfileId::from(1), ContextId::from_raw(4), target.clone()),
        (
            ProfileId::from(1),
            ContextId::from_raw(3),
            ContextNavigationTarget::parse("https://example.test/other").unwrap(),
        ),
    ] {
        let mut rows = WorkBrowserResources::new(WorkId::from(1), profile);
        assert!(rows
            .construct_document_with_original_read(
                WorkBrowserResourceId::generate(),
                context,
                ContextProfileStorageClass::Ephemeral,
                target,
                crate::WorkBrowserDocumentPolicy::Exact,
                true,
                proof.clone(),
                tick(2)
            )
            .is_err());
        assert_eq!(
            proof.status(tick(2)),
            WorkBrowserAnonymousReadStatus::Absent
        );
    }
    for storage in [
        ContextProfileStorageClass::Ephemeral,
        ContextProfileStorageClass::Durable,
    ] {
        let proof = anonymous::tests::proof();
        let mut rows = WorkBrowserResources::new(WorkId::from(1), ProfileId::from(1));
        let request = rows
            .construct_document_with_original_read(
                WorkBrowserResourceId::generate(),
                ContextId::from_raw(3),
                storage,
                target.clone(),
                crate::WorkBrowserDocumentPolicy::Exact,
                true,
                proof.clone(),
                tick(2),
            )
            .unwrap();
        assert_eq!(
            proof.status(tick(2)),
            WorkBrowserAnonymousReadStatus::Current
        );
        let mut other = WorkBrowserResources::new(WorkId::from(1), ProfileId::from(1));
        assert!(other
            .construct_document_with_original_read(
                WorkBrowserResourceId::generate(),
                ContextId::from_raw(3),
                storage,
                target.clone(),
                crate::WorkBrowserDocumentPolicy::Exact,
                true,
                proof.clone(),
                tick(2)
            )
            .is_err());
        assert!(matches!(
            rows.settle(request.complete_document(target.clone()))
                .unwrap(),
            WorkBrowserResourceEvent::Retained(_)
        ));
        drop(rows);
        assert_eq!(
            proof.status(tick(3)),
            WorkBrowserAnonymousReadStatus::Closed
        );
    }
}
fn original_read_fixture() -> (
    WorkBrowserResources,
    WorkBrowserResourceJoin,
    WorkBrowserAnonymousReadAuthority,
    crate::SemanticRecordMediaPlan,
) {
    let proof = anonymous::tests::proof();
    let mut rows = WorkBrowserResources::new(WorkId::from(1), ProfileId::from(1));
    let target = ContextNavigationTarget::parse("https://example.test/").unwrap();
    let request = rows
        .construct_document_with_original_read(
            WorkBrowserResourceId::generate(),
            ContextId::from_raw(3),
            ContextProfileStorageClass::Durable,
            target.clone(),
            crate::WorkBrowserDocumentPolicy::Exact,
            true,
            proof.clone(),
            tick(2),
        )
        .unwrap();
    let WorkBrowserResourceEvent::Retained(resource) =
        rows.settle(request.complete_document(target)).unwrap()
    else {
        panic!("construction")
    };
    let request = rows
        .acquire(&resource, ContextRunId::from_raw(2), tick(3), tick(80))
        .unwrap();
    let WorkBrowserResourceEvent::Acquired(lease) = rows
        .settle(request.complete(WorkBrowserResourceNativeOutcome::Acquired))
        .unwrap()
    else {
        panic!("lease")
    };
    let binding = rows.read_binding(&lease, tick(4)).unwrap();
    let plan = crate::SemanticRecordMediaPlan {
        outcome: Default::default(),
        fetch_stage: Default::default(),
        crop: None,
        record: 0,
        source: [1; 32],
        frame: binding.frame().clone(),
        invocation: crate::SemanticInvocationId::new(1).unwrap(),
        snapshot: crate::SemanticSnapshotGeneration::new(1).unwrap(),
        key: 1,
        name_key: 2,
    };
    let revoke = rows.revoke(&lease).unwrap();
    let _ = ended(&mut rows, revoke);
    (rows, resource, proof, plan)
}
#[test]
fn original_read_registry_retained_fetch_needs_exact_source_lease_and_no_handoff() {
    use crate::WorkBrowserMediaFetchMode as Mode;
    let (mut rows, resource, proof, plan) = original_read_fixture();
    assert_eq!(
        rows.anonymous_read_status(&resource, tick(5)).unwrap(),
        WorkBrowserAnonymousReadStatus::Current
    );
    let (capped, _) = rows
        .read_record_media(
            &resource,
            vec![plan.clone()],
            Mode::PublicAssetRetry,
            tick(5),
            tick(100),
        )
        .unwrap();
    assert_eq!(
        capped.media_deadline(),
        Some(tick(90)),
        "media cannot extend original policy expiry"
    );
    let _ = rows
        .dispatch_refused(capped, ContextPortFailure::Unsupported)
        .unwrap();
    let (request, _) = rows
        .read_record_media(
            &resource,
            vec![plan.clone()],
            Mode::PublicAssetRetry,
            tick(5),
            tick(80),
        )
        .unwrap();
    let _ = rows
        .dispatch_refused(request, ContextPortFailure::Unsupported)
        .unwrap();
    let request = rows
        .acquire(&resource, ContextRunId::from_raw(2), tick(6), tick(80))
        .unwrap();
    let WorkBrowserResourceEvent::Acquired(lease) = rows
        .settle(request.complete(WorkBrowserResourceNativeOutcome::Acquired))
        .unwrap()
    else {
        panic!("lease")
    };
    let revoke = rows.revoke(&lease).unwrap();
    let _ = ended(&mut rows, revoke);
    assert!(
        rows.read_record_media(
            &resource,
            vec![plan],
            Mode::PublicAssetRetry,
            tick(7),
            tick(80)
        )
        .is_err(),
        "older same-run lease is stale"
    );
    assert_eq!(
        proof.status(tick(7)),
        WorkBrowserAnonymousReadStatus::Current
    );
}
#[test]
fn original_read_registry_every_handoff_loses_authority_and_never_revives_on_return() {
    use crate::WorkBrowserMediaFetchMode as Mode;
    for kind in 0..3 {
        for refused in [false, true] {
            let (mut rows, resource, proof, mut plan) = original_read_fixture();
            let request = if kind == 0 {
                rows.hand_over_unpresented(&resource, tick(5), tick(80))
                    .unwrap()
            } else {
                rows.present_human_for(
                    &resource,
                    WorkBrowserHumanRegion::try_new(0, 0, 800, 600).unwrap(),
                    tick(5),
                    tick(80),
                    kind == 2,
                )
                .unwrap()
            };
            assert_eq!(
                proof.status(tick(5)),
                WorkBrowserAnonymousReadStatus::HumanHandoff
            );
            if refused {
                let _ = rows
                    .dispatch_refused(request, ContextPortFailure::Unsupported)
                    .unwrap();
                assert!(rows
                    .read_record_media(
                        &resource,
                        vec![plan],
                        Mode::PublicAssetRetry,
                        tick(6),
                        tick(80)
                    )
                    .is_err());
                assert_eq!(
                    proof.status(tick(6)),
                    WorkBrowserAnonymousReadStatus::HumanHandoff
                );
                continue;
            }
            assert!(matches!(
                rows.settle(request.complete(WorkBrowserResourceNativeOutcome::HumanPresented))
                    .unwrap(),
                WorkBrowserResourceEvent::HumanPresented(_)
            ));
            let request = rows.continue_after_human(&resource, tick(6)).unwrap();
            assert!(matches!(
                rows.settle(request.complete_human_document(
                    ContextNavigationTarget::parse("https://example.test/").unwrap()
                ))
                .unwrap(),
                WorkBrowserResourceEvent::HumanContinued(_)
            ));
            let request = rows
                .acquire(&resource, ContextRunId::from_raw(2), tick(7), tick(80))
                .unwrap();
            let WorkBrowserResourceEvent::Acquired(lease) = rows
                .settle(request.complete(WorkBrowserResourceNativeOutcome::Acquired))
                .unwrap()
            else {
                panic!("lease")
            };
            plan.frame = rows.read_binding(&lease, tick(8)).unwrap().frame().clone();
            let request = rows.revoke(&lease).unwrap();
            let _ = ended(&mut rows, request);
            assert!(rows
                .read_record_media(
                    &resource,
                    vec![plan.clone()],
                    Mode::PublicAssetRetry,
                    tick(9),
                    tick(80)
                )
                .is_err());
            assert!(rows
                .read_record_media(&resource, vec![plan], Mode::SessionOnly, tick(9), tick(80))
                .is_ok());
            assert_eq!(
                proof.status(tick(9)),
                WorkBrowserAnonymousReadStatus::HumanHandoff
            );
        }
    }
}
#[test]
fn original_read_registry_successor_stop_destroy_and_drop_close_shared_proof() {
    for action in 0..5 {
        let (mut rows, resource, proof, _) = original_read_fixture();
        match action {
            0 => {
                rows.seal();
            }
            1 => {
                let _request = rows.destroy(&resource).unwrap();
            }
            2 => {
                rows.quarantine(&resource).unwrap();
            }
            3 => {
                drop(rows);
            }
            _ => {
                let _request = rows
                    .acquire(&resource, ContextRunId::from_raw(8), tick(5), tick(80))
                    .unwrap();
            }
        }
        assert_eq!(
            proof.status(tick(5)),
            if action == 4 {
                WorkBrowserAnonymousReadStatus::SuccessorRun
            } else {
                WorkBrowserAnonymousReadStatus::Closed
            }
        );
    }
}
#[test]
fn original_read_registry_refused_construction_closes_clones_without_native_receipt() {
    let proof = anonymous::tests::proof();
    let mut rows = WorkBrowserResources::new(WorkId::from(1), ProfileId::from(1));
    let request = rows
        .construct_document_with_original_read(
            WorkBrowserResourceId::generate(),
            ContextId::from_raw(3),
            ContextProfileStorageClass::Ephemeral,
            ContextNavigationTarget::parse("https://example.test/").unwrap(),
            crate::WorkBrowserDocumentPolicy::Exact,
            true,
            proof.clone(),
            tick(2),
        )
        .unwrap();
    assert_eq!(
        proof.status(tick(2)),
        WorkBrowserAnonymousReadStatus::Current
    );
    let _ = rows
        .dispatch_refused(request, ContextPortFailure::Unsupported)
        .unwrap();
    assert_eq!(
        proof.status(tick(3)),
        WorkBrowserAnonymousReadStatus::Closed
    );
}

#[test]
fn original_read_mode_selection_racing_revocation_or_expiry_creates_no_native_request() {
    use crate::WorkBrowserMediaFetchMode as Mode;
    for expired in [false, true] {
        let (mut rows, resource, proof, plan) = original_read_fixture();
        let selected = if proof.status(tick(5)) == WorkBrowserAnonymousReadStatus::Current {
            Mode::PublicAssetRetry
        } else {
            Mode::SessionOnly
        };
        assert_eq!(selected, Mode::PublicAssetRetry);
        if !expired {
            proof.revoke(WorkBrowserAnonymousReadStatus::HumanHandoff);
        }
        let at = if expired { 91 } else { 6 };
        assert!(rows
            .read_record_media(
                &resource,
                vec![plan.clone()],
                selected,
                tick(at),
                tick(at + 8)
            )
            .is_err());
        assert!(
            rows.rows
                .get(&resource.identity.resource)
                .unwrap()
                .pending
                .is_none(),
            "no native callback or retry owner was created"
        );
        assert_eq!(
            proof.status(tick(at)),
            if expired {
                WorkBrowserAnonymousReadStatus::Expired
            } else {
                WorkBrowserAnonymousReadStatus::HumanHandoff
            }
        );
        // Session-only access is a separate explicit existing operation; refusal
        // above neither dispatches it nor invokes any legacy public asset fetch.
        assert!(rows
            .read_record_media(
                &resource,
                vec![plan],
                Mode::SessionOnly,
                tick(at),
                tick(at + 8)
            )
            .is_ok());
    }
}

#[test]
fn native_media_retry_accepts_original_read_proof_on_goal_policy() {
    use crate::WorkBrowserMediaFetchMode as Mode;
    let (mut rows, resource, _, plan) = original_read_fixture();
    let (request, _) = rows
        .read_record_media(
            &resource,
            vec![plan],
            Mode::PublicAssetRetry,
            tick(5),
            tick(80),
        )
        .unwrap();
    assert!(
        !request.document_policy().is_public(),
        "regression: goal navigation policy is not a retry grant"
    );
    assert!(request.media_fetch_authority_current(&resource, tick(6)));
    assert!(
        !request.media_fetch_authority_current(&resource, tick(80)),
        "original media deadline remains fixed"
    );
}

#[test]
fn native_media_retry_rejects_wrong_resource_source_generation_and_raised_deadline() {
    use crate::WorkBrowserMediaFetchMode as Mode;
    for change in 0..5 {
        let (mut rows, resource, _, plan) = original_read_fixture();
        let (mut request, _) = rows
            .read_record_media(
                &resource,
                vec![plan],
                Mode::PublicAssetRetry,
                tick(5),
                tick(80),
            )
            .unwrap();
        let (_, other, _, _) = original_read_fixture();
        assert!(!request.media_fetch_authority_current(&other, tick(6)));
        match change {
            0 => request.media.as_mut().unwrap().retry_authority = None,
            1 => {
                request
                    .media
                    .as_mut()
                    .unwrap()
                    .retry_authority
                    .as_mut()
                    .unwrap()
                    .resource = other
            }
            2 => {
                request
                    .media
                    .as_mut()
                    .unwrap()
                    .retry_authority
                    .as_mut()
                    .unwrap()
                    .generation += 1
            }
            3 => request.media.as_mut().unwrap().deadline = tick(81),
            _ => {
                let media = request.media.as_mut().unwrap();
                let old = media.plans[0].frame.clone();
                let original = old.context();
                let identity = crate::ContextIdentity::new(
                    ContextId::from_raw(9),
                    original.identity().owner(),
                    ProfileId::from(1),
                    crate::ContextKind::Owned,
                );
                let foreign = crate::ContextJoin::work_execution(
                    identity,
                    original.context_generation(),
                    original.navigation_epoch(),
                    original.frame_generation(),
                );
                media.plans[0].frame = crate::SemanticFrameJoin::try_new(
                    foreign,
                    crate::FrameId::MAIN,
                    crate::FrameGeneration::INITIAL,
                    crate::SemanticOrigin::parse("https://example.test").unwrap(),
                    crate::SemanticFrameTrust::SameOrigin,
                )
                .unwrap();
            }
        }
        assert!(
            !request.media_fetch_authority_current(&resource, tick(6)),
            "mutation {change}"
        );
    }
}

#[test]
fn native_media_retry_rechecks_loss_between_native_admission_and_callback() {
    use crate::WorkBrowserMediaFetchMode as Mode;
    for reason in [
        WorkBrowserAnonymousReadStatus::HumanHandoff,
        WorkBrowserAnonymousReadStatus::SuccessorRun,
        WorkBrowserAnonymousReadStatus::Closed,
        WorkBrowserAnonymousReadStatus::PrivateDisclosure,
    ] {
        let (mut rows, resource, proof, plan) = original_read_fixture();
        let (request, _) = rows
            .read_record_media(
                &resource,
                vec![plan],
                Mode::PublicAssetRetry,
                tick(5),
                tick(80),
            )
            .unwrap();
        assert!(request.media_fetch_authority_current(&resource, tick(6)));
        proof.revoke(reason);
        assert!(
            !request.media_fetch_authority_current(&resource, tick(7)),
            "loss {reason:?}"
        );
    }
    let (mut rows, resource, _, plan) = original_read_fixture();
    let (request, progress) = rows
        .read_record_media(
            &resource,
            vec![plan],
            Mode::PublicAssetRetry,
            tick(5),
            tick(80),
        )
        .unwrap();
    progress.cancel();
    assert!(!request.media_fetch_authority_current(&resource, tick(6)));
}

#[test]
fn native_media_session_mode_cannot_be_promoted_to_retry_without_original_proof() {
    use crate::WorkBrowserMediaFetchMode as Mode;
    let (mut rows, resource, _, plan) = original_read_fixture();
    let (mut request, _) = rows
        .read_record_media(&resource, vec![plan], Mode::SessionOnly, tick(5), tick(80))
        .unwrap();
    assert!(request.media_fetch_authority_current(&resource, tick(6)));
    assert!(request.media.as_ref().unwrap().retry_authority.is_none());
    request.media.as_mut().unwrap().fetch_mode = Mode::PublicAssetRetry;
    assert!(!request.media_fetch_authority_current(&resource, tick(6)));
}

#[test]
fn public_record_asset_exchange_is_single_use_bounded_and_original_grant_bound() {
    use crate::WorkBrowserMediaFetchMode as Mode;
    for mode in [Mode::SessionOnly, Mode::PublicAssetRetry] {
        let (mut rows, resource, _proof, plan) = original_read_fixture();
        let (_request, progress) = rows
            .read_record_media(&resource, vec![plan.clone()], mode, tick(5), tick(80))
            .unwrap();
        for raw in [
            "http://cdn.example.com/a.png",
            "https://user:password@cdn.example.com/a.png",
            "https://cdn.example.com/a.png?access_token=secret",
        ] {
            assert!(progress
                .request_public_asset(&plan, raw, tick(6), tick(70))
                .is_none());
        }
        let mut foreign = plan.clone();
        foreign.name_key += 1;
        assert!(progress
            .request_public_asset(&foreign, "https://cdn.example.com/a.png", tick(6), tick(70))
            .is_none());
        assert!(progress
            .request_public_asset(&plan, "https://cdn.example.com/a.png", tick(6), tick(81))
            .is_none());
        let reply = progress.request_public_asset(
            &plan,
            "https://cdn.example.com/a.png",
            tick(6),
            tick(70),
        );
        if mode == Mode::SessionOnly {
            assert!(reply.is_none());
            continue;
        }
        let reply = reply.unwrap();
        let pending = progress.take_public_asset().unwrap();
        assert_eq!(pending.url(), "https://cdn.example.com/a.png");
        assert!(pending.current(tick(7)));
        assert!(!format!("{pending:?}").contains("cdn.example.com"));
        assert!(progress.take_public_asset().is_none());
        assert!(progress
            .request_public_asset(&plan, "https://cdn.example.com/b.png", tick(7), tick(70))
            .is_none());
        pending.complete(tick(8), Some(vec![1, 2, 3]));
        assert_eq!(reply.poll(), Some(Some(vec![1, 2, 3])));
    }
}
#[test]
fn public_record_asset_exchange_discards_revoked_expired_cancelled_and_oversized_bytes() {
    for fault in 0..6 {
        let (mut rows, resource, proof, plan) = original_read_fixture();
        let (_request, progress) = rows
            .read_record_media(
                &resource,
                vec![plan.clone()],
                crate::WorkBrowserMediaFetchMode::PublicAssetRetry,
                tick(5),
                tick(80),
            )
            .unwrap();
        let reply = progress
            .request_public_asset(&plan, "https://cdn.example.com/a.png", tick(6), tick(70))
            .unwrap();
        let pending = progress.take_public_asset().unwrap();
        let mut at = tick(8);
        let mut bytes = vec![1];
        match fault {
            0 => progress.cancel(),
            1 => proof.revoke(WorkBrowserAnonymousReadStatus::HumanHandoff),
            2 => at = tick(70),
            3 => bytes = vec![1; crate::MAX_PUBLIC_RECORD_IMAGE_BYTES + 1],
            4 => {
                drop(pending);
                assert_eq!(reply.poll(), Some(None));
                continue;
            }
            _ => {
                assert!(progress.finish(vec![]));
            }
        }
        pending.complete(at, Some(bytes));
        assert_eq!(reply.poll(), Some(None));
    }
}

#[test]
fn public_record_asset_publication_wakes_the_existing_owner_once() {
    struct Counter(std::sync::atomic::AtomicUsize);
    impl std::task::Wake for Counter {
        fn wake(self: std::sync::Arc<Self>) {
            self.0.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        }
    }
    let (mut rows, resource, _proof, plan) = original_read_fixture();
    let (_request, progress) = rows
        .read_record_media(
            &resource,
            vec![plan.clone()],
            crate::WorkBrowserMediaFetchMode::PublicAssetRetry,
            tick(5),
            tick(80),
        )
        .unwrap();
    let counter = std::sync::Arc::new(Counter(std::sync::atomic::AtomicUsize::new(0)));
    progress.set_public_asset_waker(counter.clone().into());
    let _reply = progress
        .request_public_asset(&plan, "https://cdn.example.com/a.png", tick(6), tick(70))
        .unwrap();
    assert_eq!(counter.0.load(std::sync::atomic::Ordering::SeqCst), 1);
    assert!(progress.take_public_asset().is_some());
    assert!(progress
        .request_public_asset(&plan, "https://cdn.example.com/a.png", tick(7), tick(70))
        .is_none());
    assert_eq!(counter.0.load(std::sync::atomic::Ordering::SeqCst), 1);
}
