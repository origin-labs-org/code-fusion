//! A timeout settles the UI as unknown, never the native operation as stopped.
//! The worker retains its journal lock, staged original and capacity until the
//! native call actually returns. It never reopens or replays a pending receipt.
use super::Failure;
use crate::work_commands::runner::worker_slots::Slots;
use std::{
    future::Future,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, OnceLock,
    },
    time::Duration,
};
const DEADLINE: Duration = Duration::from_secs(15);
const GRACE: Duration = Duration::from_millis(300);
fn slots() -> &'static Arc<Slots> {
    static SLOTS: OnceLock<Arc<Slots>> = OnceLock::new();
    SLOTS.get_or_init(|| Arc::new(Slots::new(4)))
}
pub(crate) fn launch(
    work: impl FnOnce() -> Result<(), Failure> + Send + 'static,
) -> Result<tokio::task::JoinHandle<Result<(), Failure>>, Failure> {
    let permit = slots().reserve().map_err(|_| Failure::Busy)?;
    // Err is an acknowledged native return, not necessarily a successful file
    // operation. Its unresolved receipt/stage remains durably retained.
    Ok(crate::work_commands::runner::worker_slots::launch(
        permit,
        work,
        |_| true,
    ))
}
struct CancelOnDrop(Arc<AtomicBool>);
impl Drop for CancelOnDrop {
    fn drop(&mut self) {
        self.0.store(true, Ordering::Release);
    }
}
pub(crate) async fn observe<C, CF>(
    worker: tokio::task::JoinHandle<Result<(), Failure>>,
    flag: Arc<AtomicBool>,
    cancelled: C,
) -> Result<(), Failure>
where
    C: Fn() -> CF,
    CF: Future<Output = bool>,
{
    observe_with_limits(worker, flag, cancelled, DEADLINE, GRACE).await
}
pub(super) async fn observe_with_limits<C, CF>(
    mut worker: tokio::task::JoinHandle<Result<(), Failure>>,
    flag: Arc<AtomicBool>,
    cancelled: C,
    deadline: Duration,
    grace: Duration,
) -> Result<(), Failure>
where
    C: Fn() -> CF,
    CF: Future<Output = bool>,
{
    let _cancel = CancelOnDrop(flag.clone());
    let deadline = tokio::time::sleep(deadline);
    tokio::pin!(deadline);
    let mut tick = tokio::time::interval(Duration::from_millis(25));
    let timed_out = loop {
        tokio::select! {
            result=&mut worker=>return result.unwrap_or(Err(Failure::RecoveryPending)),
            _=&mut deadline=>break true,
            _=tick.tick()=>if crate::work_commands::runner::cancellation_requested(&cancelled).await{break false;},
        }
    };
    flag.store(true, Ordering::Release);
    match tokio::time::timeout(grace, &mut worker).await {
        Ok(Ok(Err(Failure::Stopped))) if timed_out => Err(Failure::Deadline),
        Ok(Ok(result)) => result,
        Ok(Err(_)) | Err(_) => Err(Failure::RecoveryPending),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use zephium_core::work::runtime::WorkStepStatus;
    #[tokio::test]
    async fn late_native_result_is_unknown_until_acknowledged_and_keeps_capacity() {
        let slots = Arc::new(Slots::new(1));
        let active = Arc::new(AtomicBool::new(false));
        let entered = active.clone();
        let release = Arc::new(AtomicBool::new(false));
        let proceed = release.clone();
        let worker = crate::work_commands::runner::worker_slots::launch(
            slots.reserve().unwrap(),
            move || {
                entered.store(true, Ordering::Release);
                let until = std::time::Instant::now() + Duration::from_secs(3);
                while !proceed.load(Ordering::Acquire) && std::time::Instant::now() < until {
                    std::thread::sleep(Duration::from_millis(2));
                }
                if !proceed.load(Ordering::Acquire) {
                    return Err(Failure::RecoveryPending);
                }
                Ok(())
            },
            |_| true,
        );
        let flag = Arc::new(AtomicBool::new(false));
        let result = observe_with_limits(
            worker,
            flag.clone(),
            || async { active.load(Ordering::Acquire) },
            Duration::from_secs(2),
            Duration::from_millis(20),
        )
        .await;
        assert_eq!(result, Err(Failure::RecoveryPending));
        assert_eq!(
            Failure::RecoveryPending.step_status(),
            WorkStepStatus::OutcomeUnknown
        );
        assert!(flag.load(Ordering::Acquire));
        assert!(slots.reserve().is_err());
        release.store(true, Ordering::Release);
        tokio::time::timeout(Duration::from_secs(2), async {
            while slots.outstanding() != 0 {
                tokio::time::sleep(Duration::from_millis(5)).await;
            }
        })
        .await
        .unwrap();
        assert!(slots.reserve().is_ok());
    }
    #[tokio::test]
    async fn confirmed_prestage_cancellation_differs_from_deadline() {
        for user_stop in [false, true] {
            let flag = Arc::new(AtomicBool::new(false));
            let worker_flag = flag.clone();
            let worker = launch(move || {
                while !worker_flag.load(Ordering::Acquire) {
                    std::thread::sleep(Duration::from_millis(2));
                }
                Err(Failure::Stopped)
            })
            .unwrap();
            let result = observe_with_limits(
                worker,
                flag,
                || async { user_stop },
                Duration::from_millis(20),
                GRACE,
            )
            .await;
            assert_eq!(
                result,
                Err(if user_stop {
                    Failure::Stopped
                } else {
                    Failure::Deadline
                })
            );
            assert_eq!(
                result.unwrap_err().step_status(),
                if user_stop {
                    WorkStepStatus::Cancelled
                } else {
                    WorkStepStatus::Failed
                }
            );
        }
    }
}
