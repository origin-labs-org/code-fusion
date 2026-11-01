//! What a recognizer error means for the person, from its domain and code.

/// How the recognizer's error reads. Closed; the system's text never travels.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum Failure {
    /// Siri and Dictation are switched off in System Settings.
    DictationOff,
    /// The recognizer heard no speech.
    NoSpeech,
    /// The task was cancelled by this app.
    Cancelled,
    /// The recognizer failed for another reason.
    Other,
}

impl Failure {
    pub(crate) fn of(domain: &str, code: i64) -> Self {
        match (domain, code) {
            ("kLSRErrorDomain", 201) => Self::DictationOff,
            ("kAFAssistantErrorDomain", 1110) => Self::NoSpeech,
            ("kAFAssistantErrorDomain", 216 | 301) | ("kLSRErrorDomain", 301) => Self::Cancelled,
            _ => Self::Other,
        }
    }

    #[cfg(target_os = "macos")]
    pub(crate) fn name(self) -> &'static str {
        match self {
            Self::DictationOff => "dictation_off",
            Self::NoSpeech => "no_speech",
            Self::Cancelled => "cancelled",
            Self::Other => "other",
        }
    }
}

/// A short tag for an error domain, so the log never carries system text.
pub(crate) fn domain_tag(domain: &str) -> &'static str {
    match domain {
        "kLSRErrorDomain" => "lsr",
        "kAFAssistantErrorDomain" => "assistant",
        "SFSpeechErrorDomain" => "speech",
        "NSCocoaErrorDomain" => "cocoa",
        "NSOSStatusErrorDomain" => "osstatus",
        _ => "other",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn switched_off_dictation_is_named_not_mistaken_for_silence() {
        assert_eq!(Failure::of("kLSRErrorDomain", 201), Failure::DictationOff);
        assert_eq!(
            Failure::of("kAFAssistantErrorDomain", 1110),
            Failure::NoSpeech
        );
    }

    #[test]
    fn our_own_cancel_is_not_a_failure() {
        assert_eq!(
            Failure::of("kAFAssistantErrorDomain", 216),
            Failure::Cancelled
        );
        assert_eq!(
            Failure::of("kAFAssistantErrorDomain", 301),
            Failure::Cancelled
        );
    }

    #[test]
    fn anything_else_is_a_recognizer_failure() {
        assert_eq!(Failure::of("kAFAssistantErrorDomain", 1101), Failure::Other);
        assert_eq!(Failure::of("kLSRErrorDomain", 102), Failure::Other);
        assert_eq!(Failure::of("whatever", 201), Failure::Other);
        assert_eq!(domain_tag("whatever"), "other");
    }
}
