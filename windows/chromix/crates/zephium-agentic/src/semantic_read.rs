//! Bounded readable semantic content with exact source provenance.
//!
//! Read results are derived only from the already validated semantic snapshot
//! vocabulary. They cannot carry DOM, selectors, HTML, scripts, attributes,
//! native handles, or arbitrary page objects. Content remains borrowed from
//! one bounded observation, and diagnostics expose counts rather than values.

use std::fmt;
use std::num::NonZeroU16;

use sha2::{Digest, Sha256};
use thiserror::Error;

use crate::semantic_diff::SemanticObservationFingerprint;
use crate::{
    ContextJoin, SemanticCompleteness, SemanticFrameJoin, SemanticInvocationId, SemanticNode,
    SemanticObservation, SemanticObservationAcknowledgement, SemanticObservationGeneration,
    SemanticObservationId, SemanticOrigin, SemanticReferenceId, SemanticRole, SemanticSensitivity,
    SemanticSnapshotGeneration, SemanticText, SemanticTrust, SemanticValuePreview,
    SemanticValueSummary,
};

mod retained;
pub use retained::SemanticRetainedReadEvidence;

/// Process-wide maximum readable fields retained in one result.
pub const MAX_SEMANTIC_READ_ITEMS: u16 = 768;
/// Process-wide maximum page-derived UTF-8 bytes retained by one read result.
pub const MAX_SEMANTIC_READ_BYTES: u32 = 128 * 1024;

/// Trusted selection of source roles, separate from sensitivity and scope.
/// It only removes readable fields from an already-authorized observation.
/// Page/model strings cannot construct it, and it grants no native authority.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct SemanticReadRoleSelection(u32);

impl SemanticReadRoleSelection {
    /// The unchanged default: project every policy-admitted source role.
    pub const ALL: Self = Self((1 << 30) - 1);

    /// Constructs a nonempty closed set; duplicate roles are rejected.
    pub fn try_new(roles: &[SemanticRole]) -> Result<Self, SemanticReadRoleSelectionError> {
        if roles.is_empty() || roles.len() > 30 {
            return Err(SemanticReadRoleSelectionError);
        }
        let mut bits = 0_u32;
        for role in roles {
            let bit = 1 << (role_code(*role) - 1);
            if bits & bit != 0 {
                return Err(SemanticReadRoleSelectionError);
            }
            bits |= bit;
        }
        Ok(Self(bits))
    }

    /// Whether this source role may contribute readable fields.
    pub const fn contains(self, role: SemanticRole) -> bool {
        self.0 & (1 << (role_code(role) - 1)) != 0
    }

    /// Stable closed-role mask for internal receipt fingerprints.
    pub(crate) const fn bits(self) -> u32 {
        self.0
    }

    /// Deterministic role order used by the bounded model projection.
    pub(crate) fn roles(self) -> impl Iterator<Item = SemanticRole> {
        [
            SemanticRole::Group,
            SemanticRole::Document,
            SemanticRole::Landmark,
            SemanticRole::Heading,
            SemanticRole::Paragraph,
            SemanticRole::Link,
            SemanticRole::Button,
            SemanticRole::Textbox,
            SemanticRole::Password,
            SemanticRole::Searchbox,
            SemanticRole::Checkbox,
            SemanticRole::Radio,
            SemanticRole::Combobox,
            SemanticRole::Listbox,
            SemanticRole::Option,
            SemanticRole::Spinbutton,
            SemanticRole::Slider,
            SemanticRole::Tab,
            SemanticRole::MenuItem,
            SemanticRole::Dialog,
            SemanticRole::List,
            SemanticRole::ListItem,
            SemanticRole::Table,
            SemanticRole::Row,
            SemanticRole::CellHeader,
            SemanticRole::Cell,
            SemanticRole::Image,
            SemanticRole::Progress,
            SemanticRole::Status,
            SemanticRole::FrameBoundary,
        ]
        .into_iter()
        .filter(move |role| self.contains(*role))
    }
}

impl Default for SemanticReadRoleSelection {
    fn default() -> Self {
        Self::ALL
    }
}

/// A source-role set was empty, duplicated or larger than the closed vocabulary.
#[derive(Clone, Copy, Debug, Eq, Error, PartialEq)]
#[error("semantic source-role selection is invalid")]
pub struct SemanticReadRoleSelectionError;

/// Process-local monotonic capture time supplied by the trusted shell.
#[derive(Clone, Copy, Eq, Ord, PartialEq, PartialOrd)]
pub struct SemanticCaptureInstant(u64);

impl SemanticCaptureInstant {
    /// Wraps a monotonic millisecond tick from one process-local clock domain.
    pub const fn from_millis(value: u64) -> Self {
        Self(value)
    }

    /// Returns the raw process-local tick only to freshness/metrics owners.
    pub const fn millis(self) -> u64 {
        self.0
    }
}

impl fmt::Debug for SemanticCaptureInstant {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("SemanticCaptureInstant([redacted])")
    }
}

/// Hard caller-selected ceilings for one readable result.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct SemanticReadBudget {
    max_items: u16,
    max_bytes: u32,
}

impl SemanticReadBudget {
    /// Conservative default for a model-facing read operation.
    pub const STANDARD: Self = Self {
        max_items: 128,
        max_bytes: 32 * 1024,
    };

    /// A terminal mapping read: a listing page's visible records with their
    /// links and pictures, after control labels are shed.
    pub const EXTRACTION: Self = Self {
        max_items: 256,
        max_bytes: 48 * 1024,
    };

    /// A terminal mapping read of a multi-record listing: one marketplace card
    /// carries dozens of fragments (title, picture, link, rating, spec pairs,
    /// price), so a page of offers needs several times a single record's room.
    pub const LISTING: Self = Self {
        max_items: MAX_SEMANTIC_READ_ITEMS,
        max_bytes: MAX_SEMANTIC_READ_BYTES,
    };

    /// Validates nonzero ceilings under process-wide hard limits.
    pub const fn try_new(max_items: u16, max_bytes: u32) -> Result<Self, SemanticReadBudgetError> {
        if max_items == 0
            || max_items > MAX_SEMANTIC_READ_ITEMS
            || max_bytes == 0
            || max_bytes > MAX_SEMANTIC_READ_BYTES
        {
            Err(SemanticReadBudgetError::Invalid)
        } else {
            Ok(Self {
                max_items,
                max_bytes,
            })
        }
    }

    /// Maximum retained readable fields.
    pub const fn max_items(self) -> u16 {
        self.max_items
    }

    /// Maximum aggregate page-derived content bytes.
    pub const fn max_bytes(self) -> u32 {
        self.max_bytes
    }
}

/// Refusal to construct an invalid read budget.
#[derive(Clone, Copy, Debug, Eq, Error, PartialEq)]
pub enum SemanticReadBudgetError {
    /// A ceiling was zero or exceeded its process-wide maximum.
    #[error("semantic read budget is invalid")]
    Invalid,
}

/// Maximum sensitivity a trusted policy decision allows this read to expose.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SemanticReadSensitivityLimit {
    /// Expose ordinary hostile page content only.
    PublicOnly,
    /// Expose public and policy-admitted sensitive content; never secrets.
    Sensitive,
}

/// Exact model-visible authority for the requested semantic read scope.
///
/// An initial observation needs no prior reference. Every progressive scope is
/// anchored to one exact prior observation and therefore requires its committed
/// model-delivery acknowledgement.
pub enum SemanticReadAuthority<'a> {
    /// First filtered observation for the current context.
    Initial,
    /// Read the exact current observation already delivered to the model,
    /// including a previously admitted scoped observation. This neither widens
    /// that scope nor authorizes a fresh capture.
    Acknowledged(&'a SemanticObservationAcknowledgement),
    /// Progressive observation anchored in an exact acknowledged predecessor.
    AcknowledgedExpansion {
        /// Exact predecessor that supplied the scope anchor.
        previous: &'a SemanticObservation,
        /// Proof that the predecessor reached committed model delivery.
        acknowledgement: &'a SemanticObservationAcknowledgement,
    },
}

impl fmt::Debug for SemanticReadAuthority<'_> {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Initial => formatter.write_str("Initial"),
            Self::Acknowledged(_) => formatter.write_str("Acknowledged([redacted])"),
            Self::AcknowledgedExpansion { previous, .. } => formatter
                .debug_struct("AcknowledgedExpansion")
                .field("previous", previous.request())
                .field("acknowledgement", &"[redacted]")
                .finish(),
        }
    }
}

/// Closed reason why a read truthfully omitted one or more values.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SemanticReadOmission {
    /// A source snapshot was truncated or a child frame was not observed.
    SourceIncomplete,
    /// Trusted policy did not admit sensitive page content.
    SensitivityLimit,
    /// Secret/redacted content was mechanically withheld.
    Secret,
    /// Retained-field ceiling was reached.
    ItemLimit,
    /// Retained page-content byte ceiling was reached.
    ByteLimit,
    /// An exact safe value was represented by its bounded model-facing prefix.
    ValuePreviewLimit,
    /// Trusted source-role selection excluded otherwise readable fields.
    RoleSelection,
    /// A decision-bound neighborhood excluded other observed nodes.
    ReferenceSelection,
}

impl SemanticReadOmission {
    const fn bit(self) -> u8 {
        1 << (self as u8)
    }
}

/// Compact complete set of truthful read omissions.
#[derive(Clone, Copy, Eq, PartialEq)]
pub struct SemanticReadOmissions(u8);

impl SemanticReadOmissions {
    /// No known omission.
    pub const NONE: Self = Self(0);

    /// Whether this set contains one omission class.
    pub const fn contains(self, omission: SemanticReadOmission) -> bool {
        self.0 & omission.bit() != 0
    }

    /// Whether the read retained every available policy-admitted value.
    pub const fn is_empty(self) -> bool {
        self.0 == 0
    }

    fn insert(&mut self, omission: SemanticReadOmission) {
        self.0 |= omission.bit();
    }

    pub(crate) const fn bits(self) -> u8 {
        self.0
    }
}

impl fmt::Debug for SemanticReadOmissions {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("SemanticReadOmissions")
            .field("count", &self.0.count_ones())
            .finish()
    }
}

/// Closed semantic field represented by one readable value.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SemanticReadField {
    /// Bounded accessible name.
    AccessibleName,
    /// Bounded visible text.
    VisibleText,
    /// Safe bounded text value.
    TextValue,
    /// Boolean form/control value.
    BooleanValue,
    /// Bounded ordinal form/control value.
    OrdinalValue,
    /// Exact native-observed public link destination.
    LinkDestination,
    /// Exact native-observed public image source.
    ImageSource,
    /// The read's own document address as the one-document gate admitted it,
    /// attributed to the main frame's document node; never text from the page.
    DocumentAddress,
    /// The viewport screenshot the host attached to this mapping, attributed
    /// to the main frame's document node. Only a text value may cite it, and
    /// a value that does was read by the model from pixels, never from text.
    ViewportImage,
}

/// What a viewport-image fragment says in place of page text.
pub const SEMANTIC_VIEWPORT_IMAGE_TEXT: &str = "the viewport screenshot attached to this request; cite this ref for a value read only from its pixels";

/// Non-actionable model-facing identity for one read fragment.
#[derive(Clone, Copy, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub struct SemanticReadFragmentId(NonZeroU16);

impl SemanticReadFragmentId {
    /// Returns the canonical provenance token, such as `@r3`.
    pub fn model_token(self) -> String {
        format!("@r{}", self.0.get())
    }

    /// Parses only the canonical provenance spelling without leading zeros.
    pub fn parse_model_token(value: &str) -> Option<Self> {
        let digits = value.strip_prefix("@r")?;
        if digits.is_empty()
            || (digits.len() > 1 && digits.starts_with('0'))
            || !digits.bytes().all(|byte| byte.is_ascii_digit())
        {
            return None;
        }
        let value = digits.parse::<u16>().ok()?;
        Self::new(value)
    }

    /// One-based result-local ordinal for trusted validation.
    pub const fn get(self) -> u16 {
        self.0.get()
    }

    fn new(value: u16) -> Option<Self> {
        NonZeroU16::new(value).map(Self)
    }
}

impl fmt::Debug for SemanticReadFragmentId {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("SemanticReadFragmentId([redacted])")
    }
}

/// Borrowed readable primitive from the safe semantic projection.
#[derive(Clone, Copy, Eq, PartialEq)]
pub enum SemanticReadContent<'a> {
    /// Bounded text retained by Rust-side secret scanning.
    Text(&'a SemanticText),
    /// Bounded truncation-aware form value projection after secret scanning.
    ValuePreview(SemanticValuePreview<'a>),
    /// Primitive Boolean value.
    Boolean(bool),
    /// Bounded primitive ordinal.
    Ordinal(u16),
}

impl<'a> SemanticReadContent<'a> {
    /// Text content, when this is a semantic string.
    pub const fn text(self) -> Option<&'a SemanticText> {
        match self {
            Self::Text(text) => Some(text),
            Self::ValuePreview(_) | Self::Boolean(_) | Self::Ordinal(_) => None,
        }
    }

    /// Model-safe form-value preview, when present.
    pub const fn value_preview(self) -> Option<SemanticValuePreview<'a>> {
        match self {
            Self::ValuePreview(preview) => Some(preview),
            Self::Text(_) | Self::Boolean(_) | Self::Ordinal(_) => None,
        }
    }

    /// Boolean content, when present.
    pub const fn boolean(self) -> Option<bool> {
        match self {
            Self::Boolean(value) => Some(value),
            Self::Text(_) | Self::ValuePreview(_) | Self::Ordinal(_) => None,
        }
    }

    /// Ordinal content, when present.
    pub const fn ordinal(self) -> Option<u16> {
        match self {
            Self::Ordinal(value) => Some(value),
            Self::Text(_) | Self::ValuePreview(_) | Self::Boolean(_) => None,
        }
    }

    fn retained_bytes(self) -> u32 {
        match self {
            Self::Text(text) => u32::try_from(text.len()).unwrap_or(u32::MAX),
            Self::ValuePreview(preview) => u32::try_from(preview.len()).unwrap_or(u32::MAX),
            // Fixed conservative textual rendering ceiling: `false` or `65535`.
            Self::Boolean(_) | Self::Ordinal(_) => 5,
        }
    }
}

impl fmt::Debug for SemanticReadContent<'_> {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Text(text) => formatter
                .debug_struct("Text")
                .field("bytes", &text.len())
                .field("content", &"[redacted]")
                .finish(),
            Self::ValuePreview(preview) => formatter
                .debug_tuple("ValuePreview")
                .field(preview)
                .finish(),
            Self::Boolean(_) => formatter.write_str("Boolean([redacted])"),
            Self::Ordinal(_) => formatter.write_str("Ordinal([redacted])"),
        }
    }
}

/// Exact source coordinates attached to every readable primitive.
#[derive(Clone, Copy, Eq, PartialEq)]
pub struct SemanticReadProvenance<'a> {
    fields_complete: bool,
    node_key: crate::semantic::SemanticNodeKey,
    observation: SemanticObservationId,
    observation_generation: SemanticObservationGeneration,
    frame: &'a SemanticFrameJoin,
    invocation: SemanticInvocationId,
    snapshot: SemanticSnapshotGeneration,
    reference: SemanticReferenceId,
    sensitivity: SemanticSensitivity,
    trust: SemanticTrust,
    captured_at: SemanticCaptureInstant,
}

impl<'a> SemanticReadProvenance<'a> {
    /// Whether native evidence proves the source node's fields were not clipped.
    pub const fn fields_complete(self) -> bool {
        self.fields_complete
    }
    /// Exact observation request identity.
    pub const fn observation(self) -> SemanticObservationId {
        self.observation
    }

    /// Progressive observation generation.
    pub const fn observation_generation(self) -> SemanticObservationGeneration {
        self.observation_generation
    }

    /// Exact context/document/frame/origin authority.
    pub const fn frame(self) -> &'a SemanticFrameJoin {
        self.frame
    }

    /// Exact context/run/profile authority.
    pub const fn context(self) -> ContextJoin {
        self.frame.context()
    }

    /// Canonical native-attested source origin.
    pub const fn origin(self) -> &'a SemanticOrigin {
        self.frame.origin()
    }

    /// Native semantic-runtime invocation.
    pub const fn invocation(self) -> SemanticInvocationId {
        self.invocation
    }

    /// Exact frame snapshot generation.
    pub const fn snapshot(self) -> SemanticSnapshotGeneration {
        self.snapshot
    }

    /// Native node identity, stable across looks at the same document.
    #[cfg(feature = "provider-transport")]
    pub(crate) const fn node_key(self) -> crate::semantic::SemanticNodeKey {
        self.node_key
    }

    /// Opaque observation-local source reference.
    pub const fn reference(self) -> SemanticReferenceId {
        self.reference
    }

    /// Rust-side sensitivity after secret upgrades/redaction.
    pub const fn sensitivity(self) -> SemanticSensitivity {
        self.sensitivity
    }

    /// Page- or browser-derived source class.
    pub const fn trust(self) -> SemanticTrust {
        self.trust
    }

    /// Trusted-shell monotonic capture time.
    pub const fn captured_at(self) -> SemanticCaptureInstant {
        self.captured_at
    }
}

impl fmt::Debug for SemanticReadProvenance<'_> {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("SemanticReadProvenance")
            .field("observation", &self.observation)
            .field("observation_generation", &self.observation_generation)
            .field("frame", &self.frame)
            .field("invocation", &self.invocation)
            .field("snapshot", &self.snapshot)
            .field("reference", &self.reference)
            .field("sensitivity", &self.sensitivity)
            .field("trust", &self.trust)
            .field("captured_at", &self.captured_at)
            .finish()
    }
}

/// One bounded readable primitive and its exact source coordinates.
#[derive(Clone, Copy, Eq, PartialEq)]
pub struct SemanticReadFragment<'a> {
    id: SemanticReadFragmentId,
    field: SemanticReadField,
    role: SemanticRole,
    content: SemanticReadContent<'a>,
    states: crate::SemanticStates,
    provenance: SemanticReadProvenance<'a>,
    /// Where on the page it sits, for shedding: 0 the main content, 1 beside
    /// it, 2 the page's chrome (header, navigation, footer, search).
    region: u8,
    /// How useful it is within its region, for shedding: lower is kept.
    rank: u8,
    record_root: Option<crate::semantic::SemanticNodeKey>,
}

impl<'a> SemanticReadFragment<'a> {
    /// Non-actionable result-local provenance identity.
    pub const fn id(self) -> SemanticReadFragmentId {
        self.id
    }

    pub(crate) const fn record_root(self) -> Option<crate::semantic::SemanticNodeKey> {
        self.record_root
    }

    /// Semantic field class.
    pub const fn field(self) -> SemanticReadField {
        self.field
    }

    /// Closed source-node role.
    pub const fn role(self) -> SemanticRole {
        self.role
    }

    /// Observed source-control states, never inferred from an option's label.
    pub const fn states(self) -> crate::SemanticStates {
        self.states
    }

