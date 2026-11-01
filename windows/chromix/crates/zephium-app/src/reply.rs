//! One answer from the actor to an async caller, on any executor. A replier
//! dropped unanswered, such as a command the queue refused, resolves the
//! reply to `None` instead of leaving it waiting.

use std::future::Future;
use std::pin::Pin;
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::task::{Context, Poll, Waker};

struct Slot<T> {
    answer: Option<T>,
    waker: Option<Waker>,
    closed: bool,
}

type Shared<T> = Arc<Mutex<Slot<T>>>;

fn locked<T>(shared: &Shared<T>) -> MutexGuard<'_, Slot<T>> {
    shared.lock().unwrap_or_else(PoisonError::into_inner)
}

pub(crate) struct Replier<T>(Shared<T>);

#[must_use = "the reply resolves only once awaited"]
pub(crate) struct Reply<T>(Shared<T>);

pub(crate) fn channel<T>() -> (Replier<T>, Reply<T>) {
    let shared = Arc::new(Mutex::new(Slot {
        answer: None,
        waker: None,
        closed: false,
    }));
    (Replier(shared.clone()), Reply(shared))
}

impl<T> Replier<T> {
    pub(crate) fn send(self, answer: T) {
        locked(&self.0).answer = Some(answer);
    }
}

impl<T> Drop for Replier<T> {
    fn drop(&mut self) {
        let waker = {
            let mut slot = locked(&self.0);
            slot.closed = true;
            slot.waker.take()
        };
        if let Some(waker) = waker {
            waker.wake();
        }
    }
}

impl<T> Future for Reply<T> {
    type Output = Option<T>;

    fn poll(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Self::Output> {
        let mut slot = locked(&self.0);
        if let Some(answer) = slot.answer.take() {
            return Poll::Ready(Some(answer));
        }
        if slot.closed {
            return Poll::Ready(None);
        }
        if !slot
            .waker
            .as_ref()
            .is_some_and(|waker| waker.will_wake(cx.waker()))
        {
            slot.waker = Some(cx.waker().clone());
        }
        Poll::Pending
    }
}

#[cfg(test)]
pub(crate) fn block_on<T>(future: impl Future<Output = T>) -> T {
    struct Unpark(std::thread::Thread);
    impl std::task::Wake for Unpark {
        fn wake(self: Arc<Self>) {
            self.0.unpark();
        }
    }
    let waker = Waker::from(Arc::new(Unpark(std::thread::current())));
    let mut cx = Context::from_waker(&waker);
    let mut future = std::pin::pin!(future);
    for _ in 0..40 {
        if let Poll::Ready(value) = future.as_mut().poll(&mut cx) {
            return value;
        }
        std::thread::park_timeout(std::time::Duration::from_millis(250));
    }
    panic!("the future did not resolve within ten seconds");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_answer_sent_from_another_thread_wakes_the_waiting_reply() {
        let (replier, reply) = channel();
        let sender = std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(30));
            replier.send(7);
        });
        assert_eq!(block_on(reply), Some(7));
        sender.join().unwrap();
    }

    #[test]
    fn a_replier_dropped_unanswered_resolves_to_none() {
        let (replier, reply) = channel::<u8>();
        drop(replier);
        assert_eq!(block_on(reply), None);
    }
}
