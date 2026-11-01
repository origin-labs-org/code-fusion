//! Capacity stays with the physical worker, not the caller awaiting it.
use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Arc,
};
pub(crate) struct Slots {
    used: AtomicUsize,
    maximum: usize,
}
impl Slots {
    pub fn new(maximum: usize) -> Self {
        Self {
            used: AtomicUsize::new(0),
            maximum,
        }
    }
    pub fn reserve(self: &Arc<Self>) -> Result<Permit, ()> {
        self.used
            .fetch_update(Ordering::AcqRel, Ordering::Acquire, |used| {
                if used < self.maximum {
                    used.checked_add(1)
                } else {
                    None
                }
            })
            .map_err(|_| ())?;
        Ok(Permit {
            slots: self.clone(),
            acknowledged: false,
        })
    }
    #[cfg(test)]
    pub fn outstanding(&self) -> usize {
        self.used.load(Ordering::Acquire)
    }
}
pub(crate) struct Permit {
    slots: Arc<Slots>,
    acknowledged: bool,
}
impl Permit {
    fn acknowledge(mut self) {
        self.acknowledged = true;
    }
}
impl Drop for Permit {
    fn drop(&mut self) {
        if self.acknowledged {
            self.slots.used.fetch_sub(1, Ordering::AcqRel);
        }
    }
}
pub(crate) fn launch<T: Send + 'static>(
    permit: Permit,
    work: impl FnOnce() -> T + Send + 'static,
    acknowledged: impl FnOnce(&T) -> bool + Send + 'static,
) -> tokio::task::JoinHandle<T> {
    tokio::task::spawn_blocking(move || {
        let result = work();
        if acknowledged(&result) {
            permit.acknowledge();
        } else {
            drop(permit);
        }
        result
    })
}