    /// Borrowed safe primitive.
    pub const fn content(self) -> SemanticReadContent<'a> {
        self.content
    }

    /// Complete displayed text or form value eligible for exact copying.
    pub fn verbatim_text(self) -> Option<&'a str> {
        if !self.provenance.fields_complete() {
            return None;
        }
        match (self.field, self.content) {
            (
                SemanticReadField::VisibleText | SemanticReadField::AccessibleName,
                SemanticReadContent::Text(text),
            ) => Some(text.as_str()),
            (SemanticReadField::TextValue, SemanticReadContent::ValuePreview(preview))
                if !preview.truncated() =>
            {
                Some(preview.text())
            }
            _ => None,
        }
    }

    /// Exact source provenance.
    pub const fn provenance(self) -> SemanticReadProvenance<'a> {
        self.provenance
    }

    /// Where on the page it sits: 0 the main content, 1 beside it, 2 the
    /// page's chrome (header, navigation, footer, search).
    pub const fn region(self) -> u8 {
        self.region
    }
}

impl fmt::Debug for SemanticReadFragment<'_> {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("SemanticReadFragment")
            .field("id", &self.id)
            .field("field", &self.field)
            .field("role", &self.role)
            .field("content", &self.content)
            .field("provenance", &self.provenance)
            .finish()
    }
}

/// Content-free aggregate counts for one read result.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct SemanticReadStats {
    items: u16,
    content_bytes: u32,
    public_items: u16,
    sensitive_items: u16,
    omitted_items: u16,
    withheld_sensitive_nodes: u16,
    secret_nodes: u16,
    redacted_values: u16,
    incomplete_frames: u8,
}

impl SemanticReadStats {
    /// Retained readable primitive count.
    pub const fn items(self) -> u16 {
        self.items
    }

    /// Aggregate retained page-derived content bytes.
    pub const fn content_bytes(self) -> u32 {
        self.content_bytes
    }

    /// Retained public primitive count.
    pub const fn public_items(self) -> u16 {
        self.public_items
    }

    /// Retained policy-admitted sensitive primitive count.
    pub const fn sensitive_items(self) -> u16 {
        self.sensitive_items
    }

    /// Available values omitted by sensitivity, secrecy, roles or resource bounds.
    pub const fn omitted_items(self) -> u16 {
        self.omitted_items
    }

    /// Sensitive nodes withheld by the policy-selected limit.
    pub const fn withheld_sensitive_nodes(self) -> u16 {
        self.withheld_sensitive_nodes
    }

    /// Secret nodes mechanically withheld.
    pub const fn secret_nodes(self) -> u16 {
        self.secret_nodes
    }

    /// Explicit redacted value markers withheld from content.
    pub const fn redacted_values(self) -> u16 {
        self.redacted_values
    }

    /// Source frames truncated or containing unobserved child boundaries.
    /// Multiple omitted children count their parent once.
    pub const fn incomplete_frames(self) -> u8 {
        self.incomplete_frames
    }
}

#[derive(Clone)]
struct ReadMediaAssociation {
    invocation: SemanticInvocationId,
    key: u64,
    observation: SemanticObservationId,
    generation: SemanticObservationGeneration,
    frame: std::sync::Arc<SemanticFrameJoin>,
    snapshot: SemanticSnapshotGeneration,
    media: crate::SemanticMediaEvidence,
    area: u64,
}
impl ReadMediaAssociation {
    fn same_capture(&self, source: SemanticReadProvenance<'_>) -> bool {
        self.observation == source.observation()
            && self.generation == source.observation_generation()
            && self.frame.as_ref() == source.frame()
            && self.snapshot == source.snapshot()
    }
}

/// Bounded borrowed readable projection of one exact semantic observation.
pub struct SemanticReadResult<'a> {
    observed_images: usize,
    eligible_image_geometry: usize,
    media: Vec<ReadMediaAssociation>,
    page_title: Option<String>,
    focused: bool,
    url_sources: u8,
    roles: SemanticReadRoleSelection,
    observation: SemanticObservationId,
    observation_generation: SemanticObservationGeneration,
    context: ContextJoin,
    observation_fingerprint: SemanticObservationFingerprint,
    subtree: Option<SemanticReadSubtreeProof>,
    selected_target: Option<SemanticReferenceId>,
    captured_at: SemanticCaptureInstant,
    fragments: Vec<SemanticReadFragment<'a>>,
    omissions: SemanticReadOmissions,
    stats: SemanticReadStats,
    budget: SemanticReadBudget,
    guard: [u8; 32],
    // Historical read-only sources, never observation/action acknowledgements
    // for the active document. Only the bounded evidence owner constructs this.
    historical: Vec<SemanticObservationAcknowledgement>,
}

// Evidence for one terminal scoped mapping, not an acknowledgement that the
// expanded observation itself reached the model. Only validated read admission
// can retain it; a read receipt must never mint fresh action/ref authority.
struct SemanticReadSubtreeProof {
    predecessor: SemanticObservationAcknowledgement,
    target: SemanticReferenceId,
}

impl<'a> SemanticReadResult<'a> {
    /// Public top-frame title metadata from this exact observed document.
    pub fn page_title(&self) -> Option<&str> {
        self.page_title.as_deref()
    }
    pub(crate) const fn url_sources(&self) -> u8 {
        self.url_sources
    }
    pub(crate) const fn includes_link_destinations(&self) -> bool {
        self.url_sources & 1 != 0
    }
    pub(crate) const fn includes_image_sources(&self) -> bool {
        self.url_sources & 2 != 0
    }

    pub(crate) fn media_diagnostics(&self) -> crate::SemanticRecordMediaDiagnostics {
        crate::SemanticRecordMediaDiagnostics {
            observed_images: self.observed_images,
            eligible_image_geometry: self.eligible_image_geometry,
            structural_candidates: self.media.len(),
            saturated_candidates: self
                .media
                .iter()
                .filter(|candidate| {
                    candidate.media.related().len() == crate::MAX_SEMANTIC_MEDIA_RELATIONS
                })
                .count(),
            ..Default::default()
        }
    }
    #[cfg(feature = "probe-harness")]
    pub(crate) fn media_probe_source(
        &self,
        record: u16,
        id: SemanticReadFragmentId,
    ) -> Option<crate::SemanticMediaNameProbe> {
        let provenance = self.fragment(id)?.provenance();
        if provenance.sensitivity() != SemanticSensitivity::Public {
            return None;
        }
        Some(crate::SemanticMediaNameProbe {
            record,
            frame: provenance.frame().clone(),
            invocation: provenance.invocation().get(),
            snapshot: provenance.snapshot().get(),
            node: provenance.node_key.get(),
        })
    }

    pub(crate) fn record_identity_sources(
        &self,
        original: &[SemanticReadFragmentId],
    ) -> Vec<SemanticReadFragmentId> {
        let mut identities = original.to_vec();
        for candidate in self.fragments() {
            if candidate.role() == SemanticRole::Image
                || !matches!(
                    candidate.field(),
                    SemanticReadField::AccessibleName
                        | SemanticReadField::VisibleText
                        | SemanticReadField::LinkDestination
                )
            {
                continue;
            }
            let Some(root) = candidate.record_root() else {
                continue;
            };
            let same_card = original
                .iter()
                .filter_map(|id| self.fragment(*id))
                .any(|source| {
                    source.record_root() == Some(root)
                        && source.provenance().frame() == candidate.provenance().frame()
                        && source.provenance().observation() == candidate.provenance().observation()
                        && source.provenance().snapshot() == candidate.provenance().snapshot()
                });
            if same_card && !identities.contains(&candidate.id()) {
                identities.push(candidate.id());
            }
        }
        identities
    }

    pub(crate) fn count_media_relations(
        &self,
        identity: &[SemanticReadFragmentId],
        counts: &mut crate::SemanticRecordMediaDiagnostics,
    ) {
        counts.records += 1;
        counts.identity_sources += identity.len();
        for source in identity.iter().filter_map(|id| self.fragment(*id)) {
            counts.identity_roles[match source.role() {
                SemanticRole::Heading => 0,
                SemanticRole::Link => 1,
                SemanticRole::Paragraph => 2,
                SemanticRole::Document => 3,
                SemanticRole::ListItem => 4,
                SemanticRole::Image => 5,
                _ => 6,
            }] += 1;
            counts.identity_fields[match source.field() {
                SemanticReadField::AccessibleName => 0,
                SemanticReadField::VisibleText => 1,
                SemanticReadField::ImageSource => 2,
                _ => 3,
            }] += 1;
        }
        for association in &self.media {
            for source in identity.iter().filter_map(|id| self.fragment(*id)) {
                if association.same_capture(source.provenance()) {
                    counts.same_capture_pairs += 1;
                    counts.self_image_pairs += usize::from(
                        source.role() == SemanticRole::Image
                            && association.media.reference() == source.provenance().reference(),
                    );
                    if association
                        .media
                        .related()
                        .contains(&source.provenance().reference())
                    {
                        counts.related_pairs += 1;
                    }
                }
            }
        }
    }

    pub(crate) fn media_for_record(
        &self,
        record: u16,
        identity: &[SemanticReadFragmentId],
        guard: [u8; 32],
    ) -> Option<crate::SemanticRecordMediaPlan> {
        let (association, name) = self
            .media
            .iter()
            .filter(|association| association.frame.frame() == crate::FrameId::MAIN)
            .filter_map(|association| {
                identity
                    .iter()
                    .filter_map(|id| self.fragment(*id))
                    .find(|source| {
                        association.same_capture(source.provenance())
                            && association
                                .media
                                .related()
                                .contains(&source.provenance().reference())
                    })
                    .map(|source| (association, source))
            })
            .max_by_key(|(association, _)| {
                let priority =
                    if association.media.kind() == crate::SemanticMediaKind::RecordContainer {
                        1
                    } else if association.media.loaded() {
                        2
                    } else {
                        0
                    };
                (priority, association.area)
            })?;
        let mut hash = Sha256::new();
        hash.update(b"zephium-record-media-v1");
        hash.update(guard);
        hash.update(record.to_be_bytes());
        hash.update(association.invocation.get().to_be_bytes());
        hash.update(association.snapshot.get().to_be_bytes());
        hash.update(association.key.to_be_bytes());
        hash.update(name.provenance().node_key.get().to_be_bytes());
        Some(crate::SemanticRecordMediaPlan {
            outcome: Default::default(),
            fetch_stage: Default::default(),
            crop: None,
            record,
            source: hash.finalize().into(),
            frame: association.frame.as_ref().clone(),
            invocation: association.invocation,
            snapshot: association.snapshot,
            key: association.key,
            name_key: name.provenance().node_key.get(),
        })
    }

    /// Native card ownership of pictures, joined by exact source coordinates.
    /// Names, alt text, and model-proposed URLs never establish this relation.
    pub(crate) fn images_for_record(
        &self,
        identity: &[SemanticReadFragmentId],
    ) -> Vec<SemanticReadFragment<'a>> {
        let mut candidates: Vec<_> = self
            .media
            .iter()
            .filter(|association| {
                association.media.loaded()
                    && identity
                        .iter()
                        .filter_map(|id| self.fragment(*id))
                        .any(|source| {
                            association.same_capture(source.provenance())
                                && association
                                    .media
                                    .related()
                                    .contains(&source.provenance().reference())
                        })
            })
            .collect();
        candidates.sort_by_key(|candidate| std::cmp::Reverse(candidate.area));
        candidates
            .into_iter()
            .flat_map(|association| {
                self.fragments.iter().copied().filter(move |fragment| {
                    fragment.field() == SemanticReadField::ImageSource
                        && association.same_capture(fragment.provenance())
                        && fragment.provenance().reference() == association.media.reference()
                })
            })
            .collect()
    }

    /// The ceilings this read was projected under.
    pub const fn budget(&self) -> SemanticReadBudget {
        self.budget
    }

    /// Immutable trusted role selection for this read.
    pub const fn source_roles(&self) -> SemanticReadRoleSelection {
        self.roles
    }
    /// Exact observation request projected by this result.
    pub const fn observation(&self) -> SemanticObservationId {
        self.observation
    }

    /// Progressive observation generation projected by this result.
    pub const fn observation_generation(&self) -> SemanticObservationGeneration {
        self.observation_generation
    }

    /// Exact context/document/cancellation authority projected by this result.
    pub const fn context(&self) -> ContextJoin {
        self.context
    }

    /// Trusted-shell capture time shared by every fragment.
    pub const fn captured_at(&self) -> SemanticCaptureInstant {
        self.captured_at
    }

    /// Deterministic frame/node/name-text-value ordered readable primitives.
    pub fn fragments(&self) -> &[SemanticReadFragment<'a>] {
        &self.fragments
    }

    /// Resolves one result-local provenance identity.
    pub fn fragment(&self, id: SemanticReadFragmentId) -> Option<SemanticReadFragment<'a>> {
        let fragment = self.fragments.get(usize::from(id.get() - 1)).copied()?;
        (fragment.id() == id).then_some(fragment)
    }

    /// Complete omission set; empty means every available admitted value fit.
    pub const fn omissions(&self) -> SemanticReadOmissions {
        self.omissions
    }

    /// Content-free aggregate counts.
    pub const fn stats(&self) -> SemanticReadStats {
        self.stats
    }

    pub(crate) const fn guard(&self) -> [u8; 32] {
        self.guard
    }

    pub(crate) const fn observation_guard(&self) -> [u8; 32] {
        self.observation_fingerprint.digest()
    }

    pub(crate) fn matches_acknowledgement(
        &self,
        acknowledgement: &SemanticObservationAcknowledgement,
    ) -> bool {
        acknowledgement.observation() == self.observation
            && acknowledgement.generation() == self.observation_generation
            && acknowledgement.context() == self.context
            && acknowledgement.guard() == self.observation_fingerprint.digest()
    }

    pub(crate) fn source_acknowledgement(
        &self,
        provenance: SemanticReadProvenance<'_>,
    ) -> Option<&SemanticObservationAcknowledgement> {
        self.historical.iter().find(|ack| {
            ack.context() == provenance.context()
                && ack.observation() == provenance.observation()
                && ack.generation() == provenance.observation_generation()
        })
    }

    pub(crate) fn has_retained_evidence(&self) -> bool {
        !self.historical.is_empty()
    }

    pub(crate) fn selected_target(&self) -> Option<SemanticReferenceId> {
        self.selected_target
    }

    pub(crate) fn matches_subtree(
        &self,
        acknowledgement: &SemanticObservationAcknowledgement,
        target: SemanticReferenceId,
    ) -> bool {
        self.subtree
            .as_ref()
            .is_some_and(|proof| &proof.predecessor == acknowledgement && proof.target == target)
    }
}

impl fmt::Debug for SemanticReadResult<'_> {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("SemanticReadResult")
            .field("observation", &self.observation)
            .field("observation_generation", &self.observation_generation)
            .field("context", &self.context)
            .field("captured_at", &self.captured_at)
            .field("omissions", &self.omissions)
            .field("stats", &self.stats)
            .field("content", &"[redacted]")
            .finish()
    }
}

/// Refusal at the read provenance/authority boundary.
#[derive(Clone, Copy, Debug, Eq, Error, PartialEq)]
pub enum SemanticReadError {
    /// Initial authority was supplied for a progressive observation or vice versa.
    #[error("semantic read authority does not match the observation scope")]
    AuthorityMismatch,
    /// Progressive predecessor coordinates did not exactly match the scope anchor.
    #[error("semantic read expansion predecessor is invalid")]
    ExpansionMismatch,
    /// Progressive predecessor did not have committed model-delivery authority.
    #[error("semantic read expansion predecessor was not acknowledged")]
    BaselineNotAcknowledged,
}

/// Projects bounded readable values with provenance from one exact observation.
///
/// This function performs no browser work, policy decision, model transport, or
/// persistence. `sensitivity` must come from trusted policy; choosing the enum
/// value itself grants no authority. Secret values are never returned.
pub fn read_semantic_observation<'a>(
    observation: &'a SemanticObservation,
    authority: SemanticReadAuthority<'_>,
    captured_at: SemanticCaptureInstant,
    sensitivity: SemanticReadSensitivityLimit,
    budget: SemanticReadBudget,
) -> Result<SemanticReadResult<'a>, SemanticReadError> {
    read_selected_semantic_observation(
        observation,
        authority,
        captured_at,
        sensitivity,
        budget,
        SemanticReadRoleSelection::ALL,
    )
}

/// Projects only selected roles from the same bounded authorized observation.
/// Scope, sensitivity, native capture and observation authority are unchanged.
/// Excluded fields are explicitly counted and the selection is receipt-bound.
pub fn read_selected_semantic_observation<'a>(
    observation: &'a SemanticObservation,
    authority: SemanticReadAuthority<'_>,
    captured_at: SemanticCaptureInstant,
    sensitivity: SemanticReadSensitivityLimit,
    budget: SemanticReadBudget,
    roles: SemanticReadRoleSelection,
) -> Result<SemanticReadResult<'a>, SemanticReadError> {
    read_projection(
        observation,
        authority,
        captured_at,
        sensitivity,
        budget,
        roles,
        0,
        None,
        None,
        false,
    )
}

/// Reads one already-observed element and its same-frame descendants, including
/// captured link/image attributes. No DOM capture, model call or new authority
/// is performed; the target and selected result are bound into the read receipt.
pub fn read_semantic_target<'a>(
    observation: &'a SemanticObservation,
    acknowledgement: &SemanticObservationAcknowledgement,
    target: SemanticReferenceId,
    captured_at: SemanticCaptureInstant,
    sensitivity: SemanticReadSensitivityLimit,
    budget: SemanticReadBudget,
) -> Result<SemanticReadResult<'a>, SemanticReadError> {
    let (snapshot, root) = observation
        .frames()
        .iter()
        .find_map(|frame| {
            frame
                .nodes()
                .iter()
                .position(|node| node.reference() == target)
                .map(|root| (frame, root))
        })
        .ok_or(SemanticReadError::AuthorityMismatch)?;
    let mut indices = std::collections::BTreeSet::from([root]);
    let mut references = std::collections::BTreeSet::from([target]);
    for (index, node) in snapshot.nodes().iter().enumerate().skip(root + 1) {
        if node
            .parent()
            .is_some_and(|parent| indices.contains(&usize::from(parent)))
        {
            indices.insert(index);
            references.insert(node.reference());
        }
    }
    let mut read = read_projection(
        observation,
        SemanticReadAuthority::Acknowledged(acknowledgement),
        captured_at,
        sensitivity,
        budget,
        SemanticReadRoleSelection::ALL,
        3,
        Some(&references),
        None,
        false,
    )?;
    read.selected_target = Some(target);
    let mut guard = Sha256::new();
    guard.update(b"ZEPHIUM-SEMANTIC-TARGET-READ-1\0");
    guard.update(read.guard);
    guard.update(target.get().to_be_bytes());
    read.guard = guard.finalize().into();
    Ok(read)
}

/// Uses the trusted schema to include URL evidence only when needed.
pub fn read_semantic_observation_for_schema<'a>(
    observation: &'a SemanticObservation,
    authority: SemanticReadAuthority<'_>,
    captured_at: SemanticCaptureInstant,
    sensitivity: SemanticReadSensitivityLimit,
    budget: SemanticReadBudget,
    schema: &crate::SemanticExtractionSchema,
) -> Result<SemanticReadResult<'a>, SemanticReadError> {
    read_projection(
        observation,
        authority,
        captured_at,
        sensitivity,
        budget,
        schema.source_roles(),
        schema.url_sources(),
        None,
        None,
        schema.is_whole_page_findings(),
    )
}

