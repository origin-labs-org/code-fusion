//! Which works changed durably, for runs that wait on the person or on a
//! stop: they wake when their work changes instead of re-reading its whole
//! projection on a timer.
use std::{
    collections::HashMap,
    sync::{Mutex, OnceLock},
    time::Duration,
};
use tokio::sync::watch;
use zephium_core::work::WorkId;

/// The most a waiting run goes without reading its work, changed or not.
pub(crate) const FALLBACK: Duration = Duration::from_secs(5);

type Board = Mutex<HashMap<WorkId, watch::Sender<u64>>>;

fn board() -> &'static Board {
    static BOARD: OnceLock<Board> = OnceLock::new();
    BOARD.get_or_init(Board::default)
}

/// A durable change to `work` was committed.
pub(crate) fn publish(work: WorkId) {
    let mut board = board().lock().unwrap_or_else(|error| error.into_inner());
    let Some(sender) = board.get(&work) else {
        return;
    };
    if sender.receiver_count() == 0 {
        board.remove(&work);
    } else {
        sender.send_modify(|generation| *generation = generation.wrapping_add(1));
    }
}

/// Changes to one work from now on.
pub(crate) fn watch(work: WorkId) -> WorkChanges {
    let mut board = board().lock().unwrap_or_else(|error| error.into_inner());
    board.retain(|_, sender| sender.receiver_count() > 0);
    WorkChanges(
        board
            .entry(work)
            .or_insert_with(|| watch::channel(0).0)
            .subscribe(),
    )
}

pub(crate) struct WorkChanges(watch::Receiver<u64>);
impl WorkChanges {
    /// Whether the work changed since the last look, without waiting.
    pub(crate) fn take(&mut self) -> bool {
        let changed = self.0.has_changed().unwrap_or(true);
        if changed {
            self.0.borrow_and_update();
        }
        changed
    }
    /// Returns once the work has changed since the last return, or after
    /// `fallback` at the latest: a change committed outside the shell, or
    /// time-based state such as a deadline, is still seen.
    pub(crate) async fn next(&mut self, fallback: Duration) {
        if tokio::time::timeout(fallback, self.0.changed())
            .await
            .is_ok_and(|changed| changed.is_err())
        {
            // The board never drops a sender while it has receivers; should
            // it, the fallback still paces the caller.
            tokio::time::sleep(fallback).await;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn a_watcher_wakes_on_its_work_changing_and_otherwise_at_the_fallback() {
        let work = WorkId::generate();
        let other = WorkId::generate();
        let mut changes = watch(work);
        let fallback = Duration::from_millis(300);
        let quick = Duration::from_millis(150);

        let started = std::time::Instant::now();
        publish(other);
        changes.next(fallback).await;
        assert!(
            started.elapsed() >= fallback,
            "another work's change is not ours"
        );

        publish(work);
        let started = std::time::Instant::now();
        changes.next(fallback).await;
        assert!(started.elapsed() < quick);

        // Two changes while the watcher was busy wake it once, not twice.
        publish(work);
        publish(work);
        changes.next(fallback).await;
        let started = std::time::Instant::now();
        changes.next(fallback).await;
        assert!(started.elapsed() >= fallback);

        drop(changes);
        publish(work);
        assert!(!board().lock().unwrap().contains_key(&work));
    }
}
