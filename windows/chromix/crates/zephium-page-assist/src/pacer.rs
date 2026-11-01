//! Coalesces answer blocks so the panel receives a few calm updates instead
//! of a burst: at most one delivery per interval, with time supplied by the
//! caller in milliseconds.

/// Shortest time between two deliveries, in milliseconds.
pub const DEFAULT_INTERVAL_MS: u64 = 150;

/// Holds items until their delivery is due.
#[derive(Debug)]
pub struct Pacer<T> {
    interval: u64,
    last: Option<u64>,
    pending: Vec<T>,
}

impl<T> Default for Pacer<T> {
    fn default() -> Self {
        Self::new(DEFAULT_INTERVAL_MS)
    }
}

impl<T> Pacer<T> {
    /// A pacer delivering at most once per `interval` milliseconds.
    pub fn new(interval: u64) -> Self {
        Self {
            interval,
            last: None,
            pending: Vec::new(),
        }
    }

    /// Queues `item`; returns everything due now, which includes it when the
    /// interval since the last delivery has passed.
    pub fn push(&mut self, item: T, now: u64) -> Vec<T> {
        self.pending.push(item);
        self.poll(now)
    }

    /// Everything due at `now`; empty while the interval runs.
    pub fn poll(&mut self, now: u64) -> Vec<T> {
        if self.pending.is_empty() || self.deadline().is_some_and(|due| now < due) {
            return Vec::new();
        }
        self.last = Some(now);
        std::mem::take(&mut self.pending)
    }

    /// When the held items become due; none when nothing is held.
    pub fn deadline(&self) -> Option<u64> {
        if self.pending.is_empty() {
            return None;
        }
        Some(
            self.last
                .map_or(0, |last| last.saturating_add(self.interval)),
        )
    }

    /// Everything held, regardless of the interval (the answer ended).
    pub fn flush(&mut self) -> Vec<T> {
        std::mem::take(&mut self.pending)
    }

    /// Drops everything held (the turn was stopped).
    pub fn clear(&mut self) {
        self.pending.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;

    #[test]
    fn first_item_goes_at_once_and_later_ones_coalesce() {
        let mut pacer = Pacer::new(150);
        assert_eq!(pacer.push(1, 1_000), vec![1]);
        assert!(pacer.push(2, 1_050).is_empty());
        assert!(pacer.push(3, 1_100).is_empty());
        assert_eq!(pacer.deadline(), Some(1_150));
        assert!(pacer.poll(1_149).is_empty());
        assert_eq!(pacer.poll(1_150), vec![2, 3]);
        assert_eq!(pacer.deadline(), None);
        assert_eq!(pacer.push(4, 1_400), vec![4]);
        assert!(pacer.push(5, 1_401).is_empty());
        assert_eq!(pacer.flush(), vec![5]);
        pacer.push(6, 1_402);
        pacer.clear();
        assert_eq!(pacer.flush(), Vec::<i32>::new());
    }

    proptest! {
        #[test]
        fn deliveries_are_spaced_and_nothing_is_lost(steps in proptest::collection::vec(0u64..400, 1..64)) {
            let mut pacer = Pacer::new(150);
            let mut now = 0;
            let mut delivered = Vec::new();
            let mut times = Vec::new();
            for (index, step) in steps.iter().enumerate() {
                now += step;
                let batch = pacer.push(index, now);
                if !batch.is_empty() {
                    times.push(now);
                    delivered.extend(batch);
                }
            }
            delivered.extend(pacer.flush());
            prop_assert_eq!(delivered, (0..steps.len()).collect::<Vec<_>>());
            for pair in times.windows(2) {
                prop_assert!(pair[1] - pair[0] >= 150);
            }
        }
    }
}