#[cfg(feature = "provider-transport")]
pub(crate) fn read_located_semantic_observation<'a>(
    observation: &'a SemanticObservation,
    acknowledgement: &SemanticObservationAcknowledgement,
    captured_at: SemanticCaptureInstant,
    schema: &crate::SemanticExtractionSchema,
    references: &std::collections::BTreeSet<SemanticReferenceId>,
) -> Result<SemanticReadResult<'a>, SemanticReadError> {
    read_located_semantic_observation_at(
        observation,
        acknowledgement,
        captured_at,
        schema,
        references,
        None,
    )
}

/// The same located read, plus the read's own admitted document address as
/// one fragment of the main frame's public document node. The address must
/// be an exact model-safe public URL on that frame's origin, or it is omitted.
#[cfg(feature = "provider-transport")]
pub(crate) fn read_located_semantic_observation_at<'a>(
    observation: &'a SemanticObservation,
    acknowledgement: &SemanticObservationAcknowledgement,
    captured_at: SemanticCaptureInstant,
    schema: &crate::SemanticExtractionSchema,
    references: &std::collections::BTreeSet<SemanticReferenceId>,
    document: Option<&'a crate::ContextNavigationTarget>,
) -> Result<SemanticReadResult<'a>, SemanticReadError> {
    read_projection(
        observation,
        SemanticReadAuthority::Acknowledged(acknowledgement),
        captured_at,
        SemanticReadSensitivityLimit::PublicOnly,
        schema.extraction_read_budget(),
        schema.source_roles(),
        schema.url_sources(),
        Some(references),
        document,
        schema.is_whole_page_findings(),
    )
}

#[allow(clippy::too_many_arguments)]
fn read_projection<'a>(
    observation: &'a SemanticObservation,
    authority: SemanticReadAuthority<'_>,
    captured_at: SemanticCaptureInstant,
    sensitivity: SemanticReadSensitivityLimit,
    budget: SemanticReadBudget,
    roles: SemanticReadRoleSelection,
    url_sources: u8,
    references: Option<&std::collections::BTreeSet<SemanticReferenceId>>,
    document: Option<&'a crate::ContextNavigationTarget>,
    facts_priority: bool,
) -> Result<SemanticReadResult<'a>, SemanticReadError> {
    read_projection_with(
        observation,
        authority,
        captured_at,
        sensitivity,
        budget,
        roles,
        url_sources,
        references,
        document,
        facts_priority,
        false,
    )
}

#[allow(clippy::too_many_arguments)]
fn read_projection_with<'a>(
    observation: &'a SemanticObservation,
    authority: SemanticReadAuthority<'_>,
    captured_at: SemanticCaptureInstant,
    sensitivity: SemanticReadSensitivityLimit,
    budget: SemanticReadBudget,
    roles: SemanticReadRoleSelection,
    url_sources: u8,
    references: Option<&std::collections::BTreeSet<SemanticReferenceId>>,
    document: Option<&'a crate::ContextNavigationTarget>,
    facts_priority: bool,
    viewport_image: bool,
) -> Result<SemanticReadResult<'a>, SemanticReadError> {
    let subtree = validate_authority(observation, authority)?;
    let mut builder = SemanticReadBuilder::new(observation, captured_at, budget, roles);
    builder.url_sources = url_sources;
    builder.facts_priority = facts_priority;
    for snapshot in observation.frames() {
        let omitted_child = observation.frame_boundaries().iter().any(|boundary| {
            boundary.parent_frame() == snapshot.frame().frame()
                && !matches!(
                    boundary.status(),
                    crate::SemanticFrameBoundaryStatus::Observed { .. }
                )
        });
        if snapshot.completeness() != SemanticCompleteness::Complete || omitted_child {
            builder
                .omissions
                .insert(SemanticReadOmission::SourceIncomplete);
            builder.stats.incomplete_frames = builder.stats.incomplete_frames.saturating_add(1);
        }
        for node in snapshot.nodes() {
            builder.read_node(
                snapshot,
                node,
                sensitivity,
                references.is_none_or(|references| references.contains(&node.reference())),
            );
        }
    }
    if let Some(document) = document {
        builder.admit_document_address(document);
    }
    if viewport_image {
        builder.admit_viewport_image();
    }
    let mut read = builder.finish(subtree);
    read.focused |= references.is_some();
    Ok(read)
}

/// A read of the newest observation that also carries one viewport-image
/// fragment, for a mapping the host attaches the viewport screenshot to. The
/// fragment requires a look without known sensitive or secret nodes. That
/// negative check does not establish public pixels: provider policy must still
/// admit the screenshot as sensitive input under the original run scope.
pub fn read_semantic_observation_for_schema_with_viewport_image<'a>(
    observation: &'a SemanticObservation,
    authority: SemanticReadAuthority<'_>,
    captured_at: SemanticCaptureInstant,
    sensitivity: SemanticReadSensitivityLimit,
    budget: SemanticReadBudget,
    schema: &crate::SemanticExtractionSchema,
) -> Result<SemanticReadResult<'a>, SemanticReadError> {
    read_projection_with(
        observation,
        authority,
        captured_at,
        sensitivity,
        budget,
        schema.source_roles(),
        schema.url_sources(),
        None,
        None,
        schema.is_whole_page_findings(),
        true,
    )
}

/// The look shows too little text to read its records from: an app drawn on
/// a canvas, a gallery of pictures, prices rendered as images. Only such a
/// page is worth a viewport image for its mapping.
pub fn semantic_observation_reads_sparse(observation: &SemanticObservation) -> bool {
    let (mut text, mut images) = (0_usize, 0_usize);
    for node in observation.frames().iter().flat_map(|frame| frame.nodes()) {
        if node.role() == SemanticRole::Image {
            images += 1;
        }
        text += node.text().map_or(0, |text| text.as_str().len());
    }
    text < SPARSE_TEXT_BYTES || (images >= SPARSE_IMAGES && text / images < SPARSE_TEXT_PER_IMAGE)
}

/// Short text alone does not justify pixels. Automatic visual fallback also
/// needs observed visual content; an explicit screenshot request stays separate.
pub fn semantic_observation_needs_visual_mapping(observation: &SemanticObservation) -> bool {
    semantic_observation_reads_sparse(observation)
        && observation
            .frames()
            .iter()
            .flat_map(|frame| frame.nodes())
            .any(|node| node.role() == SemanticRole::Image)
}

/// Below this much visible text a look reads as sparse.
const SPARSE_TEXT_BYTES: usize = 1_200;
/// A gallery: this many pictures, each with this little text beside it.
const SPARSE_IMAGES: usize = 6;
const SPARSE_TEXT_PER_IMAGE: usize = 80;

fn validate_authority(
    observation: &SemanticObservation,
    authority: SemanticReadAuthority<'_>,
) -> Result<Option<SemanticReadSubtreeProof>, SemanticReadError> {
    let request = observation.request();
    match (request.parent(), request.scope().anchor(), authority) {
        (_, _, SemanticReadAuthority::Acknowledged(acknowledgement)) => {
            if !acknowledgement.matches(observation) {
                return Err(SemanticReadError::BaselineNotAcknowledged);
            }
            Ok(None)
        }
        (None, None, SemanticReadAuthority::Initial) => Ok(None),
        (
            Some(parent),
            Some(anchor),
            SemanticReadAuthority::AcknowledgedExpansion {
                previous,
                acknowledgement,
            },
        ) => {
            if parent.id() != previous.request().id()
                || parent.generation() != previous.request().generation()
                || anchor.observation() != previous.request().id()
                || anchor.observation_generation() != previous.request().generation()
                || request.context() != previous.request().context()
            {
                return Err(SemanticReadError::ExpansionMismatch);
            }
            if !acknowledgement.matches(previous) {
                return Err(SemanticReadError::BaselineNotAcknowledged);
            }
            let kind = match request.scope() {
                crate::SemanticScope::TextSearch { query, .. } => {
                    crate::SemanticExpansionKind::TextSearch(query.clone())
                }
                crate::SemanticScope::Region(_) => crate::SemanticExpansionKind::Region,
                crate::SemanticScope::Subtree(_) => crate::SemanticExpansionKind::Subtree,
                crate::SemanticScope::Table(_) => crate::SemanticExpansionKind::Table,
                crate::SemanticScope::Frame(_) => crate::SemanticExpansionKind::Frame,
                crate::SemanticScope::SurroundingText { window, .. } => {
                    crate::SemanticExpansionKind::SurroundingText(*window)
                }
                crate::SemanticScope::Initial => return Err(SemanticReadError::AuthorityMismatch),
            };
            let exact = previous
                .begin_expansion(
                    request.id(),
                    anchor.reference(),
                    anchor.frame(),
                    kind.clone(),
                    request.budget(),
                )
                .map_err(|_| SemanticReadError::ExpansionMismatch)?;
            if &exact != request {
                return Err(SemanticReadError::ExpansionMismatch);
            }
            if kind == crate::SemanticExpansionKind::Subtree {
                let [frame] = observation.frames() else {
                    return Err(SemanticReadError::ExpansionMismatch);
                };
                if frame.frame() != anchor.frame()
                    || frame.generation() <= anchor.snapshot_generation()
                    || frame
                        .nodes()
                        .first()
                        .is_none_or(|root| root.key() != anchor.capability().node_key())
                {
                    return Err(SemanticReadError::ExpansionMismatch);
                }
                Ok(Some(SemanticReadSubtreeProof {
                    predecessor: acknowledgement.clone(),
                    target: anchor.reference(),
                }))
            } else {
                Ok(None)
            }
        }
        _ => Err(SemanticReadError::AuthorityMismatch),
    }
}

struct SemanticReadBuilder<'a> {
    record_roots: std::collections::BTreeMap<(u64, u64), crate::semantic::SemanticNodeKey>,
    facts_priority: bool,
    url_sources: u8,
    roles: SemanticReadRoleSelection,
    observation: &'a SemanticObservation,
    captured_at: SemanticCaptureInstant,
    budget: SemanticReadBudget,
    fragments: Vec<SemanticReadFragment<'a>>,
    omissions: SemanticReadOmissions,
    stats: SemanticReadStats,
}

impl<'a> SemanticReadBuilder<'a> {
    fn new(
        observation: &'a SemanticObservation,
        captured_at: SemanticCaptureInstant,
        budget: SemanticReadBudget,
        roles: SemanticReadRoleSelection,
    ) -> Self {
        let mut record_roots = std::collections::BTreeMap::new();
        for frame in observation.frames() {
            for (node, root) in frame
                .nodes()
                .iter()
                .zip(crate::semantic_record::roots(frame))
            {
                if let Some(root) = root {
                    record_roots.insert((frame.frame().frame().get(), node.key().get()), root);
                }
            }
        }
        Self {
            record_roots,
            facts_priority: false,
            url_sources: 0,
            roles,
            observation,
            captured_at,
            budget,
            fragments: Vec::with_capacity(usize::from(budget.max_items())),
            omissions: SemanticReadOmissions::NONE,
            stats: SemanticReadStats {
                items: 0,
                content_bytes: 0,
                public_items: 0,
                sensitive_items: 0,
                omitted_items: 0,
                withheld_sensitive_nodes: 0,
                secret_nodes: 0,
                redacted_values: 0,
                incomplete_frames: 0,
            },
        }
    }

    fn read_node(
        &mut self,
        snapshot: &'a crate::SemanticSnapshot,
        node: &'a SemanticNode,
        limit: SemanticReadSensitivityLimit,
        selected: bool,
    ) {
        let available = readable_field_count(node)
            + u16::from(self.url_sources & 1 != 0 && node.link_destination().is_some())
            + u16::from(self.url_sources & 2 != 0 && node.image_source().is_some());
        if node.sensitivity() == SemanticSensitivity::Secret {
            self.omissions.insert(SemanticReadOmission::Secret);
            self.stats.secret_nodes = self.stats.secret_nodes.saturating_add(1);
            if matches!(node.value(), Some(SemanticValueSummary::Redacted)) {
                self.stats.redacted_values = self.stats.redacted_values.saturating_add(1);
            }
            self.stats.omitted_items = self.stats.omitted_items.saturating_add(available);
            return;
        }
        if node.sensitivity() == SemanticSensitivity::Sensitive
            && limit == SemanticReadSensitivityLimit::PublicOnly
        {
            self.omissions
                .insert(SemanticReadOmission::SensitivityLimit);
            if matches!(node.value(), Some(SemanticValueSummary::Redacted)) {
                self.omissions.insert(SemanticReadOmission::Secret);
                self.stats.redacted_values = self.stats.redacted_values.saturating_add(1);
            }
            self.stats.withheld_sensitive_nodes =
                self.stats.withheld_sensitive_nodes.saturating_add(1);
            self.stats.omitted_items = self.stats.omitted_items.saturating_add(available);
            return;
        }

        if !selected {
            if available > 0 {
                self.omissions
                    .insert(SemanticReadOmission::ReferenceSelection);
                self.stats.omitted_items = self.stats.omitted_items.saturating_add(available);
            }
            return;
        }

        if !self.roles.contains(node.role()) {
            if available > 0 {
                self.omissions.insert(SemanticReadOmission::RoleSelection);
                self.stats.omitted_items = self.stats.omitted_items.saturating_add(available);
            }
            return;
        }

        if let Some(name) = node.name().filter(|value| !value.is_empty()) {
            self.admit(
                snapshot,
                node,
                SemanticReadField::AccessibleName,
                SemanticReadContent::Text(name),
            );
        }
        if let Some(text) = node.text().filter(|value| !value.is_empty()) {
            self.admit(
                snapshot,
                node,
                SemanticReadField::VisibleText,
                SemanticReadContent::Text(text),
            );
        }
        if self.url_sources & 1 != 0 {
            if let Some(target) = node.link_destination() {
                let value = target.as_url().as_str();
                self.admit(
                    snapshot,
                    node,
                    SemanticReadField::LinkDestination,
                    SemanticReadContent::ValuePreview(SemanticValuePreview::retained(
                        value,
                        value.len(),
                        false,
                    )),
                );
            }
        }
        if self.url_sources & 2 != 0 {
            if let Some(target) = node.image_source() {
                let value = target.as_url().as_str();
                self.admit(
                    snapshot,
                    node,
                    SemanticReadField::ImageSource,
                    SemanticReadContent::ValuePreview(SemanticValuePreview::retained(
                        value,
                        value.len(),
                        false,
                    )),
                );
            }
        }
        match node.value() {
            Some(SemanticValueSummary::Text(value)) if !value.is_empty() => {
                let preview = value.preview();
                if preview.truncated() {
                    self.omissions
                        .insert(SemanticReadOmission::ValuePreviewLimit);
                }
                self.admit(
                    snapshot,
                    node,
                    SemanticReadField::TextValue,
                    SemanticReadContent::ValuePreview(preview),
                );
            }
            Some(SemanticValueSummary::Boolean(value)) => self.admit(
                snapshot,
                node,
                SemanticReadField::BooleanValue,
                SemanticReadContent::Boolean(*value),
            ),
            Some(SemanticValueSummary::Ordinal(value)) => self.admit(
                snapshot,
                node,
                SemanticReadField::OrdinalValue,
                SemanticReadContent::Ordinal(*value),
            ),
            Some(SemanticValueSummary::Redacted) => {
                self.omissions.insert(SemanticReadOmission::Secret);
                self.stats.redacted_values = self.stats.redacted_values.saturating_add(1);
                self.stats.omitted_items = self.stats.omitted_items.saturating_add(1);
            }
            Some(SemanticValueSummary::Text(_)) | None => {}
        }
    }

    fn admit_document_address(&mut self, document: &'a crate::ContextNavigationTarget) {
        let Some(snapshot) = self.observation.frames().first() else {
            return;
        };
        let same_origin = |target: &crate::ContextNavigationTarget| {
            crate::semantic_extract::exact_public_url(target.as_url().as_str())
                && target.as_url().origin() == snapshot.frame().origin().as_url().origin()
        };
        // The page's canonical address, from head metadata the snapshot
        // admitted, is preferred over the admitted document address.
        let canonical = snapshot.nodes().iter().find_map(|node| {
            let target = node.link_destination()?;
            (node.role() == SemanticRole::Link
                && node
                    .name()
                    .is_some_and(|name| name.as_str() == "Page address")
                && node.operations().is_empty()
                && node.sensitivity() == SemanticSensitivity::Public
                && same_origin(target))
            .then_some((node, target))
        });
        let (node, value) = match canonical {
            Some((node, target)) => (node, target.as_url().as_str()),
            None => {
                let Some(node) = snapshot.nodes().first() else {
                    return;
                };
                if node.role() != SemanticRole::Document
                    || node.sensitivity() != SemanticSensitivity::Public
                    || !same_origin(document)
                {
                    return;
                }
                (node, document.as_url().as_str())
            }
        };
        self.admit(
            snapshot,
            node,
            SemanticReadField::DocumentAddress,
            SemanticReadContent::ValuePreview(SemanticValuePreview::retained(
                value,
                value.len(),
                false,
            )),
        );
    }

    /// One viewport-image fragment on the main frame's public document
    /// node, when nothing in the look is sensitive or secret.
    fn admit_viewport_image(&mut self) {
        let Some(snapshot) = self.observation.frames().first() else {
            return;
        };
        let Some(node) = snapshot.nodes().first() else {
            return;
        };
        let private = self
            .observation
            .frames()
            .iter()
            .flat_map(|frame| frame.nodes())
            .any(|node| node.sensitivity() != SemanticSensitivity::Public);
        if node.role() != SemanticRole::Document || private {
            return;
        }
        self.admit(
            snapshot,
            node,
            SemanticReadField::ViewportImage,
            SemanticReadContent::ValuePreview(SemanticValuePreview::retained(
                SEMANTIC_VIEWPORT_IMAGE_TEXT,
                SEMANTIC_VIEWPORT_IMAGE_TEXT.len(),
                false,
            )),
        );
    }

