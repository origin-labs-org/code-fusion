//! Single-use public response exchange. The guard never selects a remote URL.
use super::{guard::Control, Failure, Output};
use serde::{Deserialize, Serialize};
use std::{
    io::Read,
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
    time::Duration,
};
const BODY_LIMIT: usize = 60 * 1024;
const WIRE_LIMIT: usize = 6 * BODY_LIMIT + 1024;
#[derive(Default)]
pub(super) struct Broker {
    waiting: Mutex<Option<Waiting>>,
    used: AtomicBool,
}
struct Waiting {
    challenge: [u8; 16],
    sender: tokio::sync::oneshot::Sender<Result<Vec<u8>, Failure>>,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Response {
    challenge: [u8; 16],
    body: Option<String>,
}
type BodyReceiver = tokio::sync::oneshot::Receiver<Result<Vec<u8>, Failure>>;
impl Broker {
    fn begin(&self) -> Result<([u8; 16], BodyReceiver), Failure> {
        if self.used.swap(true, Ordering::AcqRel) {
            return Err(Failure::Input);
        }
        let mut challenge = [0; 16];
        if unsafe { libc::getentropy(challenge.as_mut_ptr().cast(), challenge.len()) } != 0 {
            return Err(Failure::Launch);
        }
        let (sender, receiver) = tokio::sync::oneshot::channel();
        let mut waiting = self.waiting.lock().map_err(|_| Failure::Failed)?;
        if waiting.is_some() {
            return Err(Failure::Failed);
        }
        *waiting = Some(Waiting { challenge, sender });
        Ok((challenge, receiver))
    }
    /// Runs only after the exact Go echo in this operation's input thread.
    /// Allocation is bounded by the prefix before decoding, then by body bytes.
    pub fn receive(&self, input: &mut impl Read) -> Result<(), Failure> {
        let mut tag = [0];
        input.read_exact(&mut tag).map_err(|_| Failure::Stopped)?;
        if tag != [2] {
            return Err(Failure::Input);
        }
        let mut prefix = [0; 4];
        input
            .read_exact(&mut prefix)
            .map_err(|_| Failure::Stopped)?;
        let count = u32::from_be_bytes(prefix) as usize;
        if count == 0 || count > WIRE_LIMIT {
            return Err(Failure::Limit);
        }
        let mut bytes = vec![0; count];
        input.read_exact(&mut bytes).map_err(|_| Failure::Stopped)?;
        let response: Response = serde_json::from_slice(&bytes).map_err(|_| Failure::Input)?;
        let waiting = self
            .waiting
            .lock()
            .map_err(|_| Failure::Failed)?
            .take()
            .ok_or(Failure::Input)?;
        if response.challenge != waiting.challenge {
            return Err(Failure::Input);
        }
        let result = match response.body {
            Some(body) if body.len() <= BODY_LIMIT => Ok(body.into_bytes()),
            Some(_) => Err(Failure::Limit),
            None => Err(Failure::Failed),
        };
        waiting.sender.send(result).map_err(|_| Failure::Stopped)
    }
}
pub(super) fn response(
    challenge: [u8; 16],
    result: Result<Vec<u8>, Failure>,
) -> Result<Vec<u8>, Failure> {
    let body = match result {
        Ok(bytes) if bytes.len() <= BODY_LIMIT => {
            let body = String::from_utf8(bytes).map_err(|_| Failure::Failed)?;
            if zephium_agentic::contains_recognized_secret(&body) {
                return Err(Failure::Sensitive);
            }
            Some(body)
        }
        Ok(_) => return Err(Failure::Limit),
        Err(error) => return Err(error),
    };
    let bytes = serde_json::to_vec(&Response { challenge, body }).map_err(|_| Failure::Failed)?;
    if bytes.len() > WIRE_LIMIT {
        return Err(Failure::Limit);
    }
    let mut framed = vec![2];
    framed.extend_from_slice(&(bytes.len() as u32).to_be_bytes());
    framed.extend(bytes);
    Ok(framed)
}
pub(super) async fn run(
    runtime: &super::macos_github::Runtime,
    control: &Control,
    id: [u8; 16],
) -> Result<Output, Failure> {
    control.check()?;
    let listener = super::github::socket::Listener::bind(&runtime.socket)?;
    let nonce = format!(
        "{:032x}",
        u128::from_be_bytes(zephium_core::work::WorkArtifactId::generate().bytes())
    );
    let halt = AtomicBool::new(false);
    let cancelled = || async { control.check().is_err() || halt.load(Ordering::Acquire) };
    let child = async {
        let result = runtime
            .run_custodied(&nonce, &cancelled, |pid, instance| {
                if super::guard::github_child(control, id, pid, instance).is_err() {
                    halt.store(true, Ordering::Release)
                }
            })
            .await;
        if result.is_err() || result.as_ref().is_ok_and(|r| !r.success) {
            halt.store(true, Ordering::Release)
        }
        result
    };
    let broker = async {
        let result = super::github::serve(listener, 1, &nonce, &halt, || async {
            control.check()?;
            let (challenge, reply) = control.broker.begin()?;
            super::guard::github_fetch(control, id, challenge)?;
            tokio::time::timeout(Duration::from_secs(12), reply)
                .await
                .map_err(|_| Failure::Limit)?
                .map_err(|_| Failure::Stopped)?
        })
        .await;
        if result.is_err() {
            halt.store(true, Ordering::Release)
        }
        result
    };
    let (child, broker) = tokio::join!(child, broker);
    if matches!(child, Err(Failure::StopUnconfirmed)) {
        return Err(Failure::StopUnconfirmed);
    }
    control.check()?;
    let expected = broker?;
    let output = child?;
    if !output.success
        || serde_json::from_str::<serde_json::Value>(&output.text).ok() != Some(expected)
    {
        return Err(Failure::Failed);
    }
    Ok(output)
}

pub(super) async fn fetch_response<C, CF, FF>(
    challenge: [u8; 16],
    fetch: FF,
    cancelled: &C,
) -> Result<Vec<u8>, Failure>
where
    C: Fn() -> CF,
    CF: std::future::Future<Output = bool>,
    FF: std::future::Future<Output = Result<Vec<u8>, Failure>>,
{
    tokio::pin!(fetch);
    let limit = tokio::time::sleep(Duration::from_secs(12));
    tokio::pin!(limit);
    let mut tick = tokio::time::interval(Duration::from_millis(25));
    loop {
        tokio::select! {
            result=&mut fetch=>return response(challenge,result),
            _=&mut limit=>return Err(Failure::Limit),
            _=tick.tick()=>if super::cancellation_requested(cancelled).await{return Err(Failure::Stopped)},
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn prequeued_or_wrong_challenge_cannot_release_body() {
        let broker = Broker::default();
        assert!(broker
            .receive(&mut response([0; 16], Ok(b"{}".to_vec())).unwrap().as_slice())
            .is_err());
        let (challenge, mut receiver) = broker.begin().unwrap();
        let mut wrong = challenge;
        wrong[0] ^= 1;
        assert!(broker
            .receive(&mut response(wrong, Ok(b"{}".to_vec())).unwrap().as_slice())
            .is_err());
        assert!(receiver.try_recv().is_err());
        assert!(broker.begin().is_err());
    }
    #[tokio::test]
    async fn response_is_once_bounded_and_exactly_bound() {
        let broker = Broker::default();
        let (challenge, receiver) = broker.begin().unwrap();
        let bytes = response(challenge, Ok(b"{\"ok\":true}".to_vec())).unwrap();
        broker.receive(&mut bytes.as_slice()).unwrap();
        assert_eq!(receiver.await.unwrap().unwrap(), b"{\"ok\":true}");
        assert!(broker.receive(&mut bytes.as_slice()).is_err());
        assert!(broker.begin().is_err());
    }
    #[test]
    fn oversized_frame_unknown_fields_and_trailing_json_are_refused() {
        let broker = Broker::default();
        let mut huge = vec![2];
        huge.extend_from_slice(&((WIRE_LIMIT + 1) as u32).to_be_bytes());
        assert_eq!(broker.receive(&mut huge.as_slice()), Err(Failure::Limit));
        for body in [
            r#"{"challenge":[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],"body":null,"url":"https://example.invalid"}"#,
            r#"{} {}"#,
        ] {
            let mut frame = vec![2];
            frame.extend_from_slice(&(body.len() as u32).to_be_bytes());
            frame.extend_from_slice(body.as_bytes());
            assert_eq!(broker.receive(&mut frame.as_slice()), Err(Failure::Input));
        }
    }
    #[test]
    fn body_bound_and_recognized_credential_are_withheld_before_wire() {
        assert_eq!(
            response([0; 16], Ok(vec![b'a'; BODY_LIMIT + 1])),
            Err(Failure::Limit)
        );
        assert_eq!(
            response([0; 16], Ok(b"-----BEGIN OPENSSH PRIVATE KEY-----".to_vec())),
            Err(Failure::Sensitive)
        );
        for error in [
            Failure::Failed,
            Failure::Sensitive,
            Failure::Limit,
            Failure::Stopped,
        ] {
            assert_eq!(response([0; 16], Err(error)), Err(error));
        }
    }
    #[tokio::test]
    async fn pending_parent_fetch_cannot_hold_stop() {
        let started = std::time::Instant::now();
        let result = fetch_response([0; 16], std::future::pending(), &|| async { true }).await;
        assert_eq!(result, Err(Failure::Stopped));
        assert!(started.elapsed() < Duration::from_secs(1));
    }
}
