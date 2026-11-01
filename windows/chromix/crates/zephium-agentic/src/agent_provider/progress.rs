//! Content fingerprints for rejecting redundant proposals, never authority.
use super::{AgentBrowserScopeProposal, AgentBrowserToolProposal};
use crate::{SemanticActionIntent, SemanticObservation, SemanticReferenceId};
use sha2::{Digest, Sha256};

fn text(hash: &mut Sha256, value: &str) {
    hash.update((value.len() as u64).to_be_bytes());
    hash.update(value.as_bytes());
}
fn target(
    hash: &mut Sha256,
    observation: &SemanticObservation,
    reference: SemanticReferenceId,
) -> Option<()> {
    for (frame, snapshot) in observation.frames().iter().enumerate() {
        if let Some(index) = snapshot
            .nodes()
            .iter()
            .position(|node| node.reference() == reference)
        {
            hash.update((frame as u64).to_be_bytes());
            hash.update((index as u64).to_be_bytes());
            return Some(());
        }
    }
    None
}
fn scope(
    hash: &mut Sha256,
    observation: &SemanticObservation,
    scope: &AgentBrowserScopeProposal,
) -> Option<()> {
    use AgentBrowserScopeProposal as S;
    match scope {
        S::Initial => hash.update([0]),
        S::Region(reference)
        | S::Subtree(reference)
        | S::Table(reference)
        | S::Frame(reference) => {
            hash.update([match scope {
                S::Region(_) => 1,
                S::Subtree(_) => 2,
                S::Table(_) => 3,
                _ => 4,
            }]);
            target(hash, observation, *reference)?;
        }
        S::SurroundingText {
            target: reference,
            window,
        } => {
            hash.update([5]);
            target(hash, observation, *reference)?;
            hash.update(window.before_bytes().to_be_bytes());
            hash.update(window.after_bytes().to_be_bytes());
        }
        S::TextSearch {
            target: reference,
            query,
        } => {
            hash.update([6]);
            target(hash, observation, *reference)?;
            text(hash, query.as_str());
        }
    }
    Some(())
}
impl AgentBrowserToolProposal {
    /// Page content and proposal identity without capture IDs or reusable
    /// capabilities. Callers may only use these digests to refuse work.
    pub fn progress_fingerprint(
        &self,
        observation: &SemanticObservation,
    ) -> Option<([u8; 32], [u8; 32])> {
        let mut intent = Sha256::new();
        intent.update(b"ZEPHIUM-PROPOSAL-PROGRESS-1\0");
        text(&mut intent, &format!("{:?}", self.kind()));
        match self {
            Self::Snapshot(value) => scope(&mut intent, observation, value)?,
            Self::Locate {
                query,
                scope: value,
            } => {
                text(&mut intent, query.as_str());
                scope(&mut intent, observation, value)?;
            }
            Self::Act(actions) => {
                for action in actions.actions() {
                    text(&mut intent, &format!("{:?}", action.intent().kind()));
                    target(&mut intent, observation, action.intent().target())?;
                    match action.intent() {
                        SemanticActionIntent::Click { .. } => {}
                        SemanticActionIntent::Fill { value, .. } => {
                            text(&mut intent, value.as_str())
                        }
                        SemanticActionIntent::Select { option, .. } => {
                            target(&mut intent, observation, *option)?
                        }
                        SemanticActionIntent::Press { key, .. } => {
                            text(&mut intent, &format!("{key:?}"))
                        }
                        SemanticActionIntent::Scroll {
                            direction, amount, ..
                        } => text(&mut intent, &format!("{direction:?}:{amount:?}")),
                    }
                }
            }
            Self::FillForm(form) => {
                for field in form.fields() {
                    target(&mut intent, observation, field.target())?;
                    text(&mut intent, field.value().as_str());
                }
                if let Some(submit) = form.submit() {
                    target(&mut intent, observation, submit)?;
                }
            }
            // Waiting, new visual evidence, extraction and human handoffs remain
            // available when another operation made no observable progress.
            _ => return None,
        }
        let mut page = Sha256::new();
        page.update(b"ZEPHIUM-PAGE-PROGRESS-1\0");
        for snapshot in observation.frames() {
            crate::semantic_action::hash_frame(&mut page, snapshot.frame());
            page.update(crate::semantic_action::page_digest(snapshot));
            for node in snapshot.nodes() {
                if let Some(image) = node.image_source() {
                    text(&mut page, image.as_url().as_str());
                }
                match node.geometry() {
                    Some(rect) => {
                        page.update([1]);
                        page.update(rect.x().to_be_bytes());
                        page.update(rect.y().to_be_bytes());
                        page.update(rect.width().to_be_bytes());
                        page.update(rect.height().to_be_bytes());
                    }
                    None => page.update([0]),
                }
            }
        }
        Some((page.finalize().into(), intent.finalize().into()))
    }
}

impl crate::SemanticActionProposal {
    /// Content-only refusal key shared by native decisions and the page planner.
    /// This digest never carries action or observation authority.
    pub fn progress_fingerprint(
        &self,
        observation: &SemanticObservation,
    ) -> Option<([u8; 32], [u8; 32])> {
        let actions = super::tool::AgentBrowserActProposal::try_new(vec![self.clone()]).ok()?;
        AgentBrowserToolProposal::Act(actions).progress_fingerprint(observation)
    }
}