    fn admit(
        &mut self,
        snapshot: &'a crate::SemanticSnapshot,
        node: &'a SemanticNode,
        field: SemanticReadField,
        content: SemanticReadContent<'a>,
    ) {
        let sensitivity = node.sensitivity();
        if sensitivity == SemanticSensitivity::Secret {
            self.omissions.insert(SemanticReadOmission::Secret);
            self.stats.omitted_items = self.stats.omitted_items.saturating_add(1);
            return;
        }
        // Collect past the budget, up to a fixed bound, so `shed` can keep a
        // listing's facts over the page chrome that precedes them.
        if self.stats.items >= COLLECTED_READ_ITEMS {
            self.omissions.insert(SemanticReadOmission::ItemLimit);
            self.stats.omitted_items = self.stats.omitted_items.saturating_add(1);
            return;
        }
        let bytes = content.retained_bytes();
        let Some(next_bytes) = self.stats.content_bytes.checked_add(bytes) else {
            self.omissions.insert(SemanticReadOmission::ByteLimit);
            self.stats.omitted_items = self.stats.omitted_items.saturating_add(1);
            return;
        };
        if next_bytes > COLLECTED_READ_BYTES {
            self.omissions.insert(SemanticReadOmission::ByteLimit);
            self.stats.omitted_items = self.stats.omitted_items.saturating_add(1);
            return;
        }
        let provenance = SemanticReadProvenance {
            fields_complete: node
                .fields_complete()
                .unwrap_or(snapshot.completeness() == SemanticCompleteness::Complete),
            node_key: node.key(),
            observation: self.observation.request().id(),
            observation_generation: self.observation.request().generation(),
            frame: snapshot.frame(),
            invocation: snapshot.invocation(),
            snapshot: snapshot.generation(),
            reference: node.reference(),
            sensitivity,
            trust: node.trust(),
            captured_at: self.captured_at,
        };
        let Some(id) = self
            .stats
            .items
            .checked_add(1)
            .and_then(SemanticReadFragmentId::new)
        else {
            self.omissions.insert(SemanticReadOmission::ItemLimit);
            self.stats.omitted_items = self.stats.omitted_items.saturating_add(1);
            return;
        };
        self.fragments.push(SemanticReadFragment {
            id,
            field,
            role: node.role(),
            record_root: self
                .record_roots
                .get(&(snapshot.frame().frame().get(), node.key().get()))
                .copied(),
            content,
            states: node.states(),
            provenance,
            region: if search_state_fragment(field, node, snapshot) {
                0
            } else {
                page_region(node, snapshot)
            },
            // Requested addresses and pictures are record values too. Keeping
            // every prose fragment first erased all images on long product pages.
            rank: if search_state_fragment(field, node, snapshot)
                || (!self.facts_priority
                    && ((field == SemanticReadField::LinkDestination && self.url_sources & 1 != 0)
                        || (field == SemanticReadField::ImageSource && self.url_sources & 2 != 0)))
            {
                0
            } else {
                shed_rank(field, node.role(), content)
            },
        });
        self.stats.items = self.stats.items.saturating_add(1);
        self.stats.content_bytes = next_bytes;
        if sensitivity == SemanticSensitivity::Public {
            self.stats.public_items = self.stats.public_items.saturating_add(1);
        } else {
            self.stats.sensitive_items = self.stats.sensitive_items.saturating_add(1);
        }
    }

    /// Brings the collected read within its budget: the least useful
    /// fragment goes first (control labels, then addresses, then facts), the
    /// latest of equals first, and every kept fragment keeps source order.
    fn shed(&mut self) {
        while self.stats.items > self.budget.max_items()
            || self.stats.content_bytes > self.budget.max_bytes()
        {
            self.omissions
                .insert(if self.stats.items > self.budget.max_items() {
                    SemanticReadOmission::ItemLimit
                } else {
                    SemanticReadOmission::ByteLimit
                });
            let Some(index) = self
                .fragments
                .iter()
                .enumerate()
                .max_by_key(|(index, fragment)| {
                    // A fact read keeps actual prose and sidebar metadata over
                    // a preceding directory of links. Catalogs keep their URLs.
                    if self.facts_priority {
                        (fragment.rank, fragment.region, *index)
                    } else {
                        (fragment.region, fragment.rank, *index)
                    }
                })
                .map(|(index, _)| index)
            else {
                break;
            };
            let removed = self.fragments.remove(index);
            self.stats.items -= 1;
            self.stats.content_bytes -= removed.content.retained_bytes();
            if removed.provenance.sensitivity == SemanticSensitivity::Public {
                self.stats.public_items -= 1;
            } else {
                self.stats.sensitive_items -= 1;
            }
            self.stats.omitted_items = self.stats.omitted_items.saturating_add(1);
        }
        for (index, fragment) in self.fragments.iter_mut().enumerate() {
            fragment.id = u16::try_from(index + 1)
                .ok()
                .and_then(SemanticReadFragmentId::new)
                .expect("bounded nonzero fragment");
        }
    }

    fn finish(mut self, subtree: Option<SemanticReadSubtreeProof>) -> SemanticReadResult<'a> {
        self.shed();
        let fingerprint = SemanticObservationFingerprint::from_observation(self.observation);
        let mut guard = read_guard(
            &fingerprint,
            self.captured_at,
            &self.fragments,
            self.omissions,
            self.stats,
            self.roles,
            self.url_sources,
        );
        if let Some(proof) = &subtree {
            let mut hasher = Sha256::new();
            hasher.update(b"ZEPHIUM-SEMANTIC-SUBTREE-READ-GUARD-1\0");
            hasher.update(guard);
            hasher.update(proof.predecessor.guard());
            hasher.update(proof.target.get().to_be_bytes());
            guard = hasher.finalize().into();
        }
        let media_observation = self.observation.request().id();
        let media_generation = self.observation.request().generation();
        let media = self
            .observation
            .frames()
            .iter()
            .flat_map(|snapshot| {
                let frame = std::sync::Arc::new(snapshot.frame().clone());
                snapshot.media().iter().filter_map(move |media| {
                    Some(ReadMediaAssociation {
                        invocation: snapshot.invocation(),
                        key: snapshot
                            .nodes()
                            .iter()
                            .find(|node| node.reference() == media.reference())?
                            .key()
                            .get(),
                        observation: media_observation,
                        generation: media_generation,
                        frame: frame.clone(),
                        snapshot: snapshot.generation(),
                        media: media.clone(),
                        area: snapshot
                            .nodes()
                            .iter()
                            .find(|node| node.reference() == media.reference())
                            .and_then(SemanticNode::geometry)
                            .map_or(0, |rect| u64::from(rect.width()) * u64::from(rect.height())),
                    })
                })
            })
            .take(crate::MAX_SEMANTIC_MEDIA)
            .collect();
        SemanticReadResult {
            budget: self.budget,
            eligible_image_geometry: self
                .observation
                .frames()
                .iter()
                .flat_map(|frame| frame.nodes())
                .filter(|node| {
                    node.role() == SemanticRole::Image
                        && node
                            .geometry()
                            .is_some_and(|rect| rect.width() >= 64 && rect.height() >= 48)
                })
                .count(),
            observed_images: self
                .observation
                .frames()
                .iter()
                .flat_map(|frame| frame.nodes())
                .filter(|node| node.role() == SemanticRole::Image)
                .count(),
            media,
            page_title: self.observation.frames().first().and_then(|frame| {
                frame
                    .nodes()
                    .iter()
                    .find(|node| {
                        node.role() == SemanticRole::Paragraph
                            && node
                                .name()
                                .is_some_and(|name| name.as_str() == "Page title")
                            && node.sensitivity() == SemanticSensitivity::Public
                            && node.operations().is_empty()
                    })
                    .and_then(|node| node.text())
                    .and_then(|text| {
                        let title: String =
                            text.as_str().chars().filter(|c| !c.is_control()).collect();
                        let title = title.trim();
                        let mut end = title
                            .len()
                            .min(zephium_core::work::environment::MAX_ENVIRONMENT_TITLE_BYTES);
                        while !title.is_char_boundary(end) {
                            end -= 1;
                        }
                        (!title.is_empty() && !crate::semantic_wire::looks_like_secret_value(title))
                            .then(|| title[..end].to_owned())
                    })
            }),
            focused: !matches!(
                self.observation.request().scope(),
                crate::SemanticScope::Initial
            ),
            url_sources: self.url_sources,
            roles: self.roles,
            observation: self.observation.request().id(),
            observation_generation: self.observation.request().generation(),
            context: self.observation.request().context(),
            observation_fingerprint: fingerprint,
            subtree,
            selected_target: None,
            captured_at: self.captured_at,
            fragments: self.fragments,
            omissions: self.omissions,
            stats: self.stats,
            guard,
            historical: Vec::new(),
        }
    }
}

/// Fragments a read collects before shedding to its budget.
const COLLECTED_READ_ITEMS: u16 = 4 * MAX_SEMANTIC_READ_ITEMS;
const COLLECTED_READ_BYTES: u32 = 4 * MAX_SEMANTIC_READ_BYTES;

/// How readily a fragment is shed from an over-budget read, lowest kept
/// longest: stated facts and form values, then addresses and picture text,
/// then the names of controls and list options.
/// A listing's records sit in the main content, after the header, the
/// navigation and the filters that precede them: those are shed first, so
/// a terminal read keeps the records rather than the page around them.
fn page_region(node: &SemanticNode, snapshot: &crate::SemanticSnapshot) -> u8 {
    let nodes = snapshot.nodes();
    let mut parent = node.parent();
    let kinds = std::iter::once(node.landmark_kind()).chain(std::iter::from_fn(|| {
        let ancestor = nodes.get(usize::from(parent?))?;
        parent = ancestor.parent();
        Some(ancestor.landmark_kind())
    }));
    let mut in_main = false;
    for kind in kinds.flatten() {
        match kind {
            crate::SemanticLandmarkKind::Banner
            | crate::SemanticLandmarkKind::Navigation
            | crate::SemanticLandmarkKind::Contentinfo
            | crate::SemanticLandmarkKind::Search => return 2,
            crate::SemanticLandmarkKind::Main => in_main = true,
            _ => {}
        }
    }
    let has_main = nodes
        .iter()
        .any(|node| node.landmark_kind() == Some(crate::SemanticLandmarkKind::Main));
    // The page's own facts and title sit at its top level beside the main
    // content; they stay with it.
    let top_level = node
        .parent()
        .and_then(|index| nodes.get(usize::from(index)))
        .is_none_or(|parent| parent.parent().is_none());
    u8::from(has_main && !in_main && !top_level)
}

// Search controls carry the observed query and settings even when the form
// lives in the page banner. Menu links and unselected option lists do not.
fn search_state_fragment(
    field: SemanticReadField,
    node: &SemanticNode,
    snapshot: &crate::SemanticSnapshot,
) -> bool {
    if !matches!(
        field,
        SemanticReadField::AccessibleName
            | SemanticReadField::VisibleText
            | SemanticReadField::TextValue
    ) || !matches!(
        node.role(),
        SemanticRole::Button
            | SemanticRole::Textbox
            | SemanticRole::Combobox
            | SemanticRole::Spinbutton
    ) {
        return false;
    }
    let mut parent = node.parent();
    while let Some(ancestor) = parent.and_then(|at| snapshot.nodes().get(usize::from(at))) {
        match ancestor.landmark_kind() {
            Some(crate::SemanticLandmarkKind::Search) => return true,
            Some(
                crate::SemanticLandmarkKind::Navigation | crate::SemanticLandmarkKind::Contentinfo,
            ) => return false,
            _ => {}
        }
        parent = ancestor.parent();
    }
    false
}

/// A fragment's usefulness under pressure: its field's and role's, except
/// that a filter checkbox's state and a bare facet count ("( 858 )") are
/// shed with the control labels, so a listing keeps its records over them.
fn shed_rank(field: SemanticReadField, role: SemanticRole, content: SemanticReadContent<'_>) -> u8 {
    let facet = match content {
        SemanticReadContent::Boolean(_) => {
            matches!(role, SemanticRole::Checkbox | SemanticRole::Radio)
        }
        SemanticReadContent::Text(text) => text
            .as_str()
            .trim()
            .strip_prefix('(')
            .and_then(|rest| rest.strip_suffix(')'))
            .is_some_and(|inner| {
                !inner.trim().is_empty()
                    && inner
                        .chars()
                        .all(|ch| ch.is_ascii_digit() || matches!(ch, ' ' | ',' | '.' | '\u{a0}'))
            }),
        _ => false,
    };
    if facet {
        2
    } else if control_value_label(field, role, content) {
        0
    } else {
        read_priority(field, role)
    }
}

// A price/date/time can be the name of a control that opens its details.
// Retention only: this neither parses a value nor verifies a selected filter.
fn control_value_label(
    field: SemanticReadField,
    role: SemanticRole,
    content: SemanticReadContent<'_>,
) -> bool {
    if !matches!(
        field,
        SemanticReadField::AccessibleName | SemanticReadField::VisibleText
    ) || !matches!(
        role,
        SemanticRole::Button | SemanticRole::Combobox | SemanticRole::Spinbutton
    ) {
        return false;
    }
    let SemanticReadContent::Text(text) = content else {
        return false;
    };
    let text = text.as_str().trim();
    if !text.chars().any(|ch| ch.is_numeric()) {
        return false;
    }
    let prefix = text
        .split_once(char::is_numeric)
        .map(|(prefix, _)| prefix.trim())
        .unwrap_or(text);
    if prefix.chars().count() <= 3
        && prefix.chars().all(|ch| {
            ch.is_alphabetic()
                || matches!(
                    ch,
                    '$' | '€' | '£' | '¥' | '₹' | '₩' | '₽' | '₺' | '₴' | '₪' | '₫' | '฿'
                )
        })
    {
        return true;
    }
    let mut previous_number = false;
    let mut separator = false;
    for ch in text.chars().filter(|ch| !ch.is_whitespace()) {
        if previous_number && separator && ch.is_numeric() {
            return true;
        }
        if previous_number && matches!(ch, ':' | '/' | '–' | '—' | '-') {
            separator = true;
        } else {
            previous_number = ch.is_numeric();
            separator = false;
        }
    }
    false
}

pub(crate) fn read_priority(field: SemanticReadField, role: SemanticRole) -> u8 {
    match field {
        SemanticReadField::TextValue
        | SemanticReadField::BooleanValue
        | SemanticReadField::ViewportImage => 0,
        SemanticReadField::OrdinalValue if role != SemanticRole::Option => 0,
        SemanticReadField::VisibleText | SemanticReadField::AccessibleName
            if matches!(
                role,
                SemanticRole::Heading
                    | SemanticRole::Paragraph
                    | SemanticRole::Document
                    | SemanticRole::Cell
                    | SemanticRole::CellHeader
                    | SemanticRole::Status
                    | SemanticRole::ListItem
                    | SemanticRole::Link
                    | SemanticRole::Row
            ) =>
        {
            0
        }
        SemanticReadField::LinkDestination
        | SemanticReadField::ImageSource
        | SemanticReadField::DocumentAddress => 1,
        SemanticReadField::VisibleText | SemanticReadField::AccessibleName
            if role == SemanticRole::Image =>
        {
            1
        }
        _ => 2,
    }
}

fn readable_field_count(node: &SemanticNode) -> u16 {
    u16::from(node.name().is_some_and(|value| !value.is_empty()))
        + u16::from(node.text().is_some_and(|value| !value.is_empty()))
        + u16::from(match node.value() {
            Some(SemanticValueSummary::Text(value)) => !value.is_empty(),
            Some(
                SemanticValueSummary::Redacted
                | SemanticValueSummary::Boolean(_)
                | SemanticValueSummary::Ordinal(_),
            ) => true,
            None => false,
        })
}

fn read_guard(
    fingerprint: &SemanticObservationFingerprint,
    captured_at: SemanticCaptureInstant,
    fragments: &[SemanticReadFragment<'_>],
    omissions: SemanticReadOmissions,
    stats: SemanticReadStats,
    roles: SemanticReadRoleSelection,
    url_sources: u8,
) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(b"ZEPHIUM-SEMANTIC-READ-GUARD-3\0");
    if url_sources & 1 != 0 {
        hasher.update(b"LINK-DESTINATIONS-1\0");
    }
    if url_sources & 2 != 0 {
        hasher.update(b"IMAGE-SOURCES-1\0");
    }
    hasher.update(roles.bits().to_be_bytes());
    hasher.update(fingerprint.digest());
    hasher.update(captured_at.millis().to_be_bytes());
    hasher.update([omissions.bits()]);
    hasher.update(stats.items.to_be_bytes());
    hasher.update(stats.content_bytes.to_be_bytes());
    hasher.update(stats.public_items.to_be_bytes());
    hasher.update(stats.sensitive_items.to_be_bytes());
    hasher.update(stats.omitted_items.to_be_bytes());
    hasher.update(stats.withheld_sensitive_nodes.to_be_bytes());
    hasher.update(stats.secret_nodes.to_be_bytes());
    hasher.update(stats.redacted_values.to_be_bytes());
    hasher.update([stats.incomplete_frames]);
    for fragment in fragments {
        hasher.update(fragment.id.get().to_be_bytes());
        hasher.update([read_field_code(fragment.field), role_code(fragment.role)]);
        hasher.update([
            u8::from(fragment.states.contains(crate::SemanticState::Selected)),
            u8::from(fragment.states.contains(crate::SemanticState::Checked)),
        ]);
        let provenance = fragment.provenance;
        hasher.update(
            fragment
                .record_root
                .map_or(0, |root| root.get())
                .to_be_bytes(),
        );
        if !provenance.fields_complete {
            hasher.update(b"FIELDS-UNPROVEN-1\0");
        }
        hasher.update(provenance.observation.get().to_be_bytes());
        hasher.update(provenance.observation_generation.get().to_be_bytes());
        hasher.update(provenance.captured_at.millis().to_be_bytes());
        hasher.update(provenance.frame.frame().get().to_be_bytes());
        hasher.update(provenance.frame.frame_generation().get().to_be_bytes());
        let origin = provenance.origin().as_url().as_str();
        hasher.update((origin.len() as u64).to_be_bytes());
        hasher.update(origin.as_bytes());
        hasher.update(provenance.invocation.get().to_be_bytes());
        hasher.update(provenance.snapshot.get().to_be_bytes());
        hasher.update(provenance.reference.get().to_be_bytes());
        hasher.update([
            sensitivity_code(provenance.sensitivity),
            trust_code(provenance.trust),
        ]);
        match fragment.content {
            SemanticReadContent::Text(text) => {
                hasher.update([1]);
                hasher.update((text.len() as u64).to_be_bytes());
                hasher.update(text.as_str().as_bytes());
            }
            SemanticReadContent::ValuePreview(preview) => {
                hasher.update([1]);
                hasher.update((preview.len() as u64).to_be_bytes());
                hasher.update(preview.text().as_bytes());
                hasher.update((preview.source_bytes() as u64).to_be_bytes());
                hasher.update([u8::from(preview.truncated())]);
            }
            SemanticReadContent::Boolean(value) => hasher.update([2, u8::from(value)]),
            SemanticReadContent::Ordinal(value) => {
                hasher.update([3]);
                hasher.update(value.to_be_bytes());
            }
        }
    }
    hasher.finalize().into()
}

const fn read_field_code(field: SemanticReadField) -> u8 {
    match field {
        SemanticReadField::AccessibleName => 1,
        SemanticReadField::VisibleText => 2,
        SemanticReadField::TextValue => 3,
        SemanticReadField::BooleanValue => 4,
        SemanticReadField::OrdinalValue => 5,
        SemanticReadField::LinkDestination => 6,
        SemanticReadField::ImageSource => 7,
        SemanticReadField::DocumentAddress => 8,
        SemanticReadField::ViewportImage => 9,
    }
}

const fn role_code(role: SemanticRole) -> u8 {
    match role {
        SemanticRole::Group => 1,
        SemanticRole::Document => 2,
        SemanticRole::Landmark => 3,
        SemanticRole::Heading => 4,
        SemanticRole::Paragraph => 5,
        SemanticRole::Link => 6,
        SemanticRole::Button => 7,
        SemanticRole::Textbox => 8,
        SemanticRole::Password => 9,
        SemanticRole::Searchbox => 10,
        SemanticRole::Checkbox => 11,
        SemanticRole::Radio => 12,
        SemanticRole::Combobox => 13,
        SemanticRole::Listbox => 14,
        SemanticRole::Option => 15,
        SemanticRole::Spinbutton => 16,
        SemanticRole::Slider => 17,
        SemanticRole::Tab => 18,
        SemanticRole::MenuItem => 19,
        SemanticRole::Dialog => 20,
        SemanticRole::List => 21,
        SemanticRole::ListItem => 22,
        SemanticRole::Table => 23,
        SemanticRole::Row => 24,
        SemanticRole::CellHeader => 25,
        SemanticRole::Cell => 26,
        SemanticRole::Image => 27,
        SemanticRole::Progress => 28,
        SemanticRole::Status => 29,
        SemanticRole::FrameBoundary => 30,
    }
}

