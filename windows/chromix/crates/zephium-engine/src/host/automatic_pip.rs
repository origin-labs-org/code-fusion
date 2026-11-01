//! Automatic video PiP is initiated only by the browser's tab-selection port.
use super::EngineHost;
use std::rc::Rc;
use zephium_core::ids::ItemId;

const SCRIPT: &str = include_str!("../platform/automatic_pip.js");

impl EngineHost {
    pub(crate) fn automatic_pip(&self, id: ItemId, background: bool) {
        let Some(view) = self.views.get(&id) else {
            return;
        };
        let sequence = view
            .automatic_pip_sequence
            .get()
            .checked_add(1)
            .filter(|sequence| *sequence <= 9_007_199_254_740_991);
        let Some(sequence) = sequence else {
            return;
        };
        view.automatic_pip_sequence.set(sequence);
        let Some((epoch, url)) = view.navigation.committed_snapshot() else {
            return;
        };
        if background
            && (!view.presentable || !url.starts_with("https://") && !url.starts_with("http://"))
        {
            return;
        }
        let permit = view.event_permit.clone();
        let navigation = view.navigation.clone();
        let current_sequence = view.automatic_pip_sequence.clone();
        let current: Rc<dyn Fn() -> bool> = Rc::new(move || {
            permit.active_token().is_some()
                && navigation.current_committed() == Some(epoch)
                && current_sequence.get() == sequence
        });
        let action = if background { "leave" } else { "return" };
        let url = serde_json::to_string(&url).expect("a string is serializable");
        let script =
            format!("location.href === {url} ? ({SCRIPT})('{action}', {sequence}) : false");
        crate::platform::imp::automatic_pip(&view.view, script, current);
    }

    pub(crate) fn cancel_automatic_pip(&self) {
        for (&id, view) in &self.views {
            if view.automatic_pip_sequence.get() != 0 {
                self.automatic_pip(id, false);
            }
        }
    }
}