const fn sensitivity_code(sensitivity: SemanticSensitivity) -> u8 {
    match sensitivity {
        SemanticSensitivity::Public => 1,
        SemanticSensitivity::Sensitive => 2,
        SemanticSensitivity::Secret => 3,
    }
}

const fn trust_code(trust: SemanticTrust) -> u8 {
    match trust {
        SemanticTrust::UntrustedPage => 1,
        SemanticTrust::BrowserDerived => 2,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::semantic_diff::SemanticObservationFingerprint;
    use crate::{
        decode_semantic_snapshot, ContextCapabilities, ContextCapability, ContextId,
        ContextIdentity, ContextKind, ContextOperationId, ContextRegistry, ContextRunId,
        ContextSettlement, FrameId, SemanticDecodeContext, SemanticExpansionKind,
        SemanticFrameTrust, SemanticInvocationId, SemanticObservationAssembler,
        SemanticObservationBudget, SemanticOrigin, SemanticSnapshot, SemanticSnapshotGeneration,
        SEMANTIC_WIRE_VERSION,
    };
    use serde_json::{json, Value};
    use zephium_core::ids::ProfileId;

    fn context() -> ContextJoin {
        context_with_id(111)
    }

    fn context_with_id(id: u128) -> ContextJoin {
        let identity = ContextIdentity::new(
            ContextId::from_raw(id),
            ContextRunId::from_raw(112),
            ProfileId::from(113),
            ContextKind::Owned,
        );
        let capabilities = ContextCapabilities::try_new(
            ContextKind::Owned,
            &[ContextCapability::Observe, ContextCapability::Act],
        )
        .expect("capabilities");
        let mut registry = ContextRegistry::new();
        registry.reserve(identity, capabilities).expect("reserve");
        let construction = registry
            .begin_context(
                identity.id(),
                ContextOperationId::new(1).expect("operation"),
            )
            .expect("construction");
        registry
            .settle_construction(identity.id(), construction, ContextSettlement::Applied)
            .expect("settle");
        registry.join(identity.id()).expect("context")
    }

    fn snapshot(
        frame: SemanticFrameJoin,
        invocation: u64,
        generation: u64,
        completeness: &str,
        nodes: Value,
    ) -> SemanticSnapshot {
        let bytes = serde_json::to_vec(&json!({
            "v": SEMANTIC_WIRE_VERSION,
            "i": invocation,
            "g": generation,
            "c": completeness,
            "n": nodes,
        }))
        .expect("wire");
        decode_semantic_snapshot(
            SemanticDecodeContext::new(
                SemanticInvocationId::new(invocation).expect("invocation"),
                frame,
                SemanticSnapshotGeneration::new(generation).expect("generation"),
            ),
            &bytes,
        )
        .expect("snapshot")
    }

    fn initial_observation(completeness: &str) -> SemanticObservation {
        initial_observation_with_heading(completeness, "Public heading")
    }

    fn initial_observation_with_heading(completeness: &str, heading: &str) -> SemanticObservation {
        let context = context();
        let frame = SemanticFrameJoin::try_new(
            context,
            FrameId::MAIN,
            context.frame_generation(),
            SemanticOrigin::parse("https://read-private.example.test/path").expect("origin"),
            SemanticFrameTrust::SameOrigin,
        )
        .expect("frame");
        let snapshot = snapshot(
            frame,
            7,
            9,
            completeness,
            json!([
                {"k": 1, "r": "document", "o": 16},
                {"k": 2, "p": 0, "r": "heading", "l": 2,
                 "n": heading, "t": "Public introduction"},
                {"k": 3, "p": 0, "r": "paragraph", "t": "Public paragraph"},
                {"k": 4, "p": 0, "r": "paragraph", "t": "Private customer note",
                 "q": "sensitive"},
                {"k": 5, "p": 0, "r": "password", "n": "Password",
                 "v": {"k": "redacted"}, "q": "secret"},
                {"k": 6, "p": 0, "r": "checkbox", "n": "Public enabled",
                 "v": {"k": "boolean", "value": true}, "o": 1}
            ]),
        );
        let request = crate::SemanticObservationRequest::initial(
            SemanticObservationId::new(1).expect("observation"),
            context,
            SemanticObservationBudget::INITIAL_FILTERED,
        );
        SemanticObservationAssembler::new(request, snapshot)
            .expect("assembler")
            .finish()
            .expect("observation")
    }

    fn acknowledgement(observation: &SemanticObservation) -> SemanticObservationAcknowledgement {
        SemanticObservationAcknowledgement::from_fingerprint(
            SemanticObservationFingerprint::from_observation(observation),
        )
    }

    fn retained_observation(id: u64, nodes: Value) -> SemanticObservation {
        let context = context();
        let frame = SemanticFrameJoin::try_new(
            context,
            FrameId::MAIN,
            context.frame_generation(),
            SemanticOrigin::parse("https://read-private.example.test/path").unwrap(),
            SemanticFrameTrust::SameOrigin,
        )
        .unwrap();
        SemanticObservationAssembler::new(
            crate::SemanticObservationRequest::initial(
                SemanticObservationId::new(id).unwrap(),
                context,
                SemanticObservationBudget::try_new(512, 64 * 1024, 4).unwrap(),
            ),
            snapshot(frame, id, id, "complete", nodes),
        )
        .unwrap()
        .finish()
        .unwrap()
    }

    #[test]
    fn short_text_results_do_not_require_pixels_but_visual_surfaces_can() {
        let plain = retained_observation(
            1,
            json!([
                {"k":1,"r":"document"},
                {"k":2,"p":0,"r":"paragraph","t":"Train Q17 departs 09:30, takes 75 minutes, no changes, fare EUR 25."}
            ]),
        );
        assert!(semantic_observation_reads_sparse(&plain));
        assert!(!semantic_observation_needs_visual_mapping(&plain));
        let visual = retained_observation(
            2,
            json!([
                {"k":1,"r":"document"}, {"k":2,"p":0,"r":"image","n":"Chart"}
            ]),
        );
        assert!(semantic_observation_needs_visual_mapping(&visual));
        let dense = retained_observation(
            3,
            json!([
                {"k":1,"r":"document"}, {"k":2,"p":0,"r":"image","n":"Illustration"},
                {"k":3,"p":0,"r":"paragraph","t":"Readable reference text. ".repeat(60)}
            ]),
        );
        assert!(!semantic_observation_needs_visual_mapping(&dense));
    }

    #[test]
    fn public_page_title_is_observed_bounded_metadata() {
        for sensitivity in ["public", "sensitive", "secret"] {
            let source = retained_observation(
                1,
                json!([
                    {"k":1,"r":"document","o":16},
                    {"k":2,"p":0,"r":"paragraph","n":"Page title","t":"界".repeat(200),"q":sensitivity}
                ]),
            );
            let ack = acknowledgement(&source);
            let read = read_semantic_observation(
                &source,
                SemanticReadAuthority::Acknowledged(&ack),
                SemanticCaptureInstant::from_millis(1),
                SemanticReadSensitivityLimit::PublicOnly,
                SemanticReadBudget::STANDARD,
            )
            .unwrap();
            if sensitivity == "public" {
                assert_eq!(read.page_title().unwrap().len(), 510);
                assert!(!format!("{read:?}").contains('界'));
            } else {
                assert_eq!(read.page_title(), None);
            }
        }
    }

    #[test]
    fn retained_read_survives_empty_capture_with_exact_provenance_and_bounded_cleanup() {
        let source = retained_observation(
            1,
            json!([
                {"k":1,"r":"document","o":16},
                {"k":2,"p":0,"r":"paragraph","t":"Width 29 cm; not waterproof"}
            ]),
        );
        let empty = retained_observation(2, json!([{"k":1,"r":"document","o":16}]));
        let source_ack = acknowledgement(&source);
        let empty_ack = acknowledgement(&empty);
        let read = read_semantic_observation(
            &source,
            SemanticReadAuthority::Acknowledged(&source_ack),
            SemanticCaptureInstant::from_millis(100),
            SemanticReadSensitivityLimit::PublicOnly,
            SemanticReadBudget::STANDARD,
        )
        .unwrap();
        let mut evidence = SemanticRetainedReadEvidence::default();
        evidence.retain(&read, &source_ack).unwrap();
        evidence.retain(&read, &source_ack).unwrap();
        assert_eq!(evidence.retained_items(), 1);
        assert!(evidence.retain(&read, &empty_ack).is_err());
        let current = read_semantic_observation(
            &empty,
            SemanticReadAuthority::Acknowledged(&empty_ack),
            SemanticCaptureInstant::from_millis(200),
            SemanticReadSensitivityLimit::PublicOnly,
            SemanticReadBudget::STANDARD,
        )
        .unwrap();
        evidence.retain(&current, &empty_ack).unwrap();
        let merged = evidence.merge_for_extraction(current).unwrap();
        assert!(merged.matches_acknowledgement(&empty_ack));
        assert!(!merged.matches_acknowledgement(&source_ack));
        assert_eq!(merged.fragments().len(), 1);
        let fragment = merged.fragments()[0];
        assert_eq!(fragment.provenance().observation(), source.request().id());
        assert_eq!(fragment.provenance().captured_at().millis(), 100);
        assert_eq!(fragment.content(), read.fragments()[0].content());
        let encoded = crate::encode_semantic_read(
            &merged,
            crate::SemanticModelEncodingBudget::EXTRACTION_PROVIDER_EXACT_CONSERVATIVE,
        )
        .unwrap();
        assert_eq!(encoded.stats().items(), 1);
        assert!(!format!("{evidence:?}").contains("Width"));
        drop(merged);
        evidence.clear();
        assert_eq!(evidence.retained_bytes(), 0);
        assert_eq!(evidence.retained_items(), 0);
    }

    #[test]
    fn retained_wire_deduplicates_capture_coordinates_without_merging_quotes_or_refs() {
        let nodes = json!([
            {"k":1,"r":"document","o":16},
            {"k":2,"p":0,"r":"paragraph","t":"Same quote"},
            {"k":3,"p":0,"r":"paragraph","t":"Another quote"}
        ]);
        let older = retained_observation(1, nodes.clone());
        let mut newer_nodes = nodes;
        newer_nodes[1]["k"] = json!(12);
        newer_nodes[2]["k"] = json!(13);
        let newer = retained_observation(2, newer_nodes);
        let empty = retained_observation(3, json!([{"k":1,"r":"document","o":16}]));
        let mut evidence = SemanticRetainedReadEvidence::default();
        for (observation, at) in [(&older, 100), (&newer, 200)] {
            let ack = acknowledgement(observation);
            let read = read_semantic_observation(
                observation,
                SemanticReadAuthority::Acknowledged(&ack),
                SemanticCaptureInstant::from_millis(at),
                SemanticReadSensitivityLimit::PublicOnly,
                SemanticReadBudget::STANDARD,
            )
            .unwrap();
            evidence.retain(&read, &ack).unwrap();
        }
        let ack = acknowledgement(&empty);
        let current = read_semantic_observation(
            &empty,
            SemanticReadAuthority::Acknowledged(&ack),
            SemanticCaptureInstant::from_millis(300),
            SemanticReadSensitivityLimit::PublicOnly,
            SemanticReadBudget::STANDARD,
        )
        .unwrap();
        let merged = evidence.merge_for_extraction(current).unwrap();
        let encode = || {
            crate::encode_semantic_read(
                &merged,
                crate::SemanticModelEncodingBudget::EXTRACTION_PROVIDER_EXACT_CONSERVATIVE,
            )
            .unwrap()
            .into_extraction_parts()
            .content
        };
        let wire = encode();
        assert_eq!(wire, encode());
        assert!(wire.contains("provenance=cohorts_v1"));
        assert!(wire.contains("default_p=p1"));
        assert_eq!(
            wire.lines().filter(|line| line.starts_with("P ")).count(),
            2
        );
        assert_eq!(
            wire.lines().filter(|line| line.starts_with("R ")).count(),
            4
        );
        assert!(wire.contains("P p1 f=f1 historical_observation=2 generation=1 captured_at_ms=200 invocation=2 snapshot=2\n"));
        assert!(wire.contains("P p2 f=f1 historical_observation=1 generation=1 captured_at_ms=100 invocation=1 snapshot=1\n"));
        assert!(wire.contains("R @r1 @a2 text paragraph \"Same quote\"\n"));
        assert!(wire.contains("R @r3 @a2 text paragraph \"Same quote\" p=p2\n"));
        assert!(wire
            .lines()
            .filter(|line| line.starts_with("R "))
            .all(|line| !line.contains("invocation=")));
        assert!(wire
            .lines()
            .filter(|line| line.starts_with("F "))
            .all(|line| !line.contains("snapshot=")));
    }

    #[test]
    fn retained_read_refuses_sensitive_and_foreign_document_inputs_atomically() {
        let source = initial_observation("complete");
        let ack = acknowledgement(&source);
        let sensitive = read_semantic_observation(
            &source,
            SemanticReadAuthority::Acknowledged(&ack),
            SemanticCaptureInstant::from_millis(100),
            SemanticReadSensitivityLimit::Sensitive,
            SemanticReadBudget::STANDARD,
        )
        .unwrap();
        let mut evidence = SemanticRetainedReadEvidence::default();
        assert!(evidence.retain(&sensitive, &ack).is_err());
        assert_eq!(evidence.retained_items(), 0);
        let public = read_semantic_observation(
            &source,
            SemanticReadAuthority::Acknowledged(&ack),
            SemanticCaptureInstant::from_millis(100),
            SemanticReadSensitivityLimit::PublicOnly,
            SemanticReadBudget::STANDARD,
        )
        .unwrap();
        evidence.retain(&public, &ack).unwrap();
        let items = evidence.retained_items();
        // Role and document substitution both refuse before changing retention.
        let other = retained_observation(2, json!([{"k":1,"r":"document","o":16}]));
        let other_ack = acknowledgement(&other);
        let mut current = read_semantic_observation(
            &other,
            SemanticReadAuthority::Acknowledged(&other_ack),
            SemanticCaptureInstant::from_millis(200),
            SemanticReadSensitivityLimit::PublicOnly,
            SemanticReadBudget::STANDARD,
        )
        .unwrap();
        current.roles = SemanticReadRoleSelection::try_new(&[SemanticRole::Paragraph]).unwrap();
        assert!(evidence.merge_for_extraction(current).is_err());
        let mut current = read_semantic_observation(
            &other,
            SemanticReadAuthority::Acknowledged(&other_ack),
            SemanticCaptureInstant::from_millis(200),
            SemanticReadSensitivityLimit::PublicOnly,
            SemanticReadBudget::STANDARD,
        )
        .unwrap();
        current.context = context_with_id(999);
        assert!(evidence.merge_for_extraction(current).is_err());
        assert_eq!(evidence.retained_items(), items);
    }

    #[test]
    fn retained_read_capture_and_byte_pressure_are_explicit_and_do_not_erase_on_miss() {
        let mut evidence = SemanticRetainedReadEvidence::default();
        for id in 1..=12 {
            let source = retained_observation(
                id,
                json!([
                    {"k":1,"r":"document","o":16},
                    {"k":2,"p":0,"r":"paragraph","t":format!("Capture {id}: {}", "x".repeat(4000))}
                ]),
            );
            let ack = acknowledgement(&source);
            let read = read_semantic_observation(
                &source,
                SemanticReadAuthority::Acknowledged(&ack),
                SemanticCaptureInstant::from_millis(id),
                SemanticReadSensitivityLimit::PublicOnly,
                SemanticReadBudget::STANDARD,
            )
            .unwrap();
            evidence.retain(&read, &ack).unwrap();
            assert!(evidence.retained_bytes() <= SemanticReadBudget::STANDARD.max_bytes());
            assert!(evidence.retained_items() <= SemanticReadBudget::STANDARD.max_items());
        }
        let empty = retained_observation(13, json!([{"k":1,"r":"document","o":16}]));
        let ack = acknowledgement(&empty);
        let read = read_semantic_observation(
            &empty,
            SemanticReadAuthority::Acknowledged(&ack),
            SemanticCaptureInstant::from_millis(13),
            SemanticReadSensitivityLimit::PublicOnly,
            SemanticReadBudget::STANDARD,
        )
        .unwrap();
        let merged = evidence.merge_for_extraction(read).unwrap();
        assert!(merged.omissions().contains(SemanticReadOmission::ItemLimit));
        assert!(merged.stats().omitted_items() > 0);
        assert_eq!(merged.fragments()[0].provenance().observation().get(), 12);
        assert!(merged.fragments().len() <= 8);
    }

    #[test]
    fn retained_read_deduplicates_only_the_same_source_and_value() {
        let mut evidence = SemanticRetainedReadEvidence::default();
        for id in 1..=3 {
            let observation = retained_observation(
                id,
                json!([
                    {"k":1,"r":"document","o":16},
                    {"k":2,"p":0,"r":"paragraph","t":"Price $49.99"},
                    {"k":3,"p":0,"r":"paragraph","t":"Price $49.99"}
                ]),
            );
            let ack = acknowledgement(&observation);
            let read = read_semantic_observation(
                &observation,
                SemanticReadAuthority::Acknowledged(&ack),
                SemanticCaptureInstant::from_millis(id),
                SemanticReadSensitivityLimit::PublicOnly,
                SemanticReadBudget::STANDARD,
            )
            .unwrap();
            evidence.retain(&read, &ack).unwrap();
            assert_eq!(evidence.retained_items(), 2);
        }
        let empty = retained_observation(4, json!([{"k":1,"r":"document","o":16}]));
        let ack = acknowledgement(&empty);
        let current = read_semantic_observation(
            &empty,
            SemanticReadAuthority::Acknowledged(&ack),
            SemanticCaptureInstant::from_millis(4),
            SemanticReadSensitivityLimit::PublicOnly,
            SemanticReadBudget::STANDARD,
        )
        .unwrap();
        let merged = evidence.merge_for_extraction(current).unwrap();
        assert_eq!(merged.fragments().len(), 2);
        assert!(merged.fragments().iter().all(|fragment| fragment
            .provenance()
            .observation()
            .get()
            == 3));
        assert_eq!(merged.stats().omitted_items(), 0);
        assert_ne!(
            merged.fragments()[0].provenance().reference(),
            merged.fragments()[1].provenance().reference()
        );
    }

    #[test]
    fn over_budget_reads_keep_listing_facts_over_the_controls_before_them() {
        // Shaped like the recorded x-kom.pl listing: filter controls and sort
        // options fill the page before the products.
        let mut nodes = vec![json!({"k":1,"r":"document","o":16})];
        for key in 2..=201 {
            nodes.push(json!({"k":key,"p":0,"r":"option","n":format!("Filter {key}"),"o":1}));
        }
        for key in 202..=261 {
            nodes.push(
                json!({"k":key,"p":0,"r":"link","n":format!("Laptop {key} 32 GB"),
                "u":format!("https://shop.example.test/laptop-{key}")}),
            );
            nodes.push(json!({"k":key + 100,"p":0,"r":"paragraph","t":format!("{key} zł")}));
        }
        let observation = retained_observation(1, json!(nodes));
        let ack = acknowledgement(&observation);
        let roles = SemanticReadRoleSelection::ALL;
        let read = read_projection(
            &observation,
            SemanticReadAuthority::Acknowledged(&ack),
            SemanticCaptureInstant::from_millis(1),
            SemanticReadSensitivityLimit::PublicOnly,
            SemanticReadBudget::EXTRACTION,
            roles,
            1,
            None,
            None,
            false,
        )
        .unwrap();
        assert_eq!(
            read.stats().items(),
            SemanticReadBudget::EXTRACTION.max_items()
        );
        assert!(read.omissions().contains(SemanticReadOmission::ItemLimit));
        let texts: Vec<_> = read
            .fragments()
            .iter()
            .filter_map(|fragment| fragment.content().text().map(|text| text.as_str()))
            .collect();
        for key in [202, 230, 261] {
            assert!(
                texts.contains(&format!("Laptop {key} 32 GB").as_str()),
                "{key}"
            );
            assert!(texts.contains(&format!("{key} zł").as_str()), "{key}");
        }
        let links = read
            .fragments()
            .iter()
            .filter(|fragment| fragment.field() == SemanticReadField::LinkDestination)
            .count();
        assert_eq!(links, 60);
        // Sheds keep source order and contiguous result-local identities.
        for (index, fragment) in read.fragments().iter().enumerate() {
            assert_eq!(usize::from(fragment.id().get()), index + 1);
        }
        assert!(
            texts.iter().position(|text| *text == "Laptop 202 32 GB")
                < texts.iter().position(|text| *text == "Laptop 261 32 GB")
        );
    }

    #[test]
    fn broad_duplicate_capture_cannot_erase_the_focused_source_it_replaces() {
        let mut evidence = SemanticRetainedReadEvidence::default();
        for (id, keys) in [
            (1, vec![2, 3]),
            (2, vec![257, 258]),
            (3, (2..=256).collect()),
        ] {
            let mut nodes = vec![json!({"k":1,"r":"document","o":16})];
            for key in keys {
                nodes.push(json!({"k":key,"p":0,"r":"paragraph","t":format!("Fact {key}")}));
            }
            let observation = retained_observation(id, json!(nodes));
            let ack = acknowledgement(&observation);
            let read = read_semantic_observation(
                &observation,
                SemanticReadAuthority::Acknowledged(&ack),
                SemanticCaptureInstant::from_millis(id),
                SemanticReadSensitivityLimit::PublicOnly,
                SemanticReadBudget::EXTRACTION,
            )
            .unwrap();
            evidence.retain(&read, &ack).unwrap();
        }
        // The broad capture sheds fragments down to the budget; the focused
        // sources it duplicated stay with their first capture.
        assert_eq!(
            evidence.retained_items(),
            SemanticReadBudget::EXTRACTION.max_items()
        );
        let empty = retained_observation(4, json!([{"k":1,"r":"document","o":16}]));
        let ack = acknowledgement(&empty);
        let read = read_semantic_observation(
            &empty,
            SemanticReadAuthority::Acknowledged(&ack),
            SemanticCaptureInstant::from_millis(4),
            SemanticReadSensitivityLimit::PublicOnly,
            SemanticReadBudget::STANDARD,
        )
        .unwrap();
        let merged = evidence.merge_for_extraction(read).unwrap();
        let source = merged
            .fragments()
            .iter()
            .find(|fragment| {
                fragment
                    .content()
                    .text()
                    .is_some_and(|text| text.as_str() == "Fact 2")
            })
            .unwrap();
        assert_eq!(source.provenance().observation().get(), 1);
        assert!(merged.omissions().contains(SemanticReadOmission::ItemLimit));
    }

    // A scrolling list shows the same cards again with their inner nodes
    // renumbered, under the same header; `shift` moves the inner keys.
    fn listing_page(id: u64, cards: &[u64], shift: u64) -> SemanticObservation {
        let mut nodes = vec![
            json!({"k":1,"r":"document","o":16}),
            json!({"k":2,"p":0,"r":"landmark","lm":"main"}),
            json!({"k":3,"p":0,"r":"landmark","lm":"banner"}),
            json!({"k":4+shift,"p":2,"r":"link","n":"Home","u":"https://read-private.example.test/"}),
        ];
        for card in cards {
            let group = nodes.len();
            let root = 100 + card;
            let inner = 1000 * shift + 10 * card;
            nodes.push(json!({"k":root,"p":1,"r":"group"}));
            nodes.push(json!({"k":inner+1,"p":group,"r":"image","n":format!("Photo {card}"),"m":format!("https://read-private.example.test/photo/{card}.webp")}));
            nodes.push(
                json!({"k":inner+2,"p":group,"r":"heading","l":3,"n":format!("Offer {card}")}),
            );
            nodes.push(json!({"k":inner+3,"p":group,"r":"link","n":format!("Offer {card}"),"u":format!("https://read-private.example.test/offer/{card}")}));
            nodes.push(json!({"k":inner+4,"p":group,"r":"paragraph","t":format!("{card}99 zł")}));
        }
        retained_observation(id, json!(nodes))
    }

    fn retain_listing(
        evidence: &mut SemanticRetainedReadEvidence,
        observation: &SemanticObservation,
    ) {
        let ack = acknowledgement(observation);
        let read = read_projection(
            observation,
            SemanticReadAuthority::Acknowledged(&ack),
            SemanticCaptureInstant::from_millis(1),
            SemanticReadSensitivityLimit::PublicOnly,
            SemanticReadBudget::LISTING,
            SemanticReadRoleSelection::ALL,
            3,
            None,
            None,
            false,
        )
        .unwrap();
        evidence.retain(&read, &ack).unwrap();
    }

    #[test]
    fn retained_listing_keeps_each_card_and_the_header_once_across_captures() {
        let mut evidence = SemanticRetainedReadEvidence::default();
        retain_listing(&mut evidence, &listing_page(1, &[1, 2, 3], 0));
        retain_listing(&mut evidence, &listing_page(2, &[2, 3, 4], 1));
        retain_listing(&mut evidence, &listing_page(3, &[3, 4, 5], 2));
        let current = listing_page(4, &[5, 6], 3);
        let ack = acknowledgement(&current);
        let read = read_projection(
            &current,
            SemanticReadAuthority::Acknowledged(&ack),
            SemanticCaptureInstant::from_millis(4),
            SemanticReadSensitivityLimit::PublicOnly,
            SemanticReadBudget::LISTING,
            SemanticReadRoleSelection::ALL,
            3,
            None,
            None,
            false,
        )
        .unwrap();
        let merged = evidence.merge_for_extraction(read).unwrap();
        let count = |wanted: &str| {
            merged
                .fragments()
                .iter()
                .filter(|fragment| {
                    fragment
                        .content()
                        .text()
                        .is_some_and(|text| text.as_str() == wanted)
                        || fragment
                            .content()
                            .value_preview()
                            .is_some_and(|value| value.text().ends_with(wanted))
                })
                .count()
        };
        assert_eq!(count("Home"), 1);
        for card in 1..=6 {
            // One heading name, one link name, one price, and the photo and
            // link addresses each appear once per card.
            assert_eq!(count(&format!("Offer {card}")), 2, "card {card}");
            assert_eq!(count(&format!("{card}99 zł")), 1, "card {card}");
            assert_eq!(count(&format!("photo/{card}.webp")), 1, "card {card}");
            assert_eq!(count(&format!("offer/{card}")), 1, "card {card}");
        }
        assert_eq!(merged.fragments().len(), 1 + 6 * 6 + 1);
    }

    #[test]
    fn identical_content_of_another_document_is_never_the_same_source() {
        let first = listing_page(1, &[1], 0);
        let other_context = context_with_id(222);
        let other_frame = SemanticFrameJoin::try_new(
            other_context,
            FrameId::MAIN,
            other_context.frame_generation(),
            SemanticOrigin::parse("https://read-private.example.test/path").unwrap(),
            SemanticFrameTrust::SameOrigin,
        )
        .unwrap();
        let other = SemanticObservationAssembler::new(
            crate::SemanticObservationRequest::initial(
                SemanticObservationId::new(2).unwrap(),
                other_context,
                SemanticObservationBudget::try_new(512, 64 * 1024, 4).unwrap(),
            ),
            snapshot(
                other_frame,
                2,
                2,
                "complete",
                json!([
                    {"k":1,"r":"document","o":16},
                    {"k":2,"p":0,"r":"landmark","lm":"main"},
                    {"k":3,"p":0,"r":"landmark","lm":"banner"},
                    {"k":4,"p":2,"r":"link","n":"Home","u":"https://read-private.example.test/"},
                    {"k":101,"p":1,"r":"group"},
                    {"k":11,"p":4,"r":"image","n":"Photo 1","m":"https://read-private.example.test/photo/1.webp"},
                    {"k":12,"p":4,"r":"heading","l":3,"n":"Offer 1"},
                    {"k":13,"p":4,"r":"link","n":"Offer 1","u":"https://read-private.example.test/offer/1"},
                    {"k":14,"p":4,"r":"paragraph","t":"199 zł"}
                ]),
            ),
        )
        .unwrap()
        .finish()
        .unwrap();
        fn read(observation: &SemanticObservation) -> SemanticReadResult<'_> {
            let ack = acknowledgement(observation);
            read_projection(
                observation,
                SemanticReadAuthority::Acknowledged(&ack),
                SemanticCaptureInstant::from_millis(1),
                SemanticReadSensitivityLimit::PublicOnly,
                SemanticReadBudget::LISTING,
                SemanticReadRoleSelection::ALL,
                3,
                None,
                None,
                false,
            )
            .unwrap()
        }
        let (here, there) = (read(&first), read(&other));
        assert!(!here.fragments().is_empty());
        assert_eq!(here.fragments().len(), there.fragments().len());
        for (left, right) in here.fragments().iter().zip(there.fragments()) {
            assert!(left.signature().same_source(left.signature()));
            assert!(!left.signature().same_source(right.signature()));
        }
    }

    #[test]
    fn bare_facet_counts_are_shed_before_the_records_after_them() {
        let mut nodes = vec![json!({"k":1,"r":"document","o":16})];
        for key in 2..=151 {
            nodes.push(json!({"k":key,"p":0,"r":"paragraph","t":format!("( {key} )")}));
        }
        for key in 152..=301 {
            nodes.push(json!({"k":key,"p":0,"r":"paragraph","t":format!("Laptop {key} 32 GB")}));
        }
        let page = retained_observation(1, json!(nodes));
        let ack = acknowledgement(&page);
        let read = read_semantic_observation(
            &page,
            SemanticReadAuthority::Acknowledged(&ack),
            SemanticCaptureInstant::from_millis(1),
            SemanticReadSensitivityLimit::PublicOnly,
            SemanticReadBudget::try_new(160, 48 * 1024).unwrap(),
        )
        .unwrap();
        let laptops = read
            .fragments()
            .iter()
            .filter(|fragment| {
                fragment
                    .content()
                    .text()
                    .is_some_and(|text| text.as_str().starts_with("Laptop"))
            })
            .count();
        assert_eq!(laptops, 150);
    }

    #[test]
    fn extraction_read_distinguishes_available_options_from_observed_selection() {
        let observation = retained_observation(
            1,
            json!([
                {"k":1,"r":"document"},
                {"k":2,"p":0,"r":"combobox","n":"Sort"},
                {"k":3,"p":1,"r":"option","n":"Newest first"},
                {"k":4,"p":1,"r":"option","n":"Oldest first","s":2},
                {"k":5,"p":0,"r":"checkbox","n":"Available today","s":1},
                {"k":6,"p":0,"r":"checkbox","n":"Secret filter","s":1,"q":"secret"}
            ]),
        );
        let ack = acknowledgement(&observation);
        let read = read_semantic_observation(
            &observation,
            SemanticReadAuthority::Acknowledged(&ack),
            SemanticCaptureInstant::from_millis(1),
            SemanticReadSensitivityLimit::PublicOnly,
            SemanticReadBudget::STANDARD,
        )
        .unwrap();
        let encoded = crate::encode_semantic_read(
            &read,
            crate::SemanticModelEncodingBudget::EXTRACTION_PROVIDER_EXACT_CONSERVATIVE,
        )
        .unwrap();
        let encoded = encoded
            .admit_conservative_utf8(
                &crate::SemanticTokenizerRevision::try_new("selection-test".into()).unwrap(),
            )
            .unwrap();
        let line = |label: &str| {
            encoded
                .as_str()
                .lines()
                .find(|line| line.contains(label))
                .unwrap()
        };
        assert!(!line("Newest first").contains("selected=true"));
        assert!(line("Oldest first").contains("selected=true"));
        assert!(line("Available today").contains("checked=true"));
        assert!(!encoded.as_str().contains("Secret filter"));
    }

    #[test]
    fn target_read_keeps_only_captured_subtree_and_public_attributes() {
        let observation = retained_observation(
            1,
            json!([
                {"k":1,"r":"document"},
                {"k":2,"p":0,"r":"group","n":"Chosen item"},
                {"k":3,"p":1,"r":"link","n":"Exact title","u":"https://example.test/item?variant=2"},
                {"k":4,"p":1,"r":"textbox","q":"secret","v":{"k":"redacted"}},
                {"k":5,"p":0,"r":"paragraph","t":"Unrelated sibling"}
            ]),
        );
        let ack = acknowledgement(&observation);
        let target = SemanticReferenceId::new(2).unwrap();
        let read = read_semantic_target(
            &observation,
            &ack,
            target,
            SemanticCaptureInstant::from_millis(1),
            SemanticReadSensitivityLimit::PublicOnly,
            SemanticReadBudget::STANDARD,
        )
        .unwrap();
        assert_eq!(read.selected_target(), Some(target));
        assert!(read.matches_acknowledgement(&ack));
        let content: Vec<_> = read
            .fragments()
            .iter()
            .filter_map(|f| {
                f.content()
                    .text()
                    .map(SemanticText::as_str)
                    .or_else(|| f.content().value_preview().map(|v| v.text()))
            })
            .collect();
        assert!(content.contains(&"Chosen item"));
        assert!(content.contains(&"Exact title"));
        assert!(content.contains(&"https://example.test/item?variant=2"));
        assert!(!content.contains(&"Unrelated sibling"));
        assert!(read
            .fragments()
            .iter()
            .all(|f| f.provenance().sensitivity() == SemanticSensitivity::Public));
        assert!(SemanticRetainedReadEvidence::default()
            .merge_for_extraction(read)
            .is_err());
        assert!(read_semantic_target(
            &observation,
            &ack,
            SemanticReferenceId::new(99).unwrap(),
            SemanticCaptureInstant::from_millis(1),
            SemanticReadSensitivityLimit::PublicOnly,
            SemanticReadBudget::STANDARD
        )
        .is_err());
    }

    #[test]
    fn a_listing_read_keeps_its_cards_where_a_single_record_read_keeps_the_old_cap() {
        const CARDS_PER_LOOK: u16 = 10;
        const FRAGMENTS_PER_CARD: u16 = 35;
        // One look holds at most MAX_SEMANTIC_NODES, so a listing's cards
        // accumulate over several looks.
        let look = |id: u64, first_card: u16| {
            let mut nodes = vec![
                json!({"k":1,"r":"document"}),
                json!({"k":2,"p":0,"r":"landmark","lm":"main"}),
            ];
            let mut key = 3;
            for card in first_card..first_card + CARDS_PER_LOOK {
                for fact in 0..FRAGMENTS_PER_CARD {
                    nodes.push(json!({"k":key,"p":1,"r":"paragraph","t":format!("Card {card} fact {fact}")}));
                    key += 1;
                }
            }
            retained_observation(id, Value::Array(nodes))
        };
        let rows = |max_items| {
            crate::SemanticExtractionSchema::try_new(
                crate::SemanticExtractionSchemaId::new(1).unwrap(),
                vec![crate::SemanticExtractionFieldSchema::try_rows(
                    "records".into(),
                    true,
                    vec![
                        crate::SemanticExtractionFieldSchema::try_text("name".into(), true, 128)
                            .unwrap(),
                    ],
                    max_items,
                )
                .unwrap()],
            )
            .unwrap()
        };
        let listing = rows(8);
        let single = rows(1);
        let total = 2 * CARDS_PER_LOOK * FRAGMENTS_PER_CARD;
        assert!(total > SemanticReadBudget::EXTRACTION.max_items());
        assert!(total <= SemanticReadBudget::LISTING.max_items());

        let mut evidence = SemanticRetainedReadEvidence::default();
        {
            let (id, first_card) = (1, 0);
            let observation = look(id, first_card);
            let ack = acknowledgement(&observation);
            let read = read_semantic_observation_for_schema(
                &observation,
                SemanticReadAuthority::Acknowledged(&ack),
                SemanticCaptureInstant::from_millis(id),
                SemanticReadSensitivityLimit::PublicOnly,
                listing.extraction_read_budget(),
                &listing,
            )
            .unwrap();
            evidence.retain(&read, &ack).unwrap();
        }
        let current = look(2, CARDS_PER_LOOK);
        let ack = acknowledgement(&current);
        let read = read_semantic_observation_for_schema(
            &current,
            SemanticReadAuthority::Acknowledged(&ack),
            SemanticCaptureInstant::from_millis(2),
            SemanticReadSensitivityLimit::PublicOnly,
            listing.extraction_read_budget(),
            &listing,
        )
        .unwrap();
        let merged = evidence.merge_for_extraction(read).unwrap();
        assert_eq!(merged.budget(), SemanticReadBudget::LISTING);
        for card in 0..2 * CARDS_PER_LOOK {
            let label = format!("Card {card} fact {}", FRAGMENTS_PER_CARD - 1);
            assert!(
                merged.fragments().iter().any(|fragment| fragment
                    .content()
                    .text()
                    .is_some_and(|text| text.as_str() == label)),
                "{label}"
            );
        }

        let observation = look(3, 0);
        let ack = acknowledgement(&observation);
        let capped = read_semantic_observation_for_schema(
            &observation,
            SemanticReadAuthority::Acknowledged(&ack),
            SemanticCaptureInstant::from_millis(3),
            SemanticReadSensitivityLimit::PublicOnly,
            single.extraction_read_budget(),
            &single,
        )
        .unwrap();
        assert_eq!(capped.budget(), SemanticReadBudget::EXTRACTION);
        assert_eq!(
            capped.fragments().len(),
            usize::from(SemanticReadBudget::EXTRACTION.max_items())
        );
    }

    #[test]
    fn requested_record_images_survive_text_pressure_without_disclosing_secret_images() {
        let mut nodes = vec![
            json!({"k":1,"r":"document"}),
            json!({"k":2,"p":0,"r":"landmark","lm":"main"}),
        ];
        for i in 0..3 {
            nodes.push(json!({"k":3+i,"p":1,"r":"image","n":format!("Product photo {i}"),"m":format!("https://example.test/photo/{i}.webp")}));
        }
        nodes.push(
            json!({"k":6,"p":1,"r":"image","m":"https://example.test/private.webp","q":"secret"}),
        );
        for i in 7..307 {
            nodes.push(json!({"k":i,"p":1,"r":"paragraph","t":format!("Other observed product detail {i}")}));
        }
        let observation = retained_observation(1, Value::Array(nodes));
        let schema = crate::SemanticExtractionSchema::try_new(
            crate::SemanticExtractionSchemaId::new(1).unwrap(),
            vec![crate::SemanticExtractionFieldSchema::try_rows(
                "records".into(),
                true,
                vec![
                    crate::SemanticExtractionFieldSchema::try_text("name".into(), true, 128)
                        .unwrap(),
                    crate::SemanticExtractionFieldSchema::try_image_url(
                        "image".into(),
                        false,
                        2048,
                    )
                    .unwrap(),
                ],
                3,
            )
            .unwrap()],
        )
        .unwrap();
        let ack = acknowledgement(&observation);
        let read = read_semantic_observation_for_schema(
            &observation,
            SemanticReadAuthority::Acknowledged(&ack),
            SemanticCaptureInstant::from_millis(1),
            SemanticReadSensitivityLimit::PublicOnly,
            SemanticReadBudget::EXTRACTION,
            &schema,
        )
        .unwrap();
        let images: Vec<_> = read
            .fragments()
            .iter()
            .filter(|f| f.field() == SemanticReadField::ImageSource)
            .map(|f| f.content().value_preview().unwrap().text())
            .collect();
        assert_eq!(images.len(), 3);
        assert!(images.iter().all(|url| !url.contains("private")));
        assert!(read.stats().omitted_items() > 0);
        assert!(read.stats().items() <= SemanticReadBudget::EXTRACTION.max_items());
    }

    #[test]
    fn fact_read_preserves_late_prose_and_sidebar_facts_over_a_large_link_inventory() {
        let mut nodes = vec![
            json!({"k":1,"r":"document"}),
            json!({"k":2,"p":0,"r":"landmark","lm":"main"}),
        ];
        for key in 3..183 {
            nodes.push(json!({"k":key,"p":1,"r":"link","n":format!("File {key}"),"u":format!("https://example.test/file/{key}")}));
        }
        nodes.push(
            json!({"k":183,"p":1,"r":"paragraph","t":"The current project supports Python 3.10+."}),
        );
        nodes.push(json!({"k":184,"p":0,"r":"landmark","lm":"complementary"}));
        nodes.push(json!({"k":185,"p":183,"r":"paragraph","t":"License: Apache-2.0"}));
        let observation = retained_observation(1, Value::Array(nodes));
        let schema = crate::SemanticExtractionSchema::try_new(
            crate::SemanticExtractionSchemaId::new(1).unwrap(),
            vec![crate::SemanticExtractionFieldSchema::try_text_list(
                "facts".into(),
                true,
                8,
                1024,
            )
            .unwrap()],
        )
        .unwrap();
        let ack = acknowledgement(&observation);
        let read = read_semantic_observation_for_schema(
            &observation,
            SemanticReadAuthority::Acknowledged(&ack),
            SemanticCaptureInstant::from_millis(1),
            SemanticReadSensitivityLimit::PublicOnly,
            SemanticReadBudget::EXTRACTION,
            &schema,
        )
        .unwrap();
        for required in [
            "The current project supports Python 3.10+.",
            "License: Apache-2.0",
        ] {
            assert!(
                read.fragments().iter().any(|fragment| fragment
                    .content()
                    .text()
                    .is_some_and(|text| text.as_str() == required)),
                "{required}"
            );
        }
        assert!(read.fragments().len() <= usize::from(SemanticReadBudget::EXTRACTION.max_items()));
        assert!(read.stats().omitted_items() > 0);
    }

    #[test]
    fn retained_pressure_trims_the_largest_look_instead_of_dropping_it() {
        let mut evidence = SemanticRetainedReadEvidence::default();
        for (id, label, count) in [(1, "Listing", 200), (2, "Other", 100)] {
            let mut nodes = vec![json!({"k":1,"r":"document","o":16})];
            for key in 2..2 + count {
                nodes.push(json!({"k":key,"p":0,"r":"paragraph","t":format!("{label} {key}")}));
            }
            let observation = retained_observation(id, json!(nodes));
            let ack = acknowledgement(&observation);
            let read = read_semantic_observation(
                &observation,
                SemanticReadAuthority::Acknowledged(&ack),
                SemanticCaptureInstant::from_millis(id),
                SemanticReadSensitivityLimit::PublicOnly,
                SemanticReadBudget::EXTRACTION,
            )
            .unwrap();
            evidence.retain(&read, &ack).unwrap();
        }
        assert_eq!(
            evidence.retained_items(),
            SemanticReadBudget::EXTRACTION.max_items()
        );
        let empty = retained_observation(3, json!([{"k":1,"r":"document","o":16}]));
        let ack = acknowledgement(&empty);
        let current = read_semantic_observation(
            &empty,
            SemanticReadAuthority::Acknowledged(&ack),
            SemanticCaptureInstant::from_millis(3),
            SemanticReadSensitivityLimit::PublicOnly,
            SemanticReadBudget::STANDARD,
        )
        .unwrap();
        let merged = evidence.merge_for_extraction(current).unwrap();
        let listings = merged
            .fragments()
            .iter()
            .filter(|fragment| {
                fragment
                    .content()
                    .text()
                    .is_some_and(|text| text.as_str().starts_with("Listing"))
            })
            .count();
        assert!(listings >= 150, "{listings}");
    }

    #[test]
    fn a_terminal_read_sheds_the_page_chrome_and_filters_before_the_main_records() {
        let mut nodes = vec![
            json!({"k":1,"r":"document","o":16}),
            json!({"k":2,"p":0,"r":"paragraph","n":"Page title","t":"Results"}),
            json!({"k":3,"p":0,"r":"landmark","lm":"banner"}),
        ];
        for key in 4..=103 {
            nodes.push(json!({"k":key,"p":2,"r":"link","n":format!("Menu {key}")}));
        }
        nodes.push(json!({"k":104,"p":0,"r":"group"}));
        for key in 105..=204 {
            nodes.push(json!({"k":key,"p":103,"r":"list_item","t":format!("Filter {key}")}));
        }
        nodes.push(json!({"k":205,"p":0,"r":"landmark","lm":"main"}));
        for key in 206..=305 {
            nodes.push(json!({"k":key,"p":204,"r":"list_item","t":format!("Listing {key}")}));
        }
        let page = retained_observation(1, json!(nodes));
        let ack = acknowledgement(&page);
        let read = read_semantic_observation(
            &page,
            SemanticReadAuthority::Acknowledged(&ack),
            SemanticCaptureInstant::from_millis(1),
            SemanticReadSensitivityLimit::PublicOnly,
            SemanticReadBudget::try_new(160, 48 * 1024).unwrap(),
        )
        .unwrap();
        let texts = read
            .fragments()
            .iter()
            .filter_map(|fragment| match fragment.content() {
                SemanticReadContent::Text(text) => Some(text.as_str().to_owned()),
                _ => None,
            })
            .collect::<Vec<_>>();
        assert!(texts.iter().any(|text| text == "Listing 305"));
        assert!(texts.iter().any(|text| text == "Results"));
        assert!(!texts.iter().any(|text| text.starts_with("Menu")));
        assert!(
            texts
                .iter()
                .filter(|text| text.starts_with("Filter"))
                .count()
                < 100
        );
    }

    #[test]
    fn focused_current_capture_does_not_reserve_half_for_old_viewport_chrome() {
        let chrome = retained_observation(
            1,
            json!([
                {"k":1,"r":"document","o":16},
                {"k":2,"p":0,"r":"paragraph","t":"Navigation banner"},
            {"k":259,"p":0,"r":"paragraph","t":"Navigation footer"}
            ]),
        );
        let mut nodes = vec![json!({"k":1,"r":"document","o":16})];
        for key in 3..=257 {
            nodes.push(json!({"k":key,"p":0,"r":"paragraph","t":format!("Product fact {key}")}));
        }
        let detail = retained_observation(2, json!(nodes));
        let read = |observation, ack| {
            read_semantic_observation(
                observation,
                SemanticReadAuthority::Acknowledged(ack),
                SemanticCaptureInstant::from_millis(1),
                SemanticReadSensitivityLimit::PublicOnly,
                SemanticReadBudget::EXTRACTION,
            )
            .unwrap()
        };
        let chrome_ack = acknowledgement(&chrome);
        let detail_ack = acknowledgement(&detail);
        let mut evidence = SemanticRetainedReadEvidence::default();
        evidence
            .retain(&read(&chrome, &chrome_ack), &chrome_ack)
            .unwrap();
        let mut detail_read = read(&detail, &detail_ack);
        detail_read.focused = true;
        evidence.retain(&detail_read, &detail_ack).unwrap();
        let merged = evidence.merge_for_extraction(detail_read).unwrap();
        // Every current fact is kept; old chrome only fills what is left.
        assert_eq!(
            merged
                .fragments()
                .iter()
                .filter(|fragment| fragment.provenance().observation().get() == 2)
                .count(),
            255
        );
        assert!(
            merged.fragments().len() <= usize::from(SemanticReadBudget::EXTRACTION.max_items())
        );
        assert!(merged.omissions().contains(SemanticReadOmission::ItemLimit));
    }

    #[test]
    fn extraction_keeps_prices_and_selected_dates_in_control_labels_under_pressure() {
        let mut nodes = vec![
            json!({"k":1,"r":"document","o":16}),
            json!({"k":2,"p":0,"r":"button","n":"Check in / Check out Nov 18 – 21","o":1}),
            json!({"k":3,"p":0,"r":"button","n":"$236 total $236 total, originally $279","o":1}),
            json!({"k":4,"p":0,"r":"button","n":"zł 218 total zł 218 total, originally zł 249","o":1}),
            json!({"k":5,"p":0,"r":"button","n":"Depart 09:30","o":1}),
        ];
        nodes.push(json!({"k":446,"p":0,"r":"landmark","lm":"banner"}));
        nodes.push(json!({"k":447,"p":5,"r":"landmark","lm":"search"}));
        nodes.push(json!({"k":448,"p":6,"r":"button","n":"Location Homes in Lisbon","o":1}));
        nodes.push(json!({"k":449,"p":6,"r":"button","n":"Guests 2 guests","o":1}));
        nodes.push(json!({"k":450,"p":6,"r":"button","n":"Selected Nov 18 – 21","o":1}));
        for key in 6..=165 {
            nodes.push(
                json!({"k":key,"p":0,"r":"button","n":format!("Gallery thumbnail {key}"),"o":1}),
            );
        }
        for key in 166..=445 {
            nodes.push(json!({"k":key,"p":0,"r":"paragraph","t":format!("Catalog detail {key}")}));
        }
        let observation = retained_observation(1, json!(nodes));
        let ack = acknowledgement(&observation);
        let read = read_semantic_observation(
            &observation,
            SemanticReadAuthority::Acknowledged(&ack),
            SemanticCaptureInstant::from_millis(1),
            SemanticReadSensitivityLimit::PublicOnly,
            SemanticReadBudget::EXTRACTION,
        )
        .unwrap();
        assert!(read.omissions().contains(SemanticReadOmission::ItemLimit));
        for (reference, exact) in [
            (2, "Check in / Check out Nov 18 – 21"),
            (3, "$236 total $236 total, originally $279"),
            (4, "zł 218 total zł 218 total, originally zł 249"),
            (5, "Depart 09:30"),
            (448, "Location Homes in Lisbon"),
            (449, "Guests 2 guests"),
            (450, "Selected Nov 18 – 21"),
        ] {
            let fragment = read
                .fragments()
                .iter()
                .find(|fragment| fragment.provenance().node_key.get() == reference)
                .expect("observed value in a button must remain extractable");
            assert_eq!(fragment.content().text().unwrap().as_str(), exact);
            assert_eq!(fragment.field(), SemanticReadField::AccessibleName);
        }
        assert!(!read.fragments().iter().any(|fragment| fragment
            .content()
            .text()
            .is_some_and(|text| text.as_str().starts_with("Gallery thumbnail"))));
    }

    #[test]
    fn changed_listing_view_discards_old_values_and_cannot_retain_its_departure_again() {
        let old = retained_observation(
            1,
            json!([
                {"k":1,"r":"document","o":16}, {"k":2,"p":0,"r":"paragraph","t":"Before sorting: expensive first"}
            ]),
        );
        let new = retained_observation(
            2,
            json!([
                {"k":1,"r":"document","o":16}, {"k":2,"p":0,"r":"paragraph","t":"After sorting: cheapest first"}
            ]),
        );
        let old_ack = acknowledgement(&old);
        let new_ack = acknowledgement(&new);
        let read = |look, ack| {
            read_semantic_observation(
                look,
                SemanticReadAuthority::Acknowledged(ack),
                SemanticCaptureInstant::from_millis(100),
                SemanticReadSensitivityLimit::PublicOnly,
                SemanticReadBudget::EXTRACTION,
            )
            .unwrap()
        };
        let old_read = read(&old, &old_ack);
        let mut evidence = SemanticRetainedReadEvidence::default();
        evidence.retain(&old_read, &old_ack).unwrap();
        assert!(evidence.retained_items() > 0);
        evidence.discard_view_before_action(&old_ack).unwrap();
        evidence.retain(&old_read, &old_ack).unwrap();
        assert_eq!(
            evidence.retained_items(),
            0,
            "the followed navigation must not re-add its old source"
        );
        let current = evidence.merge_for_extraction(read(&new, &new_ack)).unwrap();
        assert_eq!(current.fragments().len(), 1);
        assert_eq!(
            current.fragments()[0].content().text().unwrap().as_str(),
            "After sorting: cheapest first"
        );
        let mut foreign = read(&new, &new_ack);
        foreign.context = context_with_id(999);
        assert!(
            matches!(
                evidence.merge_for_extraction(foreign),
                Err(SemanticReadError::AuthorityMismatch)
            ),
            "discarding a view must retain its original context guard"
        );
    }

    #[test]
    fn extraction_pressure_keeps_late_facts_ahead_of_gallery_controls() {
        let mut history_nodes = vec![json!({"k":1,"r":"document","o":16})];
        for key in 2..=129 {
            history_nodes
                .push(json!({"k":key,"p":0,"r":"paragraph","t":format!("Earlier detail {key}")}));
        }
        let history = retained_observation(1, json!(history_nodes));
        let mut current_nodes = vec![json!({"k":1,"r":"document","o":16})];
        for key in 2..=161 {
            current_nodes.push(
                json!({"k":key,"p":0,"r":"button","n":format!("Gallery thumbnail {key}"),"o":1}),
            );
        }
        current_nodes.push(json!({"k":162,"p":0,"r":"heading","l":1,"n":"Example product"}));
        current_nodes.push(json!({"k":163,"p":0,"r":"paragraph","t":"$349.99"}));
        current_nodes.push(json!({"k":164,"p":0,"r":"paragraph","t":"Width 89 cm"}));
        let current = retained_observation(2, json!(current_nodes));
        let history_ack = acknowledgement(&history);
        let current_ack = acknowledgement(&current);
        let read = |observation, ack| {
            read_semantic_observation(
                observation,
                SemanticReadAuthority::Acknowledged(ack),
                SemanticCaptureInstant::from_millis(100),
                SemanticReadSensitivityLimit::PublicOnly,
                SemanticReadBudget::EXTRACTION,
            )
            .unwrap()
        };
        let mut prior = read(&history, &history_ack);
        prior.focused = true;
        let mut evidence = SemanticRetainedReadEvidence::default();
        evidence.retain(&prior, &history_ack).unwrap();
        let merged = evidence
            .merge_for_extraction(read(&current, &current_ack))
            .unwrap();
        for fact in ["Example product", "$349.99", "Width 89 cm"] {
            let fragment = merged
                .fragments()
                .iter()
                .find(|fragment| {
                    fragment
                        .content()
                        .text()
                        .is_some_and(|text| text.as_str() == fact)
                })
                .unwrap();
            assert_eq!(fragment.provenance().observation(), current.request().id());
        }
        assert_eq!(merged.fragments().len(), 256);
        assert!(merged.omissions().contains(SemanticReadOmission::ItemLimit));
        for (index, fragment) in merged.fragments().iter().enumerate() {
            assert_eq!(usize::from(fragment.id().get()), index + 1);
        }
        crate::encode_semantic_read(
            &merged,
            crate::SemanticModelEncodingBudget::EXTRACTION_PROVIDER_EXACT_CONSERVATIVE,
        )
        .unwrap();
    }

    #[test]
    fn broad_capture_preserves_focused_evidence_with_original_provenance() {
        let detail = retained_observation(
            1,
            json!([
                {"k":1,"r":"document","o":16},
                {"k":2,"p":0,"r":"paragraph","t":"Example set costs $159.99"},
                {"k":3,"p":0,"r":"paragraph","t":"Width 29 cm"}
            ]),
        );
        let mut nodes = vec![json!({"k":1,"r":"document","o":16})];
        for key in 2..=256 {
            nodes.push(json!({"k":key,"p":0,"r":"paragraph","t":format!("Catalog entry {key}")}));
        }
        let broad = retained_observation(2, json!(nodes));
        let detail_ack = acknowledgement(&detail);
        let broad_ack = acknowledgement(&broad);
        let read = |observation, ack| {
            read_semantic_observation(
                observation,
                SemanticReadAuthority::Acknowledged(ack),
                SemanticCaptureInstant::from_millis(100),
                SemanticReadSensitivityLimit::PublicOnly,
                SemanticReadBudget::EXTRACTION,
            )
            .unwrap()
        };
        let mut detail_read = read(&detail, &detail_ack);
        detail_read.focused = true;
        let broad_read = read(&broad, &broad_ack);
        let mut evidence = SemanticRetainedReadEvidence::default();
        evidence.retain(&detail_read, &detail_ack).unwrap();
        evidence.retain(&broad_read, &broad_ack).unwrap();
        assert_eq!(
            evidence.retained_items(),
            SemanticReadBudget::EXTRACTION.max_items()
        );
        let merged = evidence.merge_for_extraction(broad_read).unwrap();
        assert!(merged.matches_acknowledgement(&broad_ack));
        assert_eq!(merged.fragments().len(), 256);
        assert!(merged.omissions().contains(SemanticReadOmission::ItemLimit));
        let price = merged
            .fragments()
            .iter()
            .find(|fragment| {
                fragment
                    .content()
                    .text()
                    .is_some_and(|text| text.as_str().contains("$159.99"))
            })
            .unwrap();
        assert_eq!(price.provenance().observation().get(), 1);
        assert_eq!(price.provenance().captured_at().millis(), 100);
        assert!(merged.stats().content_bytes() <= SemanticReadBudget::STANDARD.max_bytes());
    }

    #[test]
    fn retained_read_keeps_contradictory_captures_and_remaps_colliding_refs() {
        let mut evidence = SemanticRetainedReadEvidence::default();
        for (id, text) in [(1, "Available now"), (2, "Not available")] {
            let observation = retained_observation(
                id,
                json!([
                    {"k":1,"r":"document","o":16},
                    {"k":2,"p":0,"r":"paragraph","t":text}
                ]),
            );
            let ack = acknowledgement(&observation);
            let read = read_semantic_observation(
                &observation,
                SemanticReadAuthority::Acknowledged(&ack),
                SemanticCaptureInstant::from_millis(id),
                SemanticReadSensitivityLimit::PublicOnly,
                SemanticReadBudget::STANDARD,
            )
            .unwrap();
            evidence.retain(&read, &ack).unwrap();
        }
        let empty = retained_observation(3, json!([{"k":1,"r":"document","o":16}]));
        let ack = acknowledgement(&empty);
        let current = read_semantic_observation(
            &empty,
            SemanticReadAuthority::Acknowledged(&ack),
            SemanticCaptureInstant::from_millis(3),
            SemanticReadSensitivityLimit::PublicOnly,
            SemanticReadBudget::STANDARD,
        )
        .unwrap();
        let merged = evidence.merge_for_extraction(current).unwrap();
        let [newer, older] = merged.fragments() else {
            panic!("both captures retained")
        };
        assert_ne!(newer.id(), older.id());
        assert_eq!(
            newer.provenance().reference(),
            older.provenance().reference()
        );
        assert_ne!(
            newer.provenance().observation(),
            older.provenance().observation()
        );
        assert!(
            matches!(newer.content(), SemanticReadContent::Text(text) if text.as_str() == "Not available")
        );
        assert!(
            matches!(older.content(), SemanticReadContent::Text(text) if text.as_str() == "Available now")
        );
        assert!(crate::encode_semantic_read(
            &merged,
            crate::SemanticModelEncodingBudget::EXTRACTION_PROVIDER_EXACT_CONSERVATIVE
        )
        .is_ok());
    }

    #[test]
    fn retained_empty_private_capture_keeps_omission_counts_without_duplicate_admission() {
        let source = retained_observation(
            1,
            json!([
                {"k":1,"r":"document","o":16},
                {"k":2,"p":0,"r":"paragraph","t":"private note","q":"sensitive"},
                {"k":3,"p":0,"r":"password","n":"Password","q":"secret","v":{"k":"redacted"}}
            ]),
        );
        let ack = acknowledgement(&source);
        let read = read_semantic_observation(
            &source,
            SemanticReadAuthority::Acknowledged(&ack),
            SemanticCaptureInstant::from_millis(1),
            SemanticReadSensitivityLimit::PublicOnly,
            SemanticReadBudget::STANDARD,
        )
        .unwrap();
        assert!(read.fragments().is_empty());
        let expected = read.stats();
        let mut evidence = SemanticRetainedReadEvidence::default();
        evidence.retain(&read, &ack).unwrap();
        evidence.retain(&read, &ack).unwrap();
        let merged = evidence.merge_for_extraction(read).unwrap();
        assert_eq!(merged.stats().omitted_items(), expected.omitted_items());
        drop(merged);
        let empty = retained_observation(2, json!([{"k":1,"r":"document","o":16}]));
        let ack = acknowledgement(&empty);
        let current = read_semantic_observation(
            &empty,
            SemanticReadAuthority::Acknowledged(&ack),
            SemanticCaptureInstant::from_millis(2),
            SemanticReadSensitivityLimit::PublicOnly,
            SemanticReadBudget::STANDARD,
        )
        .unwrap();
        evidence.retain(&current, &ack).unwrap();
        let merged = evidence.merge_for_extraction(current).unwrap();
        assert_eq!(merged.stats().omitted_items(), expected.omitted_items());
        assert_eq!(merged.stats().secret_nodes(), expected.secret_nodes());
        assert_eq!(
            merged.stats().withheld_sensitive_nodes(),
            expected.withheld_sensitive_nodes()
        );
        assert_eq!(merged.stats().redacted_values(), expected.redacted_values());
    }

    #[test]
    fn role_selection_is_closed_canonical_and_defaults_to_all() {
        let all: Vec<_> = SemanticReadRoleSelection::ALL.roles().collect();
        assert_eq!(all.len(), 30);
        assert_eq!(
            SemanticReadRoleSelection::try_new(&all).unwrap(),
            SemanticReadRoleSelection::default()
        );
        assert!(SemanticReadRoleSelection::try_new(&[]).is_err());
        assert!(SemanticReadRoleSelection::try_new(&[SemanticRole::Heading; 2]).is_err());
        assert!(SemanticReadRoleSelection::try_new(&[SemanticRole::Heading; 31]).is_err());
        assert_eq!(
            SemanticReadRoleSelection::try_new(&[SemanticRole::Link, SemanticRole::Heading])
                .unwrap(),
            SemanticReadRoleSelection::try_new(&[SemanticRole::Heading, SemanticRole::Link])
                .unwrap()
        );
    }

    #[test]
    fn selected_read_retains_exact_borrowed_sources_and_separate_privacy_omissions() {
        for completeness in ["complete", "node_limit"] {
            let observation = initial_observation(completeness);
            let roles = SemanticReadRoleSelection::try_new(&[
                SemanticRole::Heading,
                SemanticRole::Password,
            ])
            .unwrap();
            let read = read_selected_semantic_observation(
                &observation,
                SemanticReadAuthority::Initial,
                SemanticCaptureInstant::from_millis(42),
                SemanticReadSensitivityLimit::PublicOnly,
                SemanticReadBudget::STANDARD,
                roles,
            )
            .unwrap();
            assert_eq!(read.source_roles(), roles);
            assert_eq!(read.fragments().len(), 2);
            assert_eq!(read.stats().omitted_items(), 6);
            assert_eq!(read.stats().secret_nodes(), 1);
            assert_eq!(read.stats().withheld_sensitive_nodes(), 1);
            assert!(read
                .omissions()
                .contains(SemanticReadOmission::RoleSelection));
            assert!(read.omissions().contains(SemanticReadOmission::Secret));
            assert!(read
                .omissions()
                .contains(SemanticReadOmission::SensitivityLimit));
            assert_eq!(
                read.omissions()
                    .contains(SemanticReadOmission::SourceIncomplete),
                completeness != "complete"
            );
            for fragment in read.fragments() {
                assert_eq!(fragment.role(), SemanticRole::Heading);
                assert_eq!(fragment.provenance().reference().get(), 2);
            }
            let original = observation.frames()[0].nodes()[1].name().unwrap();
            let borrowed = read.fragments()[0].content().text().unwrap();
            assert!(std::ptr::eq(
                original.as_str().as_ptr(),
                borrowed.as_str().as_ptr()
            ));
            let limited = read_selected_semantic_observation(
                &observation,
                SemanticReadAuthority::Initial,
                SemanticCaptureInstant::from_millis(42),
                SemanticReadSensitivityLimit::PublicOnly,
                SemanticReadBudget::try_new(1, 64).unwrap(),
                roles,
            )
            .unwrap();
            assert_eq!(limited.fragments().len(), 1);
            assert!(limited
                .omissions()
                .contains(SemanticReadOmission::ItemLimit));
            assert!(limited
                .omissions()
                .contains(SemanticReadOmission::RoleSelection));
        }
    }

    #[test]
    fn different_role_contracts_cannot_share_a_read_guard_even_with_identical_fragments() {
        let observation = initial_observation("complete");
        let read = |roles: &[SemanticRole]| {
            read_selected_semantic_observation(
                &observation,
                SemanticReadAuthority::Initial,
                SemanticCaptureInstant::from_millis(42),
                SemanticReadSensitivityLimit::PublicOnly,
                SemanticReadBudget::STANDARD,
                SemanticReadRoleSelection::try_new(roles).unwrap(),
            )
            .unwrap()
        };
        let heading = read(&[SemanticRole::Heading]);
        let heading_link = read(&[SemanticRole::Heading, SemanticRole::Link]);
        assert_eq!(heading.stats(), heading_link.stats());
        assert_eq!(heading.omissions(), heading_link.omissions());
        assert_eq!(heading.fragments(), heading_link.fragments());
        assert_ne!(heading.guard(), heading_link.guard());
    }

    #[test]
    fn public_read_is_zero_copy_bounded_and_truthful_about_withheld_values() {
        let observation = initial_observation("complete");
        let captured_at = SemanticCaptureInstant::from_millis(42);
        let result = read_semantic_observation(
            &observation,
            SemanticReadAuthority::Initial,
            captured_at,
            SemanticReadSensitivityLimit::PublicOnly,
            SemanticReadBudget::STANDARD,
        )
        .expect("read");

        assert_eq!(result.stats().items(), 5);
        assert_eq!(result.stats().public_items(), 5);
        assert_eq!(result.stats().sensitive_items(), 0);
        assert_eq!(result.stats().withheld_sensitive_nodes(), 1);
        assert_eq!(result.stats().secret_nodes(), 1);
        assert_eq!(result.stats().omitted_items(), 3);
        assert_eq!(result.stats().redacted_values(), 1);
        assert!(result
            .omissions()
            .contains(SemanticReadOmission::SensitivityLimit));
        assert!(result.omissions().contains(SemanticReadOmission::Secret));
        assert!(!result.omissions().contains(SemanticReadOmission::ItemLimit));

        let first = result.fragments()[0];
        assert_eq!(first.field(), SemanticReadField::AccessibleName);
        assert_eq!(first.role(), SemanticRole::Heading);
        assert_eq!(
            first.content().text().expect("text").as_str(),
            "Public heading"
        );
        let provenance = first.provenance();
        assert_eq!(provenance.observation().get(), 1);
        assert_eq!(provenance.observation_generation().get(), 1);
        assert_eq!(provenance.context(), observation.request().context());
        assert_eq!(provenance.invocation().get(), 7);
        assert_eq!(provenance.snapshot().get(), 9);
        assert_eq!(provenance.reference().get(), 2);
        assert_eq!(provenance.sensitivity(), SemanticSensitivity::Public);
        assert_eq!(provenance.trust(), SemanticTrust::UntrustedPage);
        assert_eq!(provenance.captured_at(), captured_at);
        assert_eq!(
            provenance.origin(),
            observation.frames()[0].frame().origin()
        );
        assert_eq!(captured_at.millis(), 42);
        assert!(result.matches_acknowledgement(&acknowledgement(&observation)));
        let substituted = initial_observation_with_heading("complete", "Substituted heading");
        assert!(
            !result.matches_acknowledgement(&acknowledgement(&substituted)),
            "matching observation coordinates must not permit content substitution"
        );

        let debug = format!("{result:?} {:?} {first:?}", result.fragments());
        for content in [
            "Public heading",
            "Public introduction",
            "Public paragraph",
            "Private customer note",
            "Password",
        ] {
            assert!(!debug.contains(content));
        }
    }

    #[test]
    fn omitted_child_frames_make_read_incomplete_without_hiding_parent_content() {
        for deferred in [false, true] {
            let context = context();
            let frame = SemanticFrameJoin::try_new(
                context,
                FrameId::MAIN,
                context.frame_generation(),
                SemanticOrigin::parse("https://read.example.test/").unwrap(),
                SemanticFrameTrust::SameOrigin,
            )
            .unwrap();
            let main = snapshot(
                frame,
                7,
                9,
                "complete",
                json!([
                    {"k":1,"r":"document"},
                    {"k":2,"p":0,"r":"heading","l":1,"n":"Main content"},
                    {"k":3,"p":0,"r":"frame_boundary"},
                    {"k":4,"p":0,"r":"frame_boundary"}
                ]),
            );
            let request = crate::SemanticObservationRequest::initial(
                SemanticObservationId::new(1).unwrap(),
                context,
                SemanticObservationBudget::INITIAL_FILTERED,
            );
            let mut assembler = SemanticObservationAssembler::new(request, main).unwrap();
            for reference in [3, 4] {
                if deferred {
                    assembler
                        .defer_frame(
                            FrameId::MAIN,
                            SemanticReferenceId::new(reference).unwrap(),
                            crate::SemanticFrameDeferral::OutsideScope,
                        )
                        .unwrap();
                } else {
                    assembler
                        .mark_frame_unsupported(
                            FrameId::MAIN,
                            SemanticReferenceId::new(reference).unwrap(),
                            crate::SemanticFrameUnsupported::PolicyBlocked,
                        )
                        .unwrap();
                }
            }
            let observation = assembler.finish().unwrap();
            let read = read_semantic_observation(
                &observation,
                SemanticReadAuthority::Initial,
                SemanticCaptureInstant::from_millis(50),
                SemanticReadSensitivityLimit::PublicOnly,
                SemanticReadBudget::STANDARD,
            )
            .unwrap();
            assert!(read
                .omissions()
                .contains(SemanticReadOmission::SourceIncomplete));
            assert_eq!(
                read.stats().incomplete_frames(),
                1,
                "count the parent once, not each absent child"
            );
            assert_eq!(read.fragments().len(), 1);
            assert_eq!(
                read.fragments()[0].content().text().unwrap().as_str(),
                "Main content"
            );
        }
    }

    #[test]
    fn sensitive_read_requires_explicit_limit_and_secrets_remain_withheld() {
        let observation = initial_observation("complete");
        let result = read_semantic_observation(
            &observation,
            SemanticReadAuthority::Initial,
            SemanticCaptureInstant::from_millis(43),
            SemanticReadSensitivityLimit::Sensitive,
            SemanticReadBudget::STANDARD,
        )
        .expect("read");

        assert_eq!(result.stats().items(), 6);
        assert_eq!(result.stats().sensitive_items(), 1);
        assert_eq!(result.stats().withheld_sensitive_nodes(), 0);
        assert_eq!(result.stats().secret_nodes(), 1);
        assert_eq!(result.stats().omitted_items(), 2);
        assert_eq!(result.stats().redacted_values(), 1);
        assert!(!result
            .omissions()
            .contains(SemanticReadOmission::SensitivityLimit));
        assert!(result.omissions().contains(SemanticReadOmission::Secret));
        assert!(result.fragments().iter().any(|fragment| {
            fragment.provenance().sensitivity() == SemanticSensitivity::Sensitive
                && fragment.content().text().is_some_and(|text| {
                    std::ptr::eq(
                        text,
                        observation.frames()[0].nodes()[3].text().expect("text"),
                    )
                })
        }));
    }

    #[test]
    fn item_byte_and_source_limits_are_reported_without_overrun() {
        let observation = initial_observation("node_limit");
        let item_limited = read_semantic_observation(
            &observation,
            SemanticReadAuthority::Initial,
            SemanticCaptureInstant::from_millis(44),
            SemanticReadSensitivityLimit::Sensitive,
            SemanticReadBudget::try_new(2, 64).expect("budget"),
        )
        .expect("read");
        assert_eq!(item_limited.stats().items(), 2);
        assert!(item_limited.stats().omitted_items() >= 5);
        assert_eq!(item_limited.stats().incomplete_frames(), 1);
        assert!(item_limited
            .omissions()
            .contains(SemanticReadOmission::ItemLimit));
        assert!(item_limited
            .omissions()
            .contains(SemanticReadOmission::SourceIncomplete));

        let byte_limited = read_semantic_observation(
            &observation,
            SemanticReadAuthority::Initial,
            SemanticCaptureInstant::from_millis(45),
            SemanticReadSensitivityLimit::Sensitive,
            SemanticReadBudget::try_new(16, 5).expect("budget"),
        )
        .expect("read");
        assert!(byte_limited.stats().content_bytes() <= 5);
        assert!(byte_limited
            .omissions()
            .contains(SemanticReadOmission::ByteLimit));
        assert_eq!(
            SemanticReadBudget::try_new(0, 1),
            Err(SemanticReadBudgetError::Invalid)
        );
        assert_eq!(
            SemanticReadBudget::try_new(1, MAX_SEMANTIC_READ_BYTES + 1),
            Err(SemanticReadBudgetError::Invalid)
        );
    }

    #[test]
    fn progressive_read_requires_the_exact_acknowledged_scope_predecessor() {
        let context = context();
        let frame = SemanticFrameJoin::try_new(
            context,
            FrameId::MAIN,
            context.frame_generation(),
            SemanticOrigin::parse("https://read-private.example.test/path").expect("origin"),
            SemanticFrameTrust::SameOrigin,
        )
        .expect("frame");
        let baseline_snapshot = snapshot(
            frame.clone(),
            1,
            1,
            "complete",
            json!([
                {"k": 1, "r": "document", "o": 16},
                {"k": 2, "p": 0, "r": "group", "n": "Public region"}
            ]),
        );
        let baseline_request = crate::SemanticObservationRequest::initial(
            SemanticObservationId::new(10).expect("observation"),
            context,
            SemanticObservationBudget::INITIAL_FILTERED,
        );
        let baseline = SemanticObservationAssembler::new(baseline_request, baseline_snapshot)
            .expect("assembler")
            .finish()
            .expect("baseline");
        let expansion_request = baseline
            .begin_expansion(
                SemanticObservationId::new(11).expect("observation"),
                SemanticReferenceId::new(2).expect("reference"),
                &frame,
                SemanticExpansionKind::Subtree,
                SemanticObservationBudget::INITIAL_FILTERED,
            )
            .expect("expansion");
        let expanded_snapshot = snapshot(
            frame,
            2,
            2,
            "complete",
            json!([
                {"k": 2, "r": "group", "n": "Public region"},
                {"k": 3, "p": 0, "r": "paragraph", "t": "Expanded public text"}
            ]),
        );
        let expanded = SemanticObservationAssembler::new(expansion_request, expanded_snapshot)
            .expect("assembler")
            .finish()
            .expect("expanded");

        assert_eq!(
            read_semantic_observation(
                &expanded,
                SemanticReadAuthority::Initial,
                SemanticCaptureInstant::from_millis(46),
                SemanticReadSensitivityLimit::PublicOnly,
                SemanticReadBudget::STANDARD,
            )
            .expect_err("progressive authority required"),
            SemanticReadError::AuthorityMismatch
        );
        let altered_snapshot = snapshot(
            baseline.frames()[0].frame().clone(),
            1,
            1,
            "complete",
            json!([
                {"k": 1, "r": "document", "o": 16},
                {"k": 2, "p": 0, "r": "group", "n": "Altered public region"}
            ]),
        );
        let altered_request = crate::SemanticObservationRequest::initial(
            SemanticObservationId::new(10).expect("observation"),
            context,
            SemanticObservationBudget::INITIAL_FILTERED,
        );
        let altered = SemanticObservationAssembler::new(altered_request, altered_snapshot)
            .expect("assembler")
            .finish()
            .expect("altered");
        assert_eq!(
            read_semantic_observation(
                &expanded,
                SemanticReadAuthority::AcknowledgedExpansion {
                    previous: &baseline,
                    acknowledgement: &acknowledgement(&altered),
                },
                SemanticCaptureInstant::from_millis(47),
                SemanticReadSensitivityLimit::PublicOnly,
                SemanticReadBudget::STANDARD,
            )
            .expect_err("content-bound acknowledgement required"),
            SemanticReadError::BaselineNotAcknowledged
        );

        let result = read_semantic_observation(
            &expanded,
            SemanticReadAuthority::AcknowledgedExpansion {
                previous: &baseline,
                acknowledgement: &acknowledgement(&baseline),
            },
            SemanticCaptureInstant::from_millis(48),
            SemanticReadSensitivityLimit::PublicOnly,
            SemanticReadBudget::STANDARD,
        )
        .expect("progressive read");
        assert_eq!(result.observation().get(), 11);
        assert_eq!(result.observation_generation().get(), 2);
        assert!(result.fragments().iter().any(|fragment| {
            fragment
                .content()
                .text()
                .is_some_and(|text| text.as_str() == "Expanded public text")
        }));
    }
}
