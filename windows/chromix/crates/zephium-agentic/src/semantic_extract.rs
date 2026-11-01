//! Closed, bounded structured extraction over committed semantic-read evidence.
//!
//! The model may map already-delivered `@rN` read fragments into one bounded,
//! versioned record. Rust owns the schema, bounds, source resolution,
//! sensitivity checks, secret scanning, and result admission. This contract
//! cannot express arbitrary JSON Schema, arbitrarily nested objects, DOM identity,
//! selectors, script, native handles, or generated markup.

use std::collections::BTreeSet;
use std::fmt;
use std::num::NonZeroU64;

use serde::Deserialize;
use sha2::{Digest, Sha256};
use thiserror::Error;

use crate::semantic_wire::looks_like_secret_value;
use crate::{
    SemanticCaptureInstant, SemanticContractError, SemanticExtractionDeliveryReceipt,
    SemanticObservationGeneration, SemanticObservationId, SemanticReadDeliveryReceipt,
    SemanticReadFragment, SemanticReadFragmentId, SemanticReadResult, SemanticReadRoleSelection,
    SemanticReadSensitivityLimit, SemanticSensitivity, SemanticText,
};

/// Exact version of the model-output extraction grammar.
pub const SEMANTIC_EXTRACTION_SCHEMA_VERSION: u16 = 1;
/// Maximum hostile model-output bytes accepted before JSON decoding.
pub const MAX_SEMANTIC_EXTRACTION_INPUT_BYTES: usize = 64 * 1024;
/// Maximum fields in one trusted extraction schema or admitted result.
pub const MAX_SEMANTIC_EXTRACTION_FIELDS: usize = 64;
/// Maximum UTF-8 bytes in one trusted schema field name.
pub const MAX_SEMANTIC_EXTRACTION_FIELD_NAME_BYTES: usize = 64;
/// Maximum aggregate bytes in trusted schema field names.
pub const MAX_SEMANTIC_EXTRACTION_SCHEMA_NAME_BYTES: usize = 2 * 1024;
/// Maximum UTF-8 bytes in one extracted text scalar.
pub const MAX_SEMANTIC_EXTRACTION_TEXT_BYTES: usize = 8 * 1024;
/// Maximum items in one extracted text list.
pub const MAX_SEMANTIC_EXTRACTION_LIST_ITEMS: usize = 64;
/// Maximum UTF-8 bytes in one extracted text-list item.
pub const MAX_SEMANTIC_EXTRACTION_LIST_ITEM_BYTES: usize = 4 * 1024;
/// Maximum scalar and list-item values admitted in one result.
pub const MAX_SEMANTIC_EXTRACTION_VALUES: usize = 256;
/// Maximum delivered read fragments cited by one scalar, list, or list item.
pub const MAX_SEMANTIC_EXTRACTION_SOURCES_PER_VALUE: usize = 4;
/// Maximum aggregate provenance edges retained by one result.
pub const MAX_SEMANTIC_EXTRACTION_SOURCE_EDGES: usize = 1024;
/// Maximum aggregate UTF-8 bytes retained in one extraction result.
pub const MAX_SEMANTIC_EXTRACTION_TOTAL_TEXT_BYTES: usize = 64 * 1024;

/// Nonzero caller-owned identity for one exact extraction schema.
#[derive(Clone, Copy, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub struct SemanticExtractionSchemaId(NonZeroU64);

impl SemanticExtractionSchemaId {
    /// Constructs a nonzero schema identity.
    pub const fn new(value: u64) -> Option<Self> {
        match NonZeroU64::new(value) {
            Some(value) => Some(Self(value)),
            None => None,
        }
    }

    /// Returns the trusted schema identity value used by the fixed wire grammar.
    pub const fn get(self) -> u64 {
        self.0.get()
    }
}

impl fmt::Debug for SemanticExtractionSchemaId {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("SemanticExtractionSchemaId([redacted])")
    }
}

/// Closed value shapes available in extraction schema v1.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SemanticExtractionValueKind {
    /// One bounded text scalar.
    Text,
    /// One exact observed public link destination.
    Url,
    /// One exact observed public image source.
    ImageUrl,
    /// Decimal amount with explicit observed currency.
    Money,
    /// One Boolean scalar.
    Boolean,
    /// One unsigned integer scalar.
    Unsigned,
    /// One bounded list of bounded text items.
    TextList,
    /// Bounded records with individually cited fields.
    Rows,
}

#[derive(Clone, Debug, Eq, PartialEq)]
enum SemanticExtractionFieldSpec {
    Rows {
        fields: Vec<SemanticExtractionFieldSchema>,
        max_items: usize,
    },
    Text {
        max_bytes: usize,
    },
    Url {
        max_bytes: usize,
    },
    ImageUrl {
        max_bytes: usize,
    },
    Money {
        currencies: Vec<String>,
    },
    Boolean,
    Unsigned {
        maximum: u64,
    },
    TextList {
        max_items: usize,
        max_item_bytes: usize,
    },
}

/// One validated field in a trusted flat extraction schema.
#[derive(Clone, Eq, PartialEq)]
pub struct SemanticExtractionFieldSchema {
    name: String,
    required: bool,
    verbatim: bool,
    document_address: bool,
    spec: SemanticExtractionFieldSpec,
}

impl SemanticExtractionFieldSchema {
    /// Constructs a bounded text field.
    pub fn try_text(
        name: String,
        required: bool,
        max_bytes: usize,
    ) -> Result<Self, SemanticExtractionSchemaError> {
        validate_field_name(&name)?;
        if max_bytes == 0 || max_bytes > MAX_SEMANTIC_EXTRACTION_TEXT_BYTES {
            return Err(SemanticExtractionSchemaError::TextLimit);
        }
        Ok(Self {
            name,
            required,
            verbatim: false,
            document_address: false,
            spec: SemanticExtractionFieldSpec::Text { max_bytes },
        })
    }

    /// Requires an exact cited, public, credential-free observed link destination.
    pub fn try_url(
        name: String,
        required: bool,
        max_bytes: usize,
    ) -> Result<Self, SemanticExtractionSchemaError> {
        validate_field_name(&name)?;
        if max_bytes == 0 || max_bytes > crate::semantic::MAX_SEMANTIC_LINK_DESTINATION_BYTES {
            return Err(SemanticExtractionSchemaError::TextLimit);
        }
        Ok(Self {
            name,
            required,
            verbatim: false,
            document_address: false,
            spec: SemanticExtractionFieldSpec::Url { max_bytes },
        })
    }

    /// Requires an exact cited native image source, under the URL safety screen.
    pub fn try_image_url(
        name: String,
        required: bool,
        max_bytes: usize,
    ) -> Result<Self, SemanticExtractionSchemaError> {
        let mut field = Self::try_url(name, required, max_bytes)?;
        field.spec = SemanticExtractionFieldSpec::ImageUrl { max_bytes };
        Ok(field)
    }

    /// Requires an explicitly observed currency from the host-approved list.
    pub fn try_money(
        name: String,
        required: bool,
        currencies: Vec<String>,
    ) -> Result<Self, SemanticExtractionSchemaError> {
        validate_field_name(&name)?;
        let mut unique = BTreeSet::new();
        if currencies.is_empty()
            || currencies.len() > 16
            || currencies
                .iter()
                .any(|code| !crate::semantic_money::valid_currency(code) || !unique.insert(code))
        {
            return Err(SemanticExtractionSchemaError::CurrencyLimit);
        }
        Ok(Self {
            name,
            required,
            verbatim: false,
            document_address: false,
            spec: SemanticExtractionFieldSpec::Money { currencies },
        })
    }

    /// Host-approved currency codes, when this is a money field.
    pub fn currencies(&self) -> Option<&[String]> {
        match &self.spec {
            SemanticExtractionFieldSpec::Money { currencies } => Some(currencies),
            _ => None,
        }
    }

    /// Constructs a Boolean field.
    pub fn try_boolean(
        name: String,
        required: bool,
    ) -> Result<Self, SemanticExtractionSchemaError> {
        validate_field_name(&name)?;
        Ok(Self {
            name,
            required,
            verbatim: false,
            document_address: false,
            spec: SemanticExtractionFieldSpec::Boolean,
        })
    }

    /// Constructs an unsigned-integer field with an inclusive maximum.
    pub fn try_unsigned(
        name: String,
        required: bool,
        maximum: u64,
    ) -> Result<Self, SemanticExtractionSchemaError> {
        validate_field_name(&name)?;
        Ok(Self {
            name,
            required,
            verbatim: false,
            document_address: false,
            spec: SemanticExtractionFieldSpec::Unsigned { maximum },
        })
    }

    /// Constructs a bounded text-list field.
    pub fn try_text_list(
        name: String,
        required: bool,
        max_items: usize,
        max_item_bytes: usize,
    ) -> Result<Self, SemanticExtractionSchemaError> {
        validate_field_name(&name)?;
        if max_items == 0 || max_items > MAX_SEMANTIC_EXTRACTION_LIST_ITEMS {
            return Err(SemanticExtractionSchemaError::ListLimit);
        }
        if max_item_bytes == 0 || max_item_bytes > MAX_SEMANTIC_EXTRACTION_LIST_ITEM_BYTES {
            return Err(SemanticExtractionSchemaError::TextLimit);
        }
        Ok(Self {
            name,
            required,
            verbatim: false,
            document_address: false,
            spec: SemanticExtractionFieldSpec::TextList {
                max_items,
                max_item_bytes,
            },
        })
    }

    /// Constructs bounded rows of scalar fields; nested rows and lists refuse.
    pub fn try_rows(
        name: String,
        required: bool,
        fields: Vec<Self>,
        max_items: usize,
    ) -> Result<Self, SemanticExtractionSchemaError> {
        validate_field_name(&name)?;
        if max_items == 0 || max_items > MAX_SEMANTIC_EXTRACTION_LIST_ITEMS {
            return Err(SemanticExtractionSchemaError::ListLimit);
        }
        if fields.iter().any(|field| {
            matches!(
                field.kind(),
                SemanticExtractionValueKind::Rows | SemanticExtractionValueKind::TextList
            )
        }) {
            return Err(SemanticExtractionSchemaError::NestedCollection);
        }
        validate_schema_fields(&fields)?;
        Ok(Self {
            name,
            required,
            verbatim: false,
            document_address: false,
            spec: SemanticExtractionFieldSpec::Rows { fields, max_items },
        })
    }

    /// Fields of each row, in schema order.
    pub fn row_fields(&self) -> Option<&[Self]> {
        match &self.spec {
            SemanticExtractionFieldSpec::Rows { fields, .. } => Some(fields),
            _ => None,
        }
    }

    /// Exact ASCII identifier used in the fixed output record.
    pub fn name(&self) -> &str {
        &self.name
    }

    /// Whether omission of this field is a refusal.
    pub const fn required(&self) -> bool {
        self.required
    }

    /// Requires a text cell to equal one complete cited source fragment.
    pub fn with_verbatim_text(mut self) -> Result<Self, SemanticExtractionSchemaError> {
        if self.kind() != SemanticExtractionValueKind::Text {
            return Err(SemanticExtractionSchemaError::VerbatimKind);
        }
        self.verbatim = true;
        Ok(self)
    }

    /// True for cells that Rust must copy without normalization or synthesis.
    pub const fn verbatim_text(&self) -> bool {
        self.verbatim
    }

    /// What a verbatim copy of `exact` publishes: for a text column naming a
    /// price, cost, total or amount, the one currency amount the text shows;
    /// otherwise, or when it shows none or several, the whole text.
    pub fn verbatim_value<'a>(&self, exact: &'a str) -> &'a str {
        self.money_like()
            .then(|| crate::semantic_money::single_currency_amount(exact))
            .flatten()
            .unwrap_or(exact)
    }

    fn money_like(&self) -> bool {
        let name = self.name.to_ascii_lowercase();
        matches!(self.spec, SemanticExtractionFieldSpec::Text { .. })
            && ["price", "cost", "total", "amount"]
                .iter()
                .any(|word| name.contains(word))
    }

    /// Marks a URL column whose value is the subject's own page address. It
    /// may then cite the read's admitted document address, never page text.
    pub fn with_document_address(mut self) -> Result<Self, SemanticExtractionSchemaError> {
        if self.kind() != SemanticExtractionValueKind::Url {
            return Err(SemanticExtractionSchemaError::DocumentAddressKind);
        }
        self.document_address = true;
        Ok(self)
    }

    /// True for a URL column the read's own document address may answer.
    pub const fn document_address(&self) -> bool {
        self.document_address
    }

    /// Closed value shape for this field.
    pub const fn kind(&self) -> SemanticExtractionValueKind {
        match &self.spec {
            SemanticExtractionFieldSpec::Text { .. } => SemanticExtractionValueKind::Text,
            SemanticExtractionFieldSpec::Url { .. } => SemanticExtractionValueKind::Url,
            SemanticExtractionFieldSpec::ImageUrl { .. } => SemanticExtractionValueKind::ImageUrl,
            SemanticExtractionFieldSpec::Money { .. } => SemanticExtractionValueKind::Money,
            SemanticExtractionFieldSpec::Boolean => SemanticExtractionValueKind::Boolean,
            SemanticExtractionFieldSpec::Unsigned { .. } => SemanticExtractionValueKind::Unsigned,
            SemanticExtractionFieldSpec::TextList { .. } => SemanticExtractionValueKind::TextList,
            SemanticExtractionFieldSpec::Rows { .. } => SemanticExtractionValueKind::Rows,
        }
    }

    /// Per-value text byte limit, when this is a text field.
    pub const fn max_text_bytes(&self) -> Option<usize> {
        match &self.spec {
            SemanticExtractionFieldSpec::Text { max_bytes }
            | SemanticExtractionFieldSpec::Url { max_bytes }
            | SemanticExtractionFieldSpec::ImageUrl { max_bytes } => Some(*max_bytes),
            _ => None,
        }
    }

    /// Inclusive numeric maximum, when this is an unsigned field.
    pub const fn maximum_unsigned(&self) -> Option<u64> {
        match &self.spec {
            SemanticExtractionFieldSpec::Unsigned { maximum } => Some(*maximum),
            _ => None,
        }
    }

    /// Per-list item-count limit, when this is a text-list field.
    pub const fn max_list_items(&self) -> Option<usize> {
        match &self.spec {
            SemanticExtractionFieldSpec::TextList { max_items, .. }
            | SemanticExtractionFieldSpec::Rows { max_items, .. } => Some(*max_items),
            _ => None,
        }
    }

    /// Per-item text byte limit, when this is a text-list field.
    pub const fn max_list_item_bytes(&self) -> Option<usize> {
        match &self.spec {
            SemanticExtractionFieldSpec::TextList { max_item_bytes, .. } => Some(*max_item_bytes),
            _ => None,
        }
    }
}

impl fmt::Debug for SemanticExtractionFieldSchema {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("SemanticExtractionFieldSchema")
            .field("name", &"[redacted]")
            .field("required", &self.required)
            .field("kind", &self.kind())
            .finish()
    }
}

/// Validated ordered flat extraction schema owned by trusted Rust code.
#[derive(Clone, Eq, PartialEq)]
pub struct SemanticExtractionSchema {
    id: SemanticExtractionSchemaId,
    fields: Vec<SemanticExtractionFieldSchema>,
    source_roles: SemanticReadRoleSelection,
}

impl SemanticExtractionSchema {
    /// Validates one nonempty, unique, bounded ordered schema.
    pub fn try_new(
        id: SemanticExtractionSchemaId,
        fields: Vec<SemanticExtractionFieldSchema>,
    ) -> Result<Self, SemanticExtractionSchemaError> {
        validate_schema_fields(&fields)?;
        let declared = fields.len()
            + fields
                .iter()
                .filter_map(SemanticExtractionFieldSchema::row_fields)
                .map(<[_]>::len)
                .sum::<usize>();
        let names = fields
            .iter()
            .map(|field| {
                field.name.len()
                    + field
                        .row_fields()
                        .unwrap_or_default()
                        .iter()
                        .map(|child| child.name.len())
                        .sum::<usize>()
            })
            .sum::<usize>();
        if declared > MAX_SEMANTIC_EXTRACTION_FIELDS
            || names > MAX_SEMANTIC_EXTRACTION_SCHEMA_NAME_BYTES
        {
            return Err(SemanticExtractionSchemaError::FieldLimit);
        }
        Ok(Self {
            id,
            fields,
            source_roles: SemanticReadRoleSelection::ALL,
        })
    }

    /// Selects trusted source roles from the already-authorized capture before
    /// mapping. This narrows evidence, not capture, privacy, or action authority.
    /// The selection is part of the exact schema contract; default is all roles.
    pub fn with_source_roles(mut self, roles: SemanticReadRoleSelection) -> Self {
        self.source_roles = roles;
        self
    }

    /// Immutable trusted evidence selection bound to this schema.
    pub const fn source_roles(&self) -> SemanticReadRoleSelection {
        self.source_roles
    }

    /// URL evidence is disclosed for URL fields and whole-page findings,
    /// which may cite the next page to read. Both use the same URL privacy screen.
    pub fn includes_link_destinations(&self) -> bool {
        self.url_sources() & 1 != 0
    }

    /// Image source evidence is disclosed only when requested by a field.
    pub fn includes_image_sources(&self) -> bool {
        self.url_sources() & 2 != 0
    }

    pub(crate) fn url_sources(&self) -> u8 {
        self.fields
            .iter()
            .flat_map(|field| std::iter::once(field).chain(field.row_fields().unwrap_or_default()))
            .fold(u8::from(self.is_whole_page_findings()), |bits, field| {
                bits | match field.kind() {
                    SemanticExtractionValueKind::Url => 1,
                    SemanticExtractionValueKind::ImageUrl => 2,
                    _ => 0,
                }
            })
    }

    /// Exact trusted schema identity expected in model output.
    pub const fn id(&self) -> SemanticExtractionSchemaId {
        self.id
    }

    /// Schema-ordered fields.
    pub fn fields(&self) -> &[SemanticExtractionFieldSchema] {
        &self.fields
    }

    /// One generated text list and nothing else: cited findings about the
    /// whole page rather than values of a subject.
    pub fn is_whole_page_findings(&self) -> bool {
        matches!(self.fields.as_slice(), [field]
            if field.kind() == SemanticExtractionValueKind::TextList && !field.verbatim_text())
    }

    /// One rows field of more than one record: a catalog of subjects read
    /// from one page rather than one subject's own page.
    pub fn is_row_collection(&self) -> bool {
        matches!(self.fields.as_slice(), [field]
            if field.kind() == SemanticExtractionValueKind::Rows
                && field.max_list_items().is_some_and(|items| items > 1))
    }

    /// One record on an already identified page; not a listing-loading request.
    pub fn is_single_record(&self) -> bool {
        matches!(self.fields.as_slice(), [field]
            if field.kind() == SemanticExtractionValueKind::Rows && field.max_list_items() == Some(1))
    }

    /// The read ceilings of a terminal mapping: a multi-record listing gets
    /// the room its many cards need, anything else the single-record budget.
    pub fn extraction_read_budget(&self) -> crate::SemanticReadBudget {
        if self.is_row_collection() {
            crate::SemanticReadBudget::LISTING
        } else {
            crate::SemanticReadBudget::EXTRACTION
        }
    }

    /// The request encoding ceiling matching `extraction_read_budget`.
    pub fn extraction_encoding_budget(&self) -> crate::SemanticModelEncodingBudget {
        if self.is_row_collection() {
            crate::SemanticModelEncodingBudget::LISTING_PROVIDER_EXACT_CONSERVATIVE
        } else {
            crate::SemanticModelEncodingBudget::EXTRACTION_PROVIDER_EXACT_CONSERVATIVE
        }
    }

    /// Facts and records use the larger document budget, including single
    /// products whose identity metadata lies beyond the first viewport.
    pub fn reads_whole_page(&self) -> bool {
        self.is_whole_page_findings()
            || matches!(self.fields.as_slice(), [field]
            if field.kind() == SemanticExtractionValueKind::Rows)
    }
}

impl fmt::Debug for SemanticExtractionSchema {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("SemanticExtractionSchema")
            .field("id", &self.id)
            .field("fields", &self.fields.len())
            .field("source_roles", &self.source_roles)
            .finish()
    }
}

/// Refusal to construct an invalid trusted extraction schema.
#[derive(Clone, Copy, Debug, Eq, Error, PartialEq)]
pub enum SemanticExtractionSchemaError {
    /// Only a text scalar can request exact copying; URLs already require exact sources.
    #[error("verbatim extraction requires a text field")]
    VerbatimKind,
    /// Only a URL field can be answered by the read's own document address.
    #[error("document address extraction requires a url field")]
    DocumentAddressKind,
    /// Rows contain only scalar fields.
    #[error("nested extraction collection refused")]
    NestedCollection,
    /// The schema was empty or exceeded the field ceiling.
    #[error("semantic extraction schema field ceiling is invalid")]
    FieldLimit,
    /// A field name was not a bounded ASCII identifier.
    #[error("semantic extraction schema field name is invalid")]
    FieldName,
    /// A field name was repeated.
    #[error("semantic extraction schema field is duplicated")]
    DuplicateField,
    /// Aggregate field-name bytes exceeded the schema ceiling.
    #[error("semantic extraction schema name ceiling exceeded")]
    NameLimit,
    /// A text ceiling was zero or exceeded its hard maximum.
    #[error("semantic extraction schema text ceiling is invalid")]
    TextLimit,
    /// A list ceiling was zero or exceeded its hard maximum.
    #[error("semantic extraction schema list ceiling is invalid")]
    ListLimit,
    /// Currency list is empty, duplicated, malformed or too large.
    #[error("semantic extraction currency list is invalid")]
    CurrencyLimit,
}

fn validate_schema_fields(
    fields: &[SemanticExtractionFieldSchema],
) -> Result<(), SemanticExtractionSchemaError> {
    if fields.is_empty() || fields.len() > MAX_SEMANTIC_EXTRACTION_FIELDS {
        return Err(SemanticExtractionSchemaError::FieldLimit);
    }
    let mut names = BTreeSet::new();
    let mut name_bytes = 0;
    for field in fields {
        validate_field_name(field.name())?;
        if !names.insert(field.name()) {
            return Err(SemanticExtractionSchemaError::DuplicateField);
        }
        name_bytes += field.name().len();
        if name_bytes > MAX_SEMANTIC_EXTRACTION_SCHEMA_NAME_BYTES {
            return Err(SemanticExtractionSchemaError::NameLimit);
        }
    }
    Ok(())
}

fn validate_field_name(name: &str) -> Result<(), SemanticExtractionSchemaError> {
    if name.is_empty() || name.len() > MAX_SEMANTIC_EXTRACTION_FIELD_NAME_BYTES {
        return Err(SemanticExtractionSchemaError::FieldName);
    }
    let mut bytes = name.bytes();
    let Some(first) = bytes.next() else {
        return Err(SemanticExtractionSchemaError::FieldName);
    };
    if !first.is_ascii_alphabetic()
        || !bytes.all(|byte| byte.is_ascii_alphanumeric() || byte == b'_')
    {
        return Err(SemanticExtractionSchemaError::FieldName);
    }
    Ok(())
}

/// Trust class for every admitted extraction value.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SemanticExtractionTrust {
    /// Untrusted model mapping over cited, already-delivered semantic evidence.
    ModelMapped,
}

/// Opaque span into the result's bounded flat provenance table.
#[derive(Clone, Copy, Eq, PartialEq)]
pub struct SemanticExtractionSourceSpan {
    start: u16,
    len: u8,
    result_guard: [u8; 32],
}

impl SemanticExtractionSourceSpan {
    /// Number of cited delivered read fragments.
    pub const fn len(self) -> u8 {
        self.len
    }

    /// Reports whether the span contains no provenance edges.
    pub const fn is_empty(self) -> bool {
        self.len == 0
    }
}

impl fmt::Debug for SemanticExtractionSourceSpan {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("SemanticExtractionSourceSpan")
            .field("sources", &self.len)
            .finish()
    }
}

/// One cited primitive from the exact committed semantic read.
#[derive(Clone, Copy, Eq, PartialEq)]
pub struct SemanticExtractionSource<'a> {
    fragment: SemanticReadFragment<'a>,
}

impl<'a> SemanticExtractionSource<'a> {
    /// Exact bounded read fragment cited by the model mapping.
    pub const fn fragment(self) -> SemanticReadFragment<'a> {
        self.fragment
    }
}

impl fmt::Debug for SemanticExtractionSource<'_> {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("SemanticExtractionSource")
            .field("id", &self.fragment.id())
            .field("sensitivity", &self.fragment.provenance().sensitivity())
            .field("trust", &self.fragment.provenance().trust())
            .finish()
    }
}

/// Bounded model-mapped text plus its exact cited evidence span.
#[derive(Eq, PartialEq)]
pub struct SemanticExtractedText {
    value: SemanticText,
    sources: SemanticExtractionSourceSpan,
}

impl SemanticExtractedText {
    /// Returns admitted untrusted model-mapped text to an explicit consumer.
    pub fn as_str(&self) -> &str {
        self.value.as_str()
    }

    /// UTF-8 byte length of the admitted value.
    pub fn len(&self) -> usize {
        self.value.len()
    }

    /// Reports whether no text is retained.
    pub fn is_empty(&self) -> bool {
        self.value.is_empty()
    }

    /// Opaque span resolving to the exact cited read fragments.
    pub const fn source_span(&self) -> SemanticExtractionSourceSpan {
        self.sources
    }
}

impl fmt::Debug for SemanticExtractedText {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("SemanticExtractedText")
            .field("bytes", &self.value.len())
            .field("value", &"[redacted]")
            .field("sources", &self.sources.len)
            .finish()
    }
}

/// Bounded model-mapped Boolean plus its exact cited evidence span.
#[derive(Eq, PartialEq)]
pub struct SemanticExtractedBoolean {
    value: bool,
    sources: SemanticExtractionSourceSpan,
}

impl SemanticExtractedBoolean {
    /// Admitted Boolean value.
    pub const fn value(&self) -> bool {
        self.value
    }

    /// Opaque span resolving to the exact cited read fragments.
    pub const fn source_span(&self) -> SemanticExtractionSourceSpan {
        self.sources
    }
}

impl fmt::Debug for SemanticExtractedBoolean {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("SemanticExtractedBoolean")
            .field("value", &"[redacted]")
            .field("sources", &self.sources.len)
            .finish()
    }
}

/// Decimal strings with source-backed currency; no floating-point conversion.
#[derive(Eq, PartialEq)]
pub struct SemanticExtractedMoney {
    amount: SemanticExtractedText,
    currency: String,
}
impl SemanticExtractedMoney {
    /// Admitted decimal amount.
    pub fn amount(&self) -> &str {
        self.amount.as_str()
    }
    /// Explicit observed currency code.
    pub fn currency(&self) -> &str {
        &self.currency
    }
    /// Exact cited source span.
    pub const fn source_span(&self) -> SemanticExtractionSourceSpan {
        self.amount.source_span()
    }
}
impl fmt::Debug for SemanticExtractedMoney {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("SemanticExtractedMoney([redacted])")
    }
}

/// Bounded model-mapped unsigned integer plus exact cited evidence.
#[derive(Eq, PartialEq)]
pub struct SemanticExtractedUnsigned {
    value: u64,
    sources: SemanticExtractionSourceSpan,
}

impl SemanticExtractedUnsigned {
    /// Admitted unsigned value.
    pub const fn value(&self) -> u64 {
        self.value
    }

    /// Opaque span resolving to the exact cited read fragments.
    pub const fn source_span(&self) -> SemanticExtractionSourceSpan {
        self.sources
    }
}

impl fmt::Debug for SemanticExtractedUnsigned {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("SemanticExtractedUnsigned")
            .field("value", &"[redacted]")
            .field("sources", &self.sources.len)
            .finish()
    }
}

/// Bounded model-mapped text list with collection and item provenance.
#[derive(Eq, PartialEq)]
pub struct SemanticExtractedTextList {
    items: Vec<SemanticExtractedText>,
    sources: SemanticExtractionSourceSpan,
}

impl SemanticExtractedTextList {
    /// Ordered admitted list items.
    pub fn items(&self) -> &[SemanticExtractedText] {
        &self.items
    }

    /// Opaque span citing evidence for the collection-level mapping.
    pub const fn source_span(&self) -> SemanticExtractionSourceSpan {
        self.sources
    }
}

impl fmt::Debug for SemanticExtractedTextList {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("SemanticExtractedTextList")
            .field("items", &self.items.len())
            .field("sources", &self.sources.len)
            .finish()
    }
}

/// One record with independently cited, schema-ordered fields.
#[derive(Eq, PartialEq)]
pub struct SemanticExtractedRow {
    fields: Vec<SemanticExtractedField>,
}
impl SemanticExtractedRow {
    /// Validated fields; absent optional fields remain absent.
    pub fn fields(&self) -> &[SemanticExtractedField] {
        &self.fields
    }
}
impl fmt::Debug for SemanticExtractedRow {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("SemanticExtractedRow")
            .field("fields", &self.fields.len())
            .finish()
    }
}

/// Bounded record collection; collection completeness remains in the read evidence.
#[derive(Eq, PartialEq)]
pub struct SemanticExtractedRows {
    items: Vec<SemanticExtractedRow>,
}
impl SemanticExtractedRows {
    /// Records in the observed/model-mapped order.
    pub fn items(&self) -> &[SemanticExtractedRow] {
        &self.items
    }
}
impl fmt::Debug for SemanticExtractedRows {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("SemanticExtractedRows")
            .field("items", &self.items.len())
            .finish()
    }
}

/// One closed admitted extraction value.
#[derive(Eq, PartialEq)]
pub enum SemanticExtractedValue {
    /// Record collection with field-level provenance.
    Rows(SemanticExtractedRows),
    /// Bounded text scalar.
    Text(SemanticExtractedText),
    /// Exact observed URL; historical data, never navigation authority.
    Url(SemanticExtractedText),
    /// Exact observed image URL, without fetch or navigation authority.
    ImageUrl(SemanticExtractedText),
    /// Source-backed decimal amount and currency.
    Money(SemanticExtractedMoney),
    /// Boolean scalar.
    Boolean(SemanticExtractedBoolean),
    /// Unsigned integer scalar.
    Unsigned(SemanticExtractedUnsigned),
    /// Bounded text list.
    TextList(SemanticExtractedTextList),
}

impl SemanticExtractedValue {
    /// Closed admitted value shape.
    pub const fn kind(&self) -> SemanticExtractionValueKind {
        match self {
            Self::Text(_) => SemanticExtractionValueKind::Text,
            Self::Url(_) => SemanticExtractionValueKind::Url,
            Self::ImageUrl(_) => SemanticExtractionValueKind::ImageUrl,
            Self::Money(_) => SemanticExtractionValueKind::Money,
            Self::Boolean(_) => SemanticExtractionValueKind::Boolean,
            Self::Unsigned(_) => SemanticExtractionValueKind::Unsigned,
            Self::TextList(_) => SemanticExtractionValueKind::TextList,
            Self::Rows(_) => SemanticExtractionValueKind::Rows,
        }
    }
}

impl fmt::Debug for SemanticExtractedValue {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Text(value) | Self::Url(value) | Self::ImageUrl(value) => value.fmt(formatter),
            Self::Boolean(value) => value.fmt(formatter),
            Self::Unsigned(value) => value.fmt(formatter),
            Self::Money(value) => value.fmt(formatter),
            Self::TextList(value) => value.fmt(formatter),
            Self::Rows(value) => value.fmt(formatter),
        }
    }
}

/// One schema-ordered admitted extraction field.
#[derive(Eq, PartialEq)]
pub struct SemanticExtractedField {
    name: String,
    value: SemanticExtractedValue,
}

impl SemanticExtractedField {
    /// Exact trusted schema field name.
    pub fn name(&self) -> &str {
        &self.name
    }

    /// Admitted closed value.
    pub const fn value(&self) -> &SemanticExtractedValue {
        &self.value
    }
}

impl fmt::Debug for SemanticExtractedField {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("SemanticExtractedField")
            .field("name", &"[redacted]")
            .field("kind", &self.value.kind())
            .finish()
    }
}

/// Content-free aggregate extraction admission metrics.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct SemanticExtractionStats {
    fields: u8,
    values: u16,
    text_bytes: u32,
    source_edges: u16,
    sensitive_source_edges: u16,
    dropped: u16,
}

impl SemanticExtractionStats {
    /// Records and optional record fields left out because their own
    /// evidence did not hold; the rest of the extraction stands.
    pub const fn dropped(self) -> u16 {
        self.dropped
    }

    /// Admitted output fields.
    pub const fn fields(self) -> u8 {
        self.fields
    }

    /// Admitted scalar and list-item values.
    pub const fn values(self) -> u16 {
        self.values
    }

    /// Aggregate UTF-8 bytes retained in model-mapped text.
    pub const fn text_bytes(self) -> u32 {
        self.text_bytes
    }

    /// Aggregate committed-read provenance edges.
    pub const fn source_edges(self) -> u16 {
        self.source_edges
    }

    /// Provenance edges citing policy-admitted sensitive fragments.
    pub const fn sensitive_source_edges(self) -> u16 {
        self.sensitive_source_edges
    }
}

/// Validated structured mapping over one exact committed semantic read.
pub struct SemanticExtractionResult<'a> {
    media_diagnostics: crate::SemanticRecordMediaDiagnostics,
    media: Vec<crate::SemanticRecordMediaPlan>,
    page_title: Option<String>,
    schema: SemanticExtractionSchemaId,
    observation: SemanticObservationId,
    observation_generation: SemanticObservationGeneration,
    captured_at: SemanticCaptureInstant,
    fields: Vec<SemanticExtractedField>,
    sources: Vec<SemanticExtractionSource<'a>>,
    stats: SemanticExtractionStats,
    guard: [u8; 32],
    read_omissions: crate::SemanticReadOmissions,
    read_stats: crate::SemanticReadStats,
    #[cfg(feature = "provider-transport")]
    read_guard: [u8; 32],
    #[cfg(feature = "provider-transport")]
    schema_guard: [u8; 32],
}

impl<'a> SemanticExtractionResult<'a> {
    #[cfg(feature = "provider-transport")]
    pub(crate) fn matches_input(
        &self,
        schema: &SemanticExtractionSchema,
        read: &SemanticReadResult<'_>,
    ) -> bool {
        self.read_guard == read.guard()
            && self.schema_guard == crate::semantic_extract_model::extraction_schema_guard(schema)
    }
    /// Exact source-read omissions, never a whole-document completeness claim.
    pub const fn read_omissions(&self) -> crate::SemanticReadOmissions {
        self.read_omissions
    }
    /// The mapping admitted nothing: no scalar value and no record.
    pub fn is_empty(&self) -> bool {
        self.fields.iter().all(|field| match field.value() {
            SemanticExtractedValue::Rows(rows) => rows.items().is_empty(),
            _ => false,
        })
    }
    /// Original delivered-read counts, including uncited admitted fragments.
    pub const fn read_stats(&self) -> crate::SemanticReadStats {
        self.read_stats
    }
    /// Moves validated fields into one bounded owned result, retaining each
    /// cited source fragment once. This is model-mapped data, never authority.
    pub fn into_owned(self) -> Result<SemanticOwnedExtractionResult, SemanticExtractionError> {
        let mut sources: Vec<SemanticOwnedExtractionSource> = Vec::new();
        let mut edges = Vec::new();
        edges
            .try_reserve_exact(self.sources.len())
            .map_err(|_| SemanticExtractionError::Invariant)?;
        for source in self.sources {
            let fragment = source.fragment();
            let index =
                if let Some(index) = sources.iter().position(|source| source.id == fragment.id()) {
                    index
                } else {
                    let provenance = fragment.provenance();
                    let content = match fragment.content() {
                        crate::SemanticReadContent::Text(value) => {
                            SemanticOwnedReadContent::Text(value.as_str().to_owned())
                        }
                        crate::SemanticReadContent::ValuePreview(value) => {
                            SemanticOwnedReadContent::ValuePreview {
                                text: value.text().to_owned(),
                                source_bytes: value.source_bytes(),
                                truncated: value.truncated(),
                            }
                        }
                        crate::SemanticReadContent::Boolean(value) => {
                            SemanticOwnedReadContent::Boolean(value)
                        }
                        crate::SemanticReadContent::Ordinal(value) => {
                            SemanticOwnedReadContent::Ordinal(value)
                        }
                    };
                    sources
                        .try_reserve(1)
                        .map_err(|_| SemanticExtractionError::Invariant)?;
                    sources.push(SemanticOwnedExtractionSource {
                        fields_complete: provenance.fields_complete(),
                        id: fragment.id(),
                        field: fragment.field(),
                        role: fragment.role(),
                        frame: provenance.frame().clone(),
                        observation: provenance.observation(),
                        observation_generation: provenance.observation_generation(),
                        captured_at: provenance.captured_at(),
                        invocation: provenance.invocation(),
                        snapshot: provenance.snapshot(),
                        reference: provenance.reference(),
                        sensitivity: provenance.sensitivity(),
                        trust: provenance.trust(),
                        content,
                    });
                    sources.len() - 1
                };
            edges.push(u16::try_from(index).map_err(|_| SemanticExtractionError::Invariant)?);
        }
        Ok(SemanticOwnedExtractionResult {
            media_diagnostics: self.media_diagnostics,
            media: self.media,
            page_title: self.page_title,
            schema: self.schema,
            observation: self.observation,
            observation_generation: self.observation_generation,
            captured_at: self.captured_at,
            fields: self.fields,
            sources,
            edges,
            stats: self.stats,
            guard: self.guard,
            read_omissions: self.read_omissions,
            read_stats: self.read_stats,
        })
    }
    /// Exact trusted schema used to validate this result.
    pub const fn schema(&self) -> SemanticExtractionSchemaId {
        self.schema
    }

    /// Terminal read baseline identity. Each source retains its own observation.
    pub const fn observation(&self) -> SemanticObservationId {
        self.observation
    }

    /// Terminal read baseline generation; source generations may be historical.
    pub const fn observation_generation(&self) -> SemanticObservationGeneration {
        self.observation_generation
    }

    /// Terminal read baseline capture time; each source keeps its original time.
    pub const fn captured_at(&self) -> SemanticCaptureInstant {
        self.captured_at
    }

    /// Untrusted model-mapping trust class.
    pub const fn trust(&self) -> SemanticExtractionTrust {
        SemanticExtractionTrust::ModelMapped
    }

    /// Schema-ordered fields present in this result.
    pub fn fields(&self) -> &[SemanticExtractedField] {
        &self.fields
    }

    /// Resolves an opaque value span to its exact cited read fragments.
    pub fn sources(
        &self,
        span: SemanticExtractionSourceSpan,
    ) -> Option<&[SemanticExtractionSource<'a>]> {
        if span.result_guard != self.guard {
            return None;
        }
        let start = usize::from(span.start);
        let end = start.checked_add(usize::from(span.len))?;
        self.sources.get(start..end)
    }

    /// Content-free aggregate admission metrics.
    pub const fn stats(&self) -> SemanticExtractionStats {
        self.stats
    }
}

/// Bounded copied source primitive. It is hostile page data, not an instruction.
pub enum SemanticOwnedReadContent {
    /// Exact bounded, secret-filtered source text.
    Text(String),
    /// A truthful truncated form-value preview, never a recovered full value.
    ValuePreview {
        /// Retained preview only.
        text: String,
        /// Original UTF-8 size reported by the safe projection.
        source_bytes: usize,
        /// Whether the full source was omitted.
        truncated: bool,
    },
    /// Source Boolean.
    Boolean(bool),
    /// Source bounded ordinal.
    Ordinal(u16),
}

/// Owned provenance and one deduplicated safe source quote. No live ref authority.
pub struct SemanticOwnedExtractionSource {
    /// Native evidence that the source node fields were not clipped.
    pub fields_complete: bool,
    /// Historical source observation, independent of the terminal baseline.
    pub observation: SemanticObservationId,
    /// Historical source observation generation.
    pub observation_generation: SemanticObservationGeneration,
    /// Original source capture time, never refreshed by extraction.
    pub captured_at: SemanticCaptureInstant,
    /// Read-local non-actionable fragment identity.
    pub id: SemanticReadFragmentId,
    /// Source semantic field.
    pub field: crate::SemanticReadField,
    /// Source semantic role.
    pub role: crate::SemanticRole,
    /// Historical context/document/frame/origin identity; never a live capability.
    pub frame: crate::SemanticFrameJoin,
    /// Historical invocation identity.
    pub invocation: crate::SemanticInvocationId,
    /// Historical snapshot identity.
    pub snapshot: crate::SemanticSnapshotGeneration,
    /// Historical opaque reference; never reusable for execution.
    pub reference: crate::SemanticReferenceId,
    /// Independently projected source sensitivity.
    pub sensitivity: SemanticSensitivity,
    /// Independently projected hostile/source trust class.
    pub trust: crate::SemanticTrust,
    /// Safe source quote or primitive.
    pub content: SemanticOwnedReadContent,
}

/// Owned, source-carrying mapping after exact provider output admission.
/// Its only constructor consumes the validated result. It is not policy,
/// task-completion, persistence or independent factual-verification proof.
pub struct SemanticOwnedExtractionResult {
    media_diagnostics: crate::SemanticRecordMediaDiagnostics,
    media: Vec<crate::SemanticRecordMediaPlan>,
    page_title: Option<String>,
    schema: SemanticExtractionSchemaId,
    observation: SemanticObservationId,
    observation_generation: SemanticObservationGeneration,
    captured_at: SemanticCaptureInstant,
    fields: Vec<SemanticExtractedField>,
    sources: Vec<SemanticOwnedExtractionSource>,
    edges: Vec<u16>,
    stats: SemanticExtractionStats,
    guard: [u8; 32],
    read_omissions: crate::SemanticReadOmissions,
    read_stats: crate::SemanticReadStats,
}

impl SemanticOwnedExtractionResult {
    /// Carries the live original controller's existing screenshot permission
    /// into local-only record plans before actor closure. No model/image data
    /// or native request can call this through a serialized interface.
    #[allow(clippy::too_many_arguments)]
    pub fn carry_record_crop_permission(
        &mut self,
        config: &crate::AgentProviderCallConfig,
        policy: &crate::AgentRunPolicy,
        lease: crate::AgentPlanLeaseBinding,
        remaining_native_actions: u64,
        original_account: crate::AgentContextAccountBinding,
        current_account: crate::AgentContextAccountBinding,
        observation: &crate::SemanticObservation,
        acknowledgement: &crate::SemanticObservationAcknowledgement,
        now: std::time::Instant,
        expires: std::time::Instant,
    ) -> bool {
        for plan in &mut self.media {
            plan.crop = None;
        }
        let context = observation.request().context();
        let remaining = policy
            .remaining_operations(lease.lease())
            .ok()
            .unwrap_or(0)
            .min(12)
            .min(remaining_native_actions.min(12) as u32) as u8;
        let admitted_source = policy.taints().iter().any(|cohort| {
            cohort.context() == context
                && cohort.account() == original_account.account()
                && cohort.observation() == observation.request().id()
                && cohort.observation_generation() == observation.request().generation()
        });
        let screenshot_scope = policy.permits_screenshot_sensitivity(lease.lease());
        if !screenshot_scope
            || !acknowledgement.matches(observation)
            || policy.is_sealed()
            || policy.pending_model_calls() != 0
            || policy.pending_effects() != 0
            || remaining == 0
            || !admitted_source
        {
            return false;
        }

        let Some(mut permit) = crate::semantic_media::SemanticRecordCropPermit::admit(
            observation.request().context(),
            original_account,
            current_account,
            config.permits_viewport_screenshot(),
            now,
            expires,
        ) else {
            return false;
        };
        permit.remaining = std::sync::Arc::new(std::sync::atomic::AtomicU8::new(remaining));
        for plan in &mut self.media {
            if plan.frame.context() == permit.context {
                plan.crop = Some(permit.for_record());
            }
        }
        self.media.iter().any(|plan| plan.crop.is_some())
    }
    /// Closed source-stage counters; never model input or archived result data.
    pub fn media_diagnostics(&self) -> crate::SemanticRecordMediaDiagnostics {
        self.media_diagnostics
    }
    /// Exact original native plans; no inferred image locations.
    pub fn media(&self) -> &[crate::SemanticRecordMediaPlan] {
        &self.media
    }

    /// Public document title observed by the terminal read, never model output.
    pub fn page_title(&self) -> Option<&str> {
        self.page_title.as_deref()
    }
    /// Exact source-read omissions. Empty does not certify whole-document coverage
    /// or factual correctness: only the admitted bounded projection was read.
    pub const fn read_omissions(&self) -> crate::SemanticReadOmissions {
        self.read_omissions
    }
    /// Counts for the original delivered read, not only the cited subset.
    pub const fn read_stats(&self) -> crate::SemanticReadStats {
        self.read_stats
    }
    pub(crate) fn evidence_sources(&self) -> &[SemanticOwnedExtractionSource] {
        &self.sources
    }
    pub(crate) const fn evidence_guard(&self) -> [u8; 32] {
        self.guard
    }
    /// Trusted schema identity.
    pub const fn schema(&self) -> SemanticExtractionSchemaId {
        self.schema
    }
    /// Historical terminal read baseline; source observations are per-source.
    pub const fn observation(&self) -> SemanticObservationId {
        self.observation
    }
    /// Historical terminal read baseline generation.
    pub const fn observation_generation(&self) -> SemanticObservationGeneration {
        self.observation_generation
    }
    /// Terminal read baseline capture time; inspect sources for original times.
    pub const fn captured_at(&self) -> SemanticCaptureInstant {
        self.captured_at
    }
    /// Explicitly unverified model-mapping classification.
    pub const fn trust(&self) -> SemanticExtractionTrust {
        SemanticExtractionTrust::ModelMapped
    }
    /// Validated schema-ordered fields.
    pub fn fields(&self) -> &[SemanticExtractedField] {
        &self.fields
    }
    /// Content-free result bounds.
    pub const fn stats(&self) -> SemanticExtractionStats {
        self.stats
    }
    /// Exact quoted sources for this result's value span; foreign spans fail.
    pub fn sources(
        &self,
        span: SemanticExtractionSourceSpan,
    ) -> Option<impl Iterator<Item = &SemanticOwnedExtractionSource>> {
        if span.result_guard != self.guard {
            return None;
        }
        let start = usize::from(span.start);
        let end = start.checked_add(usize::from(span.len))?;
        Some(
            self.edges
                .get(start..end)?
                .iter()
                .filter_map(|index| self.sources.get(usize::from(*index))),
        )
    }
}

impl fmt::Debug for SemanticOwnedExtractionResult {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("SemanticOwnedExtractionResult")
            .field("trust", &self.trust())
            .field("stats", &self.stats)
            .field("content", &"[redacted]")
            .finish()
    }
}

impl fmt::Debug for SemanticExtractionResult<'_> {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("SemanticExtractionResult")
            .field("schema", &self.schema)
            .field("observation", &self.observation)
            .field("observation_generation", &self.observation_generation)
            .field("captured_at", &self.captured_at)
            .field("trust", &SemanticExtractionTrust::ModelMapped)
            .field("stats", &self.stats)
            .finish()
    }
}

/// Closed refusal from hostile model-output extraction admission.
#[derive(Clone, Copy, Debug, Eq, Error, PartialEq)]
pub enum SemanticExtractionError {
    /// A copy-only cell differed from its one complete cited text fragment.
    #[error("verbatim extraction source mismatch")]
    VerbatimMismatch,
    /// The exact source read was not committed to the model transport.
    #[error("semantic extraction source read was not delivered")]
    ReadNotDelivered,
    /// Hostile model output exceeded the pre-decode byte ceiling.
    #[error("semantic extraction input byte ceiling exceeded")]
    InputLimit,
    /// JSON shape, duplicate keys, type, or unknown fields were invalid.
    #[error("semantic extraction output is malformed")]
    Malformed,
    /// Model-output grammar version did not exactly match.
    #[error("semantic extraction version mismatch")]
    VersionMismatch,
    /// Model output named a different schema, or source roles differed from
    /// the immutable trusted schema selection.
    #[error("semantic extraction schema identity mismatch")]
    SchemaMismatch,
    /// Output exceeded the fixed field ceiling.
    #[error("semantic extraction field ceiling exceeded")]
    FieldLimit,
    /// An output field name was not a bounded ASCII identifier.
    #[error("semantic extraction field name is invalid")]
    FieldName,
    /// An output field was duplicated.
    #[error("semantic extraction output field is duplicated")]
    DuplicateField,
    /// Output fields were not in trusted schema order.
    #[error("semantic extraction output field order is invalid")]
    FieldOrder,
    /// Output contained a field absent from the trusted schema.
    #[error("semantic extraction output field is unexpected")]
    UnexpectedField,
    /// Output omitted a required trusted schema field.
    #[error("semantic extraction required field is missing")]
    MissingRequiredField,
    /// Output value shape disagreed with the trusted field schema.
    #[error("semantic extraction value type mismatch")]
    TypeMismatch,
    /// Text exceeded its field, item, or result ceiling.
    #[error("semantic extraction text ceiling exceeded")]
    TextLimit,
    /// Text contained a forbidden control or invisible directional character.
    #[error("semantic extraction text is invalid")]
    InvalidText,
    /// Text matched a credential, token, authorization, or private-key form.
    #[error("semantic extraction secret-like value refused")]
    SecretValue,
    /// Unsigned output exceeded the trusted schema maximum.
    #[error("semantic extraction unsigned value exceeded schema")]
    UnsignedLimit,
    /// A list exceeded its trusted or process-wide item ceiling.
    #[error("semantic extraction list ceiling exceeded")]
    ListLimit,
    /// Aggregate primitive values exceeded the process-wide ceiling.
    #[error("semantic extraction value ceiling exceeded")]
    ValueLimit,
    /// Per-value or aggregate provenance edges exceeded a fixed ceiling.
    #[error("semantic extraction source ceiling exceeded")]
    SourceLimit,
    /// A provenance token was not the exact canonical `@rN` form.
    #[error("semantic extraction source token is invalid")]
    SourceInvalid,
    /// One record combined sources from different observed cards in the same capture.
    #[error("semantic extraction crossed record boundaries")]
    RecordBoundary,
    /// Provenance tokens were duplicated or not strictly increasing.
    #[error("semantic extraction source order is invalid")]
    SourceOrder,
    /// A provenance token did not resolve in the exact delivered read.
    #[error("semantic extraction source is missing")]
    SourceMissing,
    /// Cited evidence exceeded the trusted sensitivity allowance.
    #[error("semantic extraction source sensitivity refused")]
    Sensitivity,
    /// An internal bounded representation could not be formed.
    #[error("semantic extraction internal invariant failed")]
    Invariant,
}

/// Whether a second mapping told why the first was refused can succeed: the
/// output itself was unusable, not the read, the delivery or a secret.
pub const fn semantic_extraction_refusal_is_retryable(error: SemanticExtractionError) -> bool {
    !matches!(
        error,
        SemanticExtractionError::ReadNotDelivered
            | SemanticExtractionError::Invariant
            | SemanticExtractionError::SecretValue
            | SemanticExtractionError::Sensitivity
    )
}

/// Told to a mapper whose first mapping admitted no record at all.
pub const SEMANTIC_EXTRACTION_EMPTY_NOTE: &str = "Your previous mapping returned no records and no values, but the browsing model extracted because this evidence answers the request. Map what the evidence supports: for a request about one thing (a function, a product, a page), one record naming it with the details the evidence states; for a list, each record the evidence shows. Cite each value's own fragments. Return no records only if nothing in the evidence relates to the request.";

/// Trusted, content-free text telling the mapper why Rust refused its last
/// output, for the one corrective mapping call.
pub fn semantic_extraction_refusal_note(error: SemanticExtractionError) -> String {
    let reason = match error {
        SemanticExtractionError::Malformed
        | SemanticExtractionError::VersionMismatch
        | SemanticExtractionError::SchemaMismatch
        | SemanticExtractionError::FieldName
        | SemanticExtractionError::FieldOrder
        | SemanticExtractionError::UnexpectedField
        | SemanticExtractionError::TypeMismatch => {
            "the output did not follow the envelope. Return exactly {\"v\":1,\"schema\":<schema id>,\"fields\":[{\"name\":<S-line name>,\"value\":{\"k\":<S-line kind>,...}}]}; for rows, value is {\"k\":\"rows\",\"items\":[{\"fields\":[...]}]}; every text value has a value string and a sources array"
        }
        SemanticExtractionError::RecordBoundary => {
            "one record mixed values from different cards. Keep every record's name, price, link and image inside the same observed record boundary; page-wide search settings may be shared. Correct the row rather than guessing a link"
        }
        SemanticExtractionError::DuplicateField => {
            "a record repeated a column, so record boundaries are ambiguous. Put every record in its own items entry, with each declared column appearing at most once in that entry's fields. Do not flatten several records into one fields array; keep each value with its own sources"
        }
        SemanticExtractionError::MissingRequiredField => {
            "a required field, or every record's required field, was missing or had no admissible evidence. Give each required field a value cited from a fragment that shows it"
        }
        SemanticExtractionError::SourceInvalid | SemanticExtractionError::VerbatimMismatch => {
            "a cited fragment did not show its value. A url cites the link's own link_destination fragment, an image_url its image_source fragment, money the fragment showing that amount with its currency, and copied text exactly one fragment"
        }
        SemanticExtractionError::SourceMissing
        | SemanticExtractionError::SourceLimit
        | SemanticExtractionError::SourceOrder => {
            "a value cited no delivered @rN fragment. Cite one to four exact @rN tokens from the EVIDENCE for each value, and leave out values the evidence does not show"
        }
        SemanticExtractionError::TextLimit
        | SemanticExtractionError::InputLimit
        | SemanticExtractionError::ListLimit
        | SemanticExtractionError::ValueLimit
        | SemanticExtractionError::FieldLimit
        | SemanticExtractionError::UnsignedLimit => {
            "the output exceeded a limit. Keep each value within its S-line bounds and return fewer, shorter records"
        }
        SemanticExtractionError::InvalidText => {
            "a text value held control or invisible characters. Use single-line printable text"
        }
        SemanticExtractionError::ReadNotDelivered
        | SemanticExtractionError::Invariant
        | SemanticExtractionError::SecretValue
        | SemanticExtractionError::Sensitivity => {
            "a value was not admissible. Leave out values that are secrets or private"
        }
    };
    format!(
        "PREVIOUS_MAPPING_REFUSED code={error:?}: {reason}. Map the same ZEXTRACT input again; this is the last attempt."
    )
}

/// Validates hostile structured model output against one exact delivered read.
pub fn extract_semantic_read<'a>(
    schema: &SemanticExtractionSchema,
    read: &SemanticReadResult<'a>,
    delivery: &SemanticReadDeliveryReceipt,
    sensitivity_limit: SemanticReadSensitivityLimit,
    model_output: &[u8],
) -> Result<SemanticExtractionResult<'a>, SemanticExtractionError> {
    if !delivery.matches_read(read) {
        return Err(SemanticExtractionError::ReadNotDelivered);
    }
    extract_semantic_read_inner(schema, read, sensitivity_limit, model_output)
}

/// Validates model output from one exact purpose-bound extraction request.
pub fn extract_delivered_semantic_read<'a>(
    schema: &SemanticExtractionSchema,
    read: &SemanticReadResult<'a>,
    delivery: &SemanticExtractionDeliveryReceipt,
    sensitivity_limit: SemanticReadSensitivityLimit,
    model_output: &[u8],
) -> Result<SemanticExtractionResult<'a>, SemanticExtractionError> {
    if !delivery.matches(schema, read) {
        return Err(SemanticExtractionError::ReadNotDelivered);
    }
    extract_semantic_read_inner(schema, read, sensitivity_limit, model_output)
}

pub(crate) fn extract_semantic_read_inner<'a>(
    schema: &SemanticExtractionSchema,
    read: &SemanticReadResult<'a>,
    sensitivity_limit: SemanticReadSensitivityLimit,
    model_output: &[u8],
) -> Result<SemanticExtractionResult<'a>, SemanticExtractionError> {
    if schema.source_roles() != read.source_roles() || schema.url_sources() != read.url_sources() {
        return Err(SemanticExtractionError::SchemaMismatch);
    }
    if model_output.len() > MAX_SEMANTIC_EXTRACTION_INPUT_BYTES {
        return Err(SemanticExtractionError::InputLimit);
    }
    let result_guard = extraction_result_guard(schema.id(), read, sensitivity_limit, model_output);
    let normalized =
        crate::semantic_extract_repair::normalize_extraction_output(schema, model_output)
            .ok_or(SemanticExtractionError::Malformed)?;
    if normalized.ambiguous_records {
        return Err(SemanticExtractionError::DuplicateField);
    }
    let raw: RawExtraction =
        serde_json::from_value(normalized.value).map_err(|_| SemanticExtractionError::Malformed)?;
    if raw.version != SEMANTIC_EXTRACTION_SCHEMA_VERSION {
        return Err(SemanticExtractionError::VersionMismatch);
    }
    if raw.schema != schema.id().get() {
        return Err(SemanticExtractionError::SchemaMismatch);
    }
    if raw.fields.len() > MAX_SEMANTIC_EXTRACTION_FIELDS {
        return Err(SemanticExtractionError::FieldLimit);
    }

    let mut sources = Vec::new();
    let mut counters = ExtractionCounters::new(result_guard);
    counters.dropped = normalized.dropped;
    let fields = admit_fields(
        schema.fields(),
        raw.fields,
        read,
        sensitivity_limit,
        &mut sources,
        &mut counters,
        false,
    )?;

    #[cfg(feature = "probe-harness")]
    let media_probe = crate::semantic_media_probe::observer();
    #[cfg(feature = "probe-harness")]
    let mut media_probe_sources = Vec::new();
    #[cfg(feature = "probe-harness")]
    let mut media_probe_incomplete = false;
    let mut media = Vec::new();
    let mut media_diagnostics = read.media_diagnostics();
    let mut record = 0u16;
    for field in &fields {
        if let SemanticExtractedValue::Rows(rows) = field.value() {
            for row in rows.items() {
                #[cfg(feature = "probe-harness")]
                if media_probe.is_some() && media.len() >= 12 {
                    media_probe_incomplete = true;
                }
                if media.len() < 12 {
                    if let Some(SemanticExtractedValue::Text(name)) =
                        row.fields().first().map(SemanticExtractedField::value)
                    {
                        let span = name.source_span();
                        let identity = sources[usize::from(span.start)
                            ..usize::from(span.start) + usize::from(span.len)]
                            .iter()
                            .map(|source| source.fragment().id())
                            .collect::<Vec<_>>();
                        let identity = read.record_identity_sources(&identity);
                        #[cfg(feature = "probe-harness")]
                        if media_probe.is_some() {
                            for id in &identity {
                                if media_probe_sources.len() >= 128 {
                                    media_probe_incomplete = true;
                                    break;
                                }
                                if let Some(source) = read.media_probe_source(record, *id) {
                                    media_probe_sources.push(source);
                                } else {
                                    media_probe_incomplete = true;
                                }
                            }
                        }
                        read.count_media_relations(&identity, &mut media_diagnostics);
                        if let Some(plan) = read.media_for_record(record, &identity, result_guard) {
                            media.push(plan);
                        }
                    }
                }
                record = record.saturating_add(1);
            }
        }
    }
    let stats = SemanticExtractionStats {
        fields: u8::try_from(fields.len()).map_err(|_| SemanticExtractionError::Invariant)?,
        values: u16::try_from(counters.values).map_err(|_| SemanticExtractionError::Invariant)?,
        text_bytes: u32::try_from(counters.text_bytes)
            .map_err(|_| SemanticExtractionError::Invariant)?,
        source_edges: u16::try_from(sources.len())
            .map_err(|_| SemanticExtractionError::Invariant)?,
        sensitive_source_edges: u16::try_from(counters.sensitive_source_edges)
            .map_err(|_| SemanticExtractionError::Invariant)?,
        dropped: u16::try_from(counters.dropped).unwrap_or(u16::MAX),
    };
    #[cfg(feature = "probe-harness")]
    if let Some(observer) = media_probe {
        observer(&media_probe_sources, media_probe_incomplete);
    }
    Ok(SemanticExtractionResult {
        media_diagnostics,
        media,
        page_title: read.page_title().map(str::to_owned),
        schema: schema.id(),
        observation: read.observation(),
        observation_generation: read.observation_generation(),
        captured_at: read.captured_at(),
        fields,
        sources,
        stats,
        guard: result_guard,
        read_omissions: read.omissions(),
        read_stats: read.stats(),
        #[cfg(feature = "provider-transport")]
        read_guard: read.guard(),
        #[cfg(feature = "provider-transport")]
        schema_guard: crate::semantic_extract_model::extraction_schema_guard(schema),
    })
}

struct RecordIdentity {
    name: String,
    sources: Vec<SemanticReadFragmentId>,
}

/// `record`: the fields of one row, where an optional field whose own
/// evidence fails is left out instead of failing the record.
fn admit_fields<'a>(
    schemas: &[SemanticExtractionFieldSchema],
    raw_fields: Vec<RawField>,
    read: &SemanticReadResult<'a>,
    sensitivity_limit: SemanticReadSensitivityLimit,
    sources: &mut Vec<SemanticExtractionSource<'a>>,
    counters: &mut ExtractionCounters,
    record: bool,
) -> Result<Vec<SemanticExtractedField>, SemanticExtractionError> {
    if raw_fields.len() > MAX_SEMANTIC_EXTRACTION_FIELDS {
        return Err(SemanticExtractionError::FieldLimit);
    }
    let mut names = BTreeSet::new();
    for field in &raw_fields {
        validate_field_name(&field.name).map_err(|_| SemanticExtractionError::FieldName)?;
        if !names.insert(field.name.as_str()) {
            return Err(SemanticExtractionError::DuplicateField);
        }
    }

    let mut present = vec![false; schemas.len()];
    let mut previous_schema_index = None;
    // Keep exact name provenance for native card-to-image association. A
    // model's copied name or picture label never creates that relationship.
    let mut subject: Option<RecordIdentity> = None;
    let mut fields = Vec::with_capacity(raw_fields.len());
    for raw_field in raw_fields {
        let Some(schema_index) = schemas
            .iter()
            .position(|field| field.name() == raw_field.name)
        else {
            return Err(SemanticExtractionError::UnexpectedField);
        };
        if previous_schema_index.is_some_and(|previous| schema_index <= previous) {
            return Err(SemanticExtractionError::FieldOrder);
        }
        previous_schema_index = Some(schema_index);
        let field_schema = &schemas[schema_index];
        let kept = (sources.len(), counters.clone());
        let value = match admit_value(
            field_schema,
            raw_field.value,
            read,
            sensitivity_limit,
            sources,
            counters,
            subject.as_ref(),
        ) {
            Ok(value) => value,
            // An optional value whose own evidence fails is left out, at the
            // top level as in a record; what is kept holds every limit.
            Err(error) if !field_schema.required() && droppable(error) => {
                sources.truncate(kept.0);
                *counters = kept.1;
                counters.dropped += 1;
                continue;
            }
            Err(error) => return Err(error),
        };
        present[schema_index] = true;
        if record && subject.is_none() {
            if let SemanticExtractedValue::Text(text) = &value {
                let span = text.source_span();
                subject = Some(RecordIdentity {
                    name: text.as_str().to_owned(),
                    sources: read.record_identity_sources(
                        &sources[usize::from(span.start)
                            ..(usize::from(span.start) + usize::from(span.len))]
                            .iter()
                            .map(|source| source.fragment().id())
                            .collect::<Vec<_>>(),
                    ),
                });
            }
        }
        fields.push(SemanticExtractedField {
            name: field_schema.name().to_owned(),
            value,
        });
    }
    // Missing pictures use exact native ancestry; ordinary link repair keeps
    // its existing evidence rules. Both copy only real cited source values.
    if let Some(subject) = subject.as_ref().filter(|_| record) {
        for (index, field_schema) in schemas.iter().enumerate() {
            let (field, max_bytes) = match (&field_schema.spec, present[index]) {
                (SemanticExtractionFieldSpec::Url { max_bytes }, false)
                    if !field_schema.document_address() =>
                {
                    (crate::SemanticReadField::LinkDestination, *max_bytes)
                }
                (SemanticExtractionFieldSpec::ImageUrl { max_bytes }, false) => {
                    (crate::SemanticReadField::ImageSource, *max_bytes)
                }
                _ => continue,
            };
            let Ok((value, token)) = resolve_source_url(None, &[], read, field, Some(subject))
            else {
                continue;
            };
            let kept = (sources.len(), counters.clone());
            match admit_text(
                value,
                max_bytes,
                vec![token],
                read,
                sensitivity_limit,
                sources,
                counters,
            ) {
                Ok(text) => {
                    present[index] = true;
                    fields.push(SemanticExtractedField {
                        name: field_schema.name().to_owned(),
                        value: if field == crate::SemanticReadField::LinkDestination {
                            SemanticExtractedValue::Url(text)
                        } else {
                            SemanticExtractedValue::ImageUrl(text)
                        },
                    });
                }
                Err(_) => {
                    sources.truncate(kept.0);
                    *counters = kept.1;
                }
            }
        }
        fields.sort_by_key(|field| {
            schemas
                .iter()
                .position(|schema| schema.name() == field.name)
        });
    }
    if schemas
        .iter()
        .zip(present)
        .any(|(field, present)| field.required() && !present)
    {
        return Err(SemanticExtractionError::MissingRequiredField);
    }

    Ok(fields)
}

fn validate_record_sources(
    sources: &[SemanticExtractionSource<'_>],
) -> Result<(), SemanticExtractionError> {
    for (index, source) in sources.iter().enumerate() {
        let fragment = source.fragment();
        let Some(root) = fragment.record_root() else {
            continue;
        };
        let provenance = fragment.provenance();
        for other in &sources[..index] {
            let other = other.fragment();
            if other
                .record_root()
                .is_some_and(|other_root| other_root != root)
                && other.provenance().frame() == provenance.frame()
                && other.provenance().observation() == provenance.observation()
                && other.provenance().snapshot() == provenance.snapshot()
            {
                return Err(SemanticExtractionError::RecordBoundary);
            }
        }
    }
    Ok(())
}

#[derive(Clone)]
struct ExtractionCounters {
    values: usize,
    text_bytes: usize,
    sensitive_source_edges: usize,
    dropped: usize,
    result_guard: [u8; 32],
}

impl ExtractionCounters {
    const fn new(result_guard: [u8; 32]) -> Self {
        Self {
            values: 0,
            text_bytes: 0,
            sensitive_source_edges: 0,
            dropped: 0,
            result_guard,
        }
    }
}

/// A record or record field whose own value or evidence failed: every limit
/// still holds for what is kept, and the failure stays with that record.
const fn droppable(error: SemanticExtractionError) -> bool {
    !matches!(
        error,
        SemanticExtractionError::Invariant | SemanticExtractionError::ReadNotDelivered
    )
}

#[allow(clippy::too_many_arguments)]
fn admit_value<'a>(
    field: &SemanticExtractionFieldSchema,
    raw: RawValue,
    read: &SemanticReadResult<'a>,
    sensitivity_limit: SemanticReadSensitivityLimit,
    sources: &mut Vec<SemanticExtractionSource<'a>>,
    counters: &mut ExtractionCounters,
    subject: Option<&RecordIdentity>,
) -> Result<SemanticExtractedValue, SemanticExtractionError> {
    match (&field.spec, raw) {
        (SemanticExtractionFieldSpec::Rows { fields, max_items }, RawValue::Rows { mut items }) => {
            if items.len() > *max_items {
                counters.dropped += items.len() - *max_items;
                items.truncate(*max_items);
            }
            let mut rows = Vec::with_capacity(items.len());
            let mut refused = None;
            #[cfg(feature = "probe-harness")]
            let proposed = items.len();
            for row in items {
                let kept = (sources.len(), counters.clone());
                let admitted = if row.fields.is_empty() {
                    Err(SemanticExtractionError::MissingRequiredField)
                } else {
                    admit_fields(
                        fields,
                        row.fields,
                        read,
                        sensitivity_limit,
                        sources,
                        counters,
                        true,
                    )
                };
                match admitted {
                    Ok(fields) if !fields.is_empty() => {
                        validate_record_sources(&sources[kept.0..])?;
                        rows.push(SemanticExtractedRow { fields });
                    }
                    Ok(_) => {
                        sources.truncate(kept.0);
                        *counters = kept.1;
                        counters.dropped += 1;
                    }
                    Err(error) if droppable(error) => {
                        sources.truncate(kept.0);
                        *counters = kept.1;
                        counters.dropped += 1;
                        refused.get_or_insert(error);
                    }
                    Err(error) => return Err(error),
                }
            }
            #[cfg(feature = "probe-harness")]
            crate::probe_evidence_path::trace(format_args!(
                "extract-rows: proposed={proposed} kept={} first_refusal={refused:?}",
                rows.len()
            ));
            // Records were given and none held: the extraction fails with
            // the first record's own reason.
            if let (true, Some(error)) = (rows.is_empty(), refused) {
                return Err(error);
            }
            Ok(SemanticExtractedValue::Rows(SemanticExtractedRows {
                items: rows,
            }))
        }
        (
            SemanticExtractionFieldSpec::Text { max_bytes },
            RawValue::Text {
                value,
                sources: raw_sources,
            },
        ) => {
            let raw_sources = resolvable_sources(raw_sources, read, sensitivity_limit);
            if field.verbatim_text() {
                // A copy is one cited fragment's whole text, or for a price
                // column one currency amount it shows; with several cited,
                // the one the copy matches.
                let cited: Vec<(&String, &str)> = raw_sources
                    .iter()
                    .filter_map(|token| {
                        SemanticReadFragmentId::parse_model_token(token)
                            .and_then(|id| read.fragment(id))
                            .and_then(|fragment| fragment.verbatim_text())
                            .map(|exact| (token, exact))
                    })
                    .collect();
                // A value read from the attached viewport image has no text
                // to copy: the model's reading stands, cited to the image.
                let pixels = raw_sources.iter().find(|token| {
                    SemanticReadFragmentId::parse_model_token(token)
                        .and_then(|id| read.fragment(id))
                        .is_some_and(|fragment| {
                            fragment.field() == crate::SemanticReadField::ViewportImage
                        })
                });
                let (token, value) = match (value, pixels) {
                    (Some(value), Some(token)) if cited.is_empty() => (token, value),
                    (value, _) => match value {
                        None => match cited.as_slice() {
                            [] => return Err(SemanticExtractionError::VerbatimMismatch),
                            [(token, exact)] => (*token, field.verbatim_value(exact).to_owned()),
                            // A value the page splits across lines reads as one;
                            // a fragment another one already holds ("$2,658" beside
                            // "$2,658 monthly") is said once.
                            [(token, _), ..] => (*token, joined(&cited)),
                        },
                        Some(value) => {
                            let found = cited.iter().find(|(_, exact)| {
                                *exact == value
                                    || field.verbatim_value(exact) == value
                                    || (field.money_like()
                                        && crate::semantic_money::currency_amounts(exact)
                                            .contains(&value.as_str()))
                            });
                            let found = match found {
                                Some((token, _)) => Some((*token, value.clone())),
                                None => loose_copy(&cited, &value, !field.money_like()),
                            };
                            match found {
                                Some(found) => found,
                                // A price written with its label ("Price 806 zł")
                                // publishes the one amount it names, when the
                                // cited text shows that amount.
                                None => field
                                    .money_like()
                                    .then(|| crate::semantic_money::single_currency_amount(&value))
                                    .flatten()
                                    .and_then(|amount| {
                                        cited.iter().find_map(|(token, exact)| {
                                            crate::semantic_money::currency_amounts(exact)
                                                .contains(&amount)
                                                .then(|| (*token, amount.to_owned()))
                                        })
                                    })
                                    .ok_or(SemanticExtractionError::VerbatimMismatch)?,
                            }
                        }
                    },
                };
                return Ok(SemanticExtractedValue::Text(admit_text(
                    value,
                    *max_bytes,
                    vec![token.clone()],
                    read,
                    sensitivity_limit,
                    sources,
                    counters,
                )?));
            }
            // A value left out is the cited fragment's own text, copied by Rust.
            let value = match value {
                Some(value) => value,
                None => raw_sources
                    .iter()
                    .find_map(|token| {
                        SemanticReadFragmentId::parse_model_token(token)
                            .and_then(|id| read.fragment(id))
                            .and_then(|fragment| fragment.verbatim_text())
                    })
                    .map(|text| field.verbatim_value(text).to_owned())
                    .ok_or(SemanticExtractionError::Malformed)?,
            };
            let value = clip_text(&single_line_text(&value), *max_bytes);
            let raw_sources = cite_text(&value, raw_sources, read, sensitivity_limit);
            Ok(SemanticExtractedValue::Text(admit_text(
                value,
                *max_bytes,
                raw_sources,
                read,
                sensitivity_limit,
                sources,
                counters,
            )?))
        }
        (
            SemanticExtractionFieldSpec::Url { max_bytes },
            RawValue::Url {
                value,
                sources: raw_sources,
            },
        ) => {
            let (value, token) = resolve_source_url(
                value.as_deref(),
                &raw_sources,
                read,
                crate::SemanticReadField::LinkDestination,
                subject,
            )
            .or_else(|error| {
                if field.document_address() {
                    resolve_source_url(
                        None,
                        &[],
                        read,
                        crate::SemanticReadField::DocumentAddress,
                        None,
                    )
                } else {
                    Err(error)
                }
            })?;
            Ok(SemanticExtractedValue::Url(admit_text(
                value,
                *max_bytes,
                vec![token],
                read,
                sensitivity_limit,
                sources,
                counters,
            )?))
        }
        (
            SemanticExtractionFieldSpec::ImageUrl { max_bytes },
            RawValue::ImageUrl {
                value,
                sources: raw_sources,
            },
        ) => {
            let (value, token) = resolve_source_url(
                value.as_deref(),
                &raw_sources,
                read,
                crate::SemanticReadField::ImageSource,
                subject,
            )?;
            Ok(SemanticExtractedValue::ImageUrl(admit_text(
                value,
                *max_bytes,
                vec![token],
                read,
                sensitivity_limit,
                sources,
                counters,
            )?))
        }
        (
            SemanticExtractionFieldSpec::Money { currencies },
            RawValue::Money {
                amount,
                currency,
                sources: raw_sources,
            },
        ) => {
            if !currencies.contains(&currency) {
                return Err(SemanticExtractionError::SourceInvalid);
            }
            let raw_sources = resolvable_sources(raw_sources, read, sensitivity_limit);
            let token = money_source(&raw_sources, read, sensitivity_limit, &amount, &currency)
                .ok_or(SemanticExtractionError::SourceInvalid)?;
            let amount = admit_text(
                amount,
                24,
                vec![token],
                read,
                sensitivity_limit,
                sources,
                counters,
            )?;
            counters.text_bytes += currency.len();
            if counters.text_bytes > MAX_SEMANTIC_EXTRACTION_TOTAL_TEXT_BYTES {
                return Err(SemanticExtractionError::TextLimit);
            }
            Ok(SemanticExtractedValue::Money(SemanticExtractedMoney {
                amount,
                currency,
            }))
        }
        (
            SemanticExtractionFieldSpec::Boolean,
            RawValue::Boolean {
                value,
                sources: raw_sources,
            },
        ) => {
            add_value(counters)?;
            let raw_sources = resolvable_sources(raw_sources, read, sensitivity_limit);
            let source_span =
                admit_sources(raw_sources, read, sensitivity_limit, sources, counters)?;
            Ok(SemanticExtractedValue::Boolean(SemanticExtractedBoolean {
                value,
                sources: source_span,
            }))
        }
        (
            SemanticExtractionFieldSpec::Unsigned { maximum },
            RawValue::Unsigned {
                value,
                sources: raw_sources,
            },
        ) => {
            if value > *maximum {
                return Err(SemanticExtractionError::UnsignedLimit);
            }
            add_value(counters)?;
            let raw_sources = resolvable_sources(raw_sources, read, sensitivity_limit);
            let source_span =
                admit_sources(raw_sources, read, sensitivity_limit, sources, counters)?;
            Ok(SemanticExtractedValue::Unsigned(
                SemanticExtractedUnsigned {
                    value,
                    sources: source_span,
                },
            ))
        }
        (
            SemanticExtractionFieldSpec::TextList {
                max_items,
                max_item_bytes,
            },
            RawValue::TextList {
                mut items,
                sources: raw_sources,
            },
        ) => {
            let limit = (*max_items).min(MAX_SEMANTIC_EXTRACTION_LIST_ITEMS);
            if items.len() > limit {
                counters.dropped += items.len() - limit;
                items.truncate(limit);
            }
            let mut admitted_items = Vec::with_capacity(items.len());
            let mut cited = Vec::new();
            for item in items {
                let value = clip_text(&single_line_text(&item.value), *max_item_bytes);
                let item_sources = cite_text(
                    &value,
                    resolvable_sources(item.sources, read, sensitivity_limit),
                    read,
                    sensitivity_limit,
                );
                let kept = (sources.len(), counters.clone());
                match admit_text(
                    value,
                    *max_item_bytes,
                    item_sources.clone(),
                    read,
                    sensitivity_limit,
                    sources,
                    counters,
                ) {
                    Ok(text) => {
                        cited.extend(item_sources);
                        admitted_items.push(text);
                    }
                    Err(error) if droppable(error) => {
                        sources.truncate(kept.0);
                        *counters = kept.1;
                        counters.dropped += 1;
                    }
                    Err(error) => return Err(error),
                }
            }
            let mut list_sources = resolvable_sources(raw_sources, read, sensitivity_limit);
            if list_sources.is_empty() {
                list_sources = cited;
            }
            let source_span =
                admit_sources(list_sources, read, sensitivity_limit, sources, counters)?;
            Ok(SemanticExtractedValue::TextList(
                SemanticExtractedTextList {
                    items: admitted_items,
                    sources: source_span,
                },
            ))
        }
        _ => Err(SemanticExtractionError::TypeMismatch),
    }
}

/// Citations that name a delivered fragment the result may cite, in
/// canonical order, at most four. Citing a missing or withheld fragment
/// costs that citation, not the value.
fn resolvable_sources(
    raw_sources: Vec<String>,
    read: &SemanticReadResult<'_>,
    sensitivity_limit: SemanticReadSensitivityLimit,
) -> Vec<String> {
    let mut ids: Vec<_> = raw_sources
        .iter()
        .filter_map(|token| SemanticReadFragmentId::parse_model_token(token))
        .filter(|id| {
            read.fragment(*id)
                .is_some_and(|fragment| citable(fragment, sensitivity_limit))
        })
        .collect();
    ids.sort_unstable();
    ids.dedup();
    ids.truncate(MAX_SEMANTIC_EXTRACTION_SOURCES_PER_VALUE);
    if ids.is_empty() {
        // Nothing resolves: the original citations keep their own refusal.
        return raw_sources;
    }
    ids.into_iter()
        .map(SemanticReadFragmentId::model_token)
        .collect()
}

fn citable(fragment: SemanticReadFragment<'_>, limit: SemanticReadSensitivityLimit) -> bool {
    match fragment.provenance().sensitivity() {
        SemanticSensitivity::Secret => false,
        SemanticSensitivity::Sensitive => limit == SemanticReadSensitivityLimit::Sensitive,
        SemanticSensitivity::Public => true,
    }
}

fn joined(cited: &[(&String, &str)]) -> String {
    let texts: Vec<&str> = cited.iter().map(|(_, exact)| exact.trim()).collect();
    texts
        .iter()
        .enumerate()
        .filter(|(index, text)| {
            let held = comparable(text);
            !held.is_empty()
                && !texts.iter().enumerate().any(|(other, longer)| {
                    let longer = comparable(longer);
                    other != *index
                        && ((longer.len() > held.len() && longer.contains(&held))
                            || (longer == held && other < *index))
                })
        })
        .map(|(_, text)| *text)
        .collect::<Vec<_>>()
        .join(" ")
}

fn fragment_text<'a>(fragment: SemanticReadFragment<'a>) -> Option<&'a str> {
    let content = fragment.content();
    content.text().map(SemanticText::as_str).or_else(|| {
        content
            .value_preview()
            .filter(|preview| !preview.truncated())
            .map(|preview| preview.text())
    })
}

fn comparable(text: &str) -> String {
    text.split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

/// Keeps resolvable citations; when none resolve, cites the one fragment
/// that shows `value` itself, equal before containing, shortest first.
fn cite_text(
    value: &str,
    raw_sources: Vec<String>,
    read: &SemanticReadResult<'_>,
    sensitivity_limit: SemanticReadSensitivityLimit,
) -> Vec<String> {
    let resolves = raw_sources.iter().any(|token| {
        SemanticReadFragmentId::parse_model_token(token)
            .and_then(|id| read.fragment(id))
            .is_some_and(|fragment| citable(fragment, sensitivity_limit))
    });
    let wanted = comparable(value);
    if resolves || wanted.chars().count() < 2 {
        return raw_sources;
    }
    read.fragments()
        .iter()
        .filter(|fragment| citable(**fragment, sensitivity_limit))
        .filter_map(|fragment| {
            let text = comparable(fragment_text(*fragment)?);
            text.contains(&wanted)
                .then_some((text != wanted, text.len(), fragment.id()))
        })
        .min()
        .map_or(raw_sources, |(_, _, id)| vec![id.model_token()])
}

/// Model text on one line: control and invisible formatting characters
/// become spaces, runs of spaces collapse.
fn single_line_text(value: &str) -> String {
    let spaced: String = value
        .chars()
        .map(|ch| {
            if crate::semantic::invalid_semantic_char(ch) {
                ' '
            } else {
                ch
            }
        })
        .collect();
    spaced.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn clip_text(value: &str, max_bytes: usize) -> String {
    if value.len() <= max_bytes {
        return value.to_owned();
    }
    let mut end = max_bytes;
    while !value.is_char_boundary(end) {
        end -= 1;
    }
    value[..end].trim_end().to_owned()
}

/// The fragment that shows `amount` in `currency`: a cited one, another
/// field of a cited node, or the only fragment in the read that shows it.
/// A copy that differs from what the page shows only in quotes, dashes,
/// spaces or case, or that is a part of one fragment's text, still copies
/// that fragment. Returns the text to keep: the page's own when the two
/// are the same words, the copy when it is a part of the fragment.
fn loose_copy<'a>(
    cited: &[(&'a String, &str)],
    value: &str,
    part: bool,
) -> Option<(&'a String, String)> {
    fn fold(text: &str) -> String {
        let mapped: String = text
            .chars()
            .map(|c| match c {
                '\u{2018}' | '\u{2019}' | '\u{201B}' | '\u{2032}' => '\'',
                '\u{201C}' | '\u{201D}' | '\u{201F}' | '\u{2033}' => '"',
                '\u{2010}'..='\u{2015}' | '\u{2212}' => '-',
                c if c.is_whitespace() => ' ',
                c => c,
            })
            .collect::<String>()
            .replace('\u{2026}', "...");
        mapped
            .split(' ')
            .filter(|word| !word.is_empty())
            .collect::<Vec<_>>()
            .join(" ")
            .to_lowercase()
    }
    let copy = fold(value);
    if copy.chars().count() < 3 {
        return None;
    }
    cited
        .iter()
        .find(|(_, exact)| fold(exact) == copy)
        .map(|(token, exact)| (*token, (*exact).to_owned()))
        .or_else(|| {
            // A part, whole words only, and never of an amount: "299" is not
            // a copy of "1 299,00 zł".
            let whole_words = |exact: &str| {
                let exact = fold(exact);
                exact.match_indices(&copy).any(|(at, _)| {
                    let before = exact[..at].chars().next_back();
                    let after = exact[at + copy.len()..].chars().next();
                    !before.is_some_and(char::is_alphanumeric)
                        && !after.is_some_and(char::is_alphanumeric)
                })
            };
            cited
                .iter()
                .find(|(_, exact)| part && whole_words(exact))
                .map(|(token, _)| (*token, value.to_owned()))
        })
}

fn money_source(
    raw_sources: &[String],
    read: &SemanticReadResult<'_>,
    sensitivity_limit: SemanticReadSensitivityLimit,
    amount: &str,
    currency: &str,
) -> Option<String> {
    let supports = |fragment: SemanticReadFragment<'_>| {
        citable(fragment, sensitivity_limit)
            && fragment.provenance().fields_complete()
            && matches!(
                fragment.field(),
                crate::SemanticReadField::AccessibleName
                    | crate::SemanticReadField::VisibleText
                    | crate::SemanticReadField::TextValue
            )
            && fragment_text(fragment)
                .is_some_and(|text| crate::semantic_money::supports_money(text, amount, currency))
    };
    let cited: Vec<_> = raw_sources
        .iter()
        .filter_map(|token| SemanticReadFragmentId::parse_model_token(token))
        .filter_map(|id| read.fragment(id))
        .collect();
    if let Some(fragment) = cited.iter().copied().find(|fragment| supports(*fragment)) {
        return Some(fragment.id().model_token());
    }
    if let Some(fragment) = read.fragments().iter().copied().find(|fragment| {
        cited.iter().any(|cited| same_node(*cited, *fragment)) && supports(*fragment)
    }) {
        return Some(fragment.id().model_token());
    }
    let mut matches = read
        .fragments()
        .iter()
        .copied()
        .filter(|fragment| supports(*fragment));
    match (matches.next(), matches.next()) {
        (Some(only), None) => Some(only.id().model_token()),
        _ => None,
    }
}

fn same_node(left: SemanticReadFragment<'_>, right: SemanticReadFragment<'_>) -> bool {
    left.provenance().reference() == right.provenance().reference()
        && left.provenance().frame() == right.provenance().frame()
}

#[allow(clippy::too_many_arguments)]
fn admit_text<'a>(
    value: String,
    max_bytes: usize,
    raw_sources: Vec<String>,
    read: &SemanticReadResult<'a>,
    sensitivity_limit: SemanticReadSensitivityLimit,
    sources: &mut Vec<SemanticExtractionSource<'a>>,
    counters: &mut ExtractionCounters,
) -> Result<SemanticExtractedText, SemanticExtractionError> {
    if value.len() > max_bytes {
        return Err(SemanticExtractionError::TextLimit);
    }
    if looks_like_secret_value(&value) {
        return Err(SemanticExtractionError::SecretValue);
    }
    let next_text_bytes = counters
        .text_bytes
        .checked_add(value.len())
        .ok_or(SemanticExtractionError::TextLimit)?;
    if next_text_bytes > MAX_SEMANTIC_EXTRACTION_TOTAL_TEXT_BYTES {
        return Err(SemanticExtractionError::TextLimit);
    }
    let value = SemanticText::try_new(value, max_bytes).map_err(|error| match error {
        SemanticContractError::InvalidText => SemanticExtractionError::InvalidText,
        _ => SemanticExtractionError::Invariant,
    })?;
    add_value(counters)?;
    let source_span = admit_sources(raw_sources, read, sensitivity_limit, sources, counters)?;
    counters.text_bytes = next_text_bytes;
    Ok(SemanticExtractedText {
        value,
        sources: source_span,
    })
}

fn add_value(counters: &mut ExtractionCounters) -> Result<(), SemanticExtractionError> {
    let values = counters
        .values
        .checked_add(1)
        .ok_or(SemanticExtractionError::ValueLimit)?;
    if values > MAX_SEMANTIC_EXTRACTION_VALUES {
        return Err(SemanticExtractionError::ValueLimit);
    }
    counters.values = values;
    Ok(())
}

fn admit_sources<'a>(
    raw_sources: Vec<String>,
    read: &SemanticReadResult<'a>,
    sensitivity_limit: SemanticReadSensitivityLimit,
    sources: &mut Vec<SemanticExtractionSource<'a>>,
    counters: &mut ExtractionCounters,
) -> Result<SemanticExtractionSourceSpan, SemanticExtractionError> {
    if raw_sources.is_empty() || raw_sources.len() > MAX_SEMANTIC_EXTRACTION_SOURCES_PER_VALUE {
        return Err(SemanticExtractionError::SourceLimit);
    }
    let mut ids = raw_sources
        .iter()
        .map(|token| {
            SemanticReadFragmentId::parse_model_token(token)
                .ok_or(SemanticExtractionError::SourceInvalid)
        })
        .collect::<Result<Vec<_>, _>>()?;
    // Citations are a set; normalize only IDs, never evidence or extracted values.
    ids.sort_unstable();
    ids.dedup();
    let next_source_len = sources
        .len()
        .checked_add(ids.len())
        .ok_or(SemanticExtractionError::SourceLimit)?;
    if next_source_len > MAX_SEMANTIC_EXTRACTION_SOURCE_EDGES {
        return Err(SemanticExtractionError::SourceLimit);
    }
    let start = u16::try_from(sources.len()).map_err(|_| SemanticExtractionError::Invariant)?;
    let len = u8::try_from(ids.len()).map_err(|_| SemanticExtractionError::Invariant)?;
    for id in ids {
        let fragment = read
            .fragment(id)
            .ok_or(SemanticExtractionError::SourceMissing)?;
        match fragment.provenance().sensitivity() {
            SemanticSensitivity::Secret => return Err(SemanticExtractionError::Sensitivity),
            SemanticSensitivity::Sensitive
                if sensitivity_limit == SemanticReadSensitivityLimit::PublicOnly =>
            {
                return Err(SemanticExtractionError::Sensitivity);
            }
            SemanticSensitivity::Sensitive => {
                counters.sensitive_source_edges = counters
                    .sensitive_source_edges
                    .checked_add(1)
                    .ok_or(SemanticExtractionError::Invariant)?;
            }
            SemanticSensitivity::Public => {}
        }
        sources.push(SemanticExtractionSource { fragment });
    }
    Ok(SemanticExtractionSourceSpan {
        start,
        len,
        result_guard: counters.result_guard,
    })
}

fn extraction_result_guard(
    schema: SemanticExtractionSchemaId,
    read: &SemanticReadResult<'_>,
    sensitivity_limit: SemanticReadSensitivityLimit,
    model_output: &[u8],
) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(b"zephium.semantic-extraction-result.v1\0");
    hasher.update(schema.get().to_be_bytes());
    hasher.update(read.guard());
    hasher.update([match sensitivity_limit {
        SemanticReadSensitivityLimit::PublicOnly => 0,
        SemanticReadSensitivityLimit::Sensitive => 1,
    }]);
    hasher.update(
        u64::try_from(model_output.len())
            .unwrap_or(u64::MAX)
            .to_be_bytes(),
    );
    hasher.update(model_output);
    hasher.finalize().into()
}

/// The observed address a URL value cites, as `(url, citation)`. The value
/// is always the page's own exact address, never model text: a cited link or
/// picture fragment; else that field of a cited node; else the one observed
/// address the model's copy names; else, in a record, the link or picture
/// structurally bound to the record's exact native name provenance.
fn resolve_source_url(
    proposed: Option<&str>,
    raw_sources: &[String],
    read: &SemanticReadResult<'_>,
    field: crate::SemanticReadField,
    subject: Option<&RecordIdentity>,
) -> Result<(String, String), SemanticExtractionError> {
    let observed = |fragment: SemanticReadFragment<'_>| {
        if fragment.field() != field {
            return None;
        }
        let preview = fragment.content().value_preview()?;
        (!preview.truncated() && exact_public_url(preview.text()))
            .then(|| (preview.text().to_owned(), fragment.id().model_token()))
    };
    if field == crate::SemanticReadField::ImageSource {
        if let Some(subject) = subject {
            let candidates = read.images_for_record(&subject.sources);
            if let Some(found) = candidates
                .iter()
                .copied()
                .filter_map(observed)
                .find(|(url, _)| proposed == Some(url.as_str()))
                .or_else(|| candidates.iter().copied().find_map(observed))
            {
                return Ok(found);
            }
            // Native matching is optional enrichment. The existing observed,
            // cited/labelled URL path below supplies candidates, never pixels.
        }
    }
    let subject = subject.map(|subject| subject.name.as_str());
    if field == crate::SemanticReadField::DocumentAddress {
        return read
            .fragments()
            .iter()
            .find_map(|fragment| observed(*fragment))
            .ok_or(SemanticExtractionError::SourceInvalid);
    }
    let cited: Vec<_> = raw_sources
        .iter()
        .filter_map(|token| crate::semantic_extract_repair::parse_source_token(token))
        .filter_map(|id| read.fragment(id))
        .collect();
    let direct: Vec<_> = cited
        .iter()
        .filter_map(|fragment| observed(*fragment))
        .collect();
    if let Some(found) = direct
        .iter()
        .find(|(url, _)| proposed == Some(url.as_str()))
        .or_else(|| direct.first())
    {
        return Ok(found.clone());
    }
    if let Some(found) = read.fragments().iter().find_map(|fragment| {
        cited
            .iter()
            .any(|cited| same_node(*cited, *fragment))
            .then(|| observed(*fragment))
            .flatten()
    }) {
        return Ok(found);
    }
    if let Some(proposed) = proposed.filter(|value| value.len() > 1) {
        let mut named = read.fragments().iter().filter_map(|fragment| {
            observed(*fragment).filter(|(url, _)| {
                url == proposed
                    || (proposed.starts_with('/')
                        && url
                            .split_once("://")
                            .and_then(|(_, rest)| rest.find('/').map(|at| &rest[at..]))
                            == Some(proposed))
            })
        });
        if let (Some(only), None) = (named.next(), named.next()) {
            return Ok(only);
        }
    }
    let named_subject = subject
        .map(comparable)
        .filter(|name| name.chars().count() >= 4);
    if let Some(subject) = named_subject {
        let mut best: Option<(bool, usize, (String, String))> = None;
        for named in read.fragments() {
            if !matches!(
                named.field(),
                crate::SemanticReadField::AccessibleName | crate::SemanticReadField::VisibleText
            ) {
                continue;
            }
            let Some(text) = fragment_text(*named).map(comparable) else {
                continue;
            };
            // A clipped name ("Model Car Kit for ...") names the subject it starts.
            let clipped = text
                .strip_suffix("...")
                .or_else(|| text.strip_suffix('…'))
                .map(str::trim_end);
            let shorter = text.chars().count().min(subject.chars().count());
            let equal = text == subject;
            if !(equal
                || (shorter >= 10 && (text.contains(&subject) || subject.contains(&text)))
                || clipped.is_some_and(|clipped| {
                    clipped.chars().count() >= 10 && subject.starts_with(clipped)
                }))
            {
                continue;
            }
            let Some(found) = read.fragments().iter().find_map(|fragment| {
                same_node(*named, *fragment)
                    .then(|| observed(*fragment))
                    .flatten()
            }) else {
                continue;
            };
            let rank = (!equal, text.len().abs_diff(subject.len()));
            if best.as_ref().is_none_or(|(e, d, _)| rank < (*e, *d)) {
                best = Some((rank.0, rank.1, found));
            }
        }
        if let Some((_, _, found)) = best {
            return Ok(found);
        }
    }
    if field == crate::SemanticReadField::LinkDestination {
        if let Some(found) = cited
            .iter()
            .find_map(|fragment| address_in_text(*fragment, proposed, subject))
        {
            return Ok(found);
        }
    }
    Err(SemanticExtractionError::SourceInvalid)
}

/// A link a cited text itself prints, such as a page-facts summary's
/// `url: /p/123-laptop.html`: the one the model copied, else the first after
/// the record's subject, resolved against the page's own origin. The cited
/// text stays the citation.
fn address_in_text(
    fragment: SemanticReadFragment<'_>,
    proposed: Option<&str>,
    subject: Option<&str>,
) -> Option<(String, String)> {
    if !matches!(
        fragment.field(),
        crate::SemanticReadField::VisibleText | crate::SemanticReadField::AccessibleName
    ) {
        return None;
    }
    let text = fragment_text(fragment)?;
    let addresses = printed_addresses(text, fragment.provenance().origin().as_url());
    let chosen = match (proposed, subject) {
        (Some(proposed), _) => addresses.into_iter().find(|(_, printed, resolved)| {
            proposed == printed || proposed == resolved || proposed.ends_with(printed.as_str())
        })?,
        (None, Some(subject)) => {
            let lower = text.to_ascii_lowercase();
            let at = lower.find(&subject.trim().to_ascii_lowercase())?;
            addresses.into_iter().find(|(start, _, _)| *start > at)?
        }
        (None, None) => {
            let mut addresses = addresses.into_iter();
            match (addresses.next(), addresses.next()) {
                (Some(only), None) => only,
                _ => return None,
            }
        }
    };
    Some((chosen.2, fragment.id().model_token()))
}

/// The page addresses a text prints, absolute or site-relative, each with
/// where it starts, as printed, and resolved against the page's origin into
/// an exact public address. Other tokens are not addresses.
pub(crate) fn printed_addresses(text: &str, origin: &url::Url) -> Vec<(usize, String, String)> {
    let separator = |ch: char| ch.is_whitespace() || matches!(ch, '|' | '"' | '\'' | '<' | '>');
    let mut found = Vec::new();
    let mut start = None;
    for (index, ch) in text
        .char_indices()
        .chain(std::iter::once((text.len(), ' ')))
    {
        if !separator(ch) {
            start.get_or_insert(index);
            continue;
        }
        let Some(from) = start.take() else {
            continue;
        };
        let printed = text[from..index].trim_end_matches([',', ';', '.', ')']);
        if !((printed.starts_with('/') && !printed.starts_with("//"))
            || printed.starts_with("https://"))
        {
            continue;
        }
        let resolved = origin
            .join(printed)
            .ok()
            .and_then(|url| crate::ContextNavigationTarget::parse(url.as_str()).ok())
            .map(|target| target.as_url().as_str().to_owned())
            .filter(|value| exact_public_url(value));
        if let Some(resolved) = resolved {
            found.push((from, printed.to_owned(), resolved));
        }
    }
    found
}

pub(crate) fn exact_public_url(value: &str) -> bool {
    value.len() <= crate::semantic::MAX_SEMANTIC_LINK_DESTINATION_BYTES
        && crate::ContextNavigationTarget::parse(value).is_ok_and(|target| {
            target.as_url().as_str() == value
                && crate::semantic_wire::model_safe_public_url(&target)
        })
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawExtraction {
    #[serde(rename = "v")]
    version: u16,
    schema: u64,
    fields: Vec<RawField>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawField {
    name: String,
    value: RawValue,
}

#[derive(Deserialize)]
#[serde(tag = "k", deny_unknown_fields)]
enum RawValue {
    #[serde(rename = "money")]
    Money {
        amount: String,
        currency: String,
        sources: Vec<String>,
    },
    #[serde(rename = "rows")]
    Rows { items: Vec<RawRow> },
    #[serde(rename = "text")]
    Text {
        value: Option<String>,
        sources: Vec<String>,
    },
    #[serde(rename = "url")]
    Url {
        value: Option<String>,
        sources: Vec<String>,
    },
    #[serde(rename = "image_url")]
    ImageUrl {
        value: Option<String>,
        sources: Vec<String>,
    },
    #[serde(rename = "boolean")]
    Boolean { value: bool, sources: Vec<String> },
    #[serde(rename = "unsigned")]
    Unsigned { value: u64, sources: Vec<String> },
    #[serde(rename = "text_list")]
    TextList {
        items: Vec<RawTextItem>,
        sources: Vec<String>,
    },
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawRow {
    fields: Vec<RawField>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawTextItem {
    value: String,
    sources: Vec<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn split_fragments_join_once_without_repeating_what_one_already_holds() {
        let (short, long, rating) = (
            "$2,658".to_owned(),
            "$2,658 monthly, originally $3,410".to_owned(),
            "4.9".to_owned(),
        );
        let cited = [
            (&short, short.as_str()),
            (&long, long.as_str()),
            (&rating, rating.as_str()),
            (&rating, rating.as_str()),
        ];
        assert_eq!(joined(&cited), "$2,658 monthly, originally $3,410 4.9");
    }

    #[test]
    fn a_copy_differing_only_in_quotes_spaces_or_case_still_copies_its_fragment() {
        let (a, b) = ("@r1".to_owned(), "@r2".to_owned());
        let cited = [
            (&a, "Price list"),
            (
                &b,
                "Posted \u{201C}testing agentic browsing v2\u{201D}  just now",
            ),
        ];
        // The same words: the page's own text is kept.
        assert_eq!(
            loose_copy(&cited, "price  LIST", true),
            Some((&a, "Price list".to_owned()))
        );
        // A part of a fragment, with straight quotes: the copy stands.
        assert_eq!(
            loose_copy(&cited, "\"testing agentic browsing v2\"", true),
            Some((&b, "\"testing agentic browsing v2\"".to_owned()))
        );
        assert_eq!(loose_copy(&cited, "something else", true), None);
        assert_eq!(loose_copy(&cited, "v2", true), None);
        assert_eq!(loose_copy(&cited, "agentic brow", true), None);
        // Never a part of an amount.
        let price = [(&a, "1 299,00 zł")];
        assert_eq!(loose_copy(&price, "299,00 zł", false), None);
    }
    use crate::{
        decode_semantic_snapshot, encode_semantic_read, read_semantic_observation,
        ContextCapabilities, ContextCapability, ContextId, ContextIdentity, ContextKind,
        ContextOperationId, ContextRegistry, ContextRunId, ContextSettlement, FrameId,
        SemanticDecodeContext, SemanticFrameJoin, SemanticFrameTrust, SemanticInvocationId,
        SemanticModelDeliverySettlement, SemanticModelEncodingBudget, SemanticObservation,
        SemanticObservationAssembler, SemanticObservationBudget, SemanticOrigin,
        SemanticReadAuthority, SemanticReadBudget, SemanticReadResult, SemanticSnapshotGeneration,
        SemanticTokenCountQuality, SemanticTokenCountRequirement, SemanticTokenCounter,
        SemanticTokenCounterError, SemanticTokenMeasurement, SemanticTokenizerRevision,
        SEMANTIC_WIRE_VERSION,
    };
    use serde_json::{json, Value};
    use zephium_core::ids::ProfileId;

    #[test]
    fn a_single_record_keeps_whole_page_evidence_without_enabling_listing_loading() {
        let schema = SemanticExtractionSchema::try_new(
            SemanticExtractionSchemaId::new(1).unwrap(),
            vec![SemanticExtractionFieldSchema::try_rows(
                "record".into(),
                true,
                vec![SemanticExtractionFieldSchema::try_text("name".into(), true, 128).unwrap()],
                1,
            )
            .unwrap()],
        )
        .unwrap();
        assert!(schema.reads_whole_page());
        assert!(schema.is_single_record());
        assert!(!schema.is_row_collection());
    }

    #[cfg(feature = "probe-harness")]
    #[test]
    fn native_name_probe_uses_only_exact_validated_public_name_sources() {
        use std::sync::{Arc, Mutex};
        let observation = observation();
        let read = read(&observation, 31);
        let delivery = delivered(&read);
        for fragment in read.fragments() {
            let probe = read.media_probe_source(9, fragment.id());
            if fragment.provenance().sensitivity() != SemanticSensitivity::Public {
                assert!(probe.is_none());
            } else {
                let probe = probe.unwrap();
                assert_eq!(probe.frame(), fragment.provenance().frame());
                assert_eq!(probe.invocation(), 17);
                assert_eq!(probe.snapshot(), 19);
                assert!((1..=4).contains(&probe.node()));
                assert_eq!(format!("{probe:?}"), "SemanticMediaNameProbe([redacted])");
            }
        }
        let schema = SemanticExtractionSchema::try_new(
            SemanticExtractionSchemaId::new(29).unwrap(),
            vec![SemanticExtractionFieldSchema::try_rows(
                "records".into(),
                true,
                vec![SemanticExtractionFieldSchema::try_text("name".into(), true, 64).unwrap()],
                2,
            )
            .unwrap()],
        )
        .unwrap();
        let output=serde_json::to_vec(&json!({"v":1,"schema":29,"fields":[{"name":"records","value":{"k":"rows","items":[
            {"fields":[{"name":"name","value":{"k":"text","value":"Quarterly summary","sources":["@r1"]}}]},
            {"fields":[{"name":"name","value":{"k":"text","value":"Another record","sources":["@r1"]}}]}
        ]}}]})).unwrap();
        let run = || {
            extract_semantic_read(
                &schema,
                &read,
                &delivery,
                SemanticReadSensitivityLimit::PublicOnly,
                &output,
            )
            .unwrap()
            .into_owned()
            .unwrap()
        };
        let before = run();
        let received = Arc::new(Mutex::new(Vec::new()));
        let captured = received.clone();
        let thread = std::thread::current().id();
        struct Reset;
        impl Drop for Reset {
            fn drop(&mut self) {
                crate::set_semantic_media_name_probe(None);
            }
        }
        let reset = Reset;
        crate::set_semantic_media_name_probe(Some(Arc::new(move |sources, incomplete| {
            if std::thread::current().id() != thread {
                return;
            }
            assert!(!incomplete);
            *captured.lock().unwrap() = sources
                .iter()
                .map(|source| {
                    (
                        source.record(),
                        source.invocation(),
                        source.snapshot(),
                        source.node(),
                    )
                })
                .collect();
        })));
        let after = run();
        drop(reset);
        assert_eq!(
            *received.lock().unwrap(),
            vec![(0, 17, 19, 2), (1, 17, 19, 2)]
        );
        assert_eq!(before.guard, after.guard);
        assert_eq!(before.fields, after.fields);
        assert_eq!(before.edges, after.edges);
        assert_eq!(before.sources.len(), after.sources.len());
        assert_eq!(before.media_diagnostics, after.media_diagnostics);
    }

    fn observation() -> SemanticObservation {
        observation_with_nodes(json!([
            {"k": 1, "r": "document", "o": 16},
            {"k": 2, "p": 0, "r": "paragraph", "t": "Quarterly summary"},
            {"k": 3, "p": 0, "r": "paragraph", "t": "42"},
            {"k": 4, "p": 0, "r": "checkbox", "n": "Active",
             "v": {"k": "boolean", "value": true}, "o": 1},
            {"k": 5, "p": 0, "r": "paragraph", "t": "Private customer note",
             "q": "sensitive"},
            {"k": 6, "p": 0, "r": "password", "n": "Password",
             "v": {"k": "redacted"}, "q": "secret"}
        ]))
    }

    fn observation_with_nodes(nodes: Value) -> SemanticObservation {
        observation_with_completeness(nodes, "complete")
    }

    fn observation_with_completeness(nodes: Value, completeness: &str) -> SemanticObservation {
        observation_with_media(nodes, completeness, json!([]))
    }
    fn observation_with_media(
        nodes: Value,
        completeness: &str,
        media: Value,
    ) -> SemanticObservation {
        let identity = ContextIdentity::new(
            ContextId::from_raw(731),
            ContextRunId::from_raw(732),
            ProfileId::from(733),
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
            .expect("settle construction");
        let context = registry.join(identity.id()).expect("context");
        let frame = SemanticFrameJoin::try_new(
            context,
            FrameId::MAIN,
            context.frame_generation(),
            SemanticOrigin::parse("https://extract.example.test/private").expect("origin"),
            SemanticFrameTrust::SameOrigin,
        )
        .expect("frame");
        let bytes = serde_json::to_vec(&json!({
            "v": SEMANTIC_WIRE_VERSION,
            "i": 17,
            "g": 19,
            "c": completeness,
            "m": media,
            "n": nodes
        }))
        .expect("wire");
        let snapshot = decode_semantic_snapshot(
            SemanticDecodeContext::new(
                SemanticInvocationId::new(17).expect("invocation"),
                frame,
                SemanticSnapshotGeneration::new(19).expect("generation"),
            ),
            &bytes,
        )
        .expect("snapshot");
        let request = crate::SemanticObservationRequest::initial(
            SemanticObservationId::new(23).expect("observation"),
            context,
            SemanticObservationBudget::INITIAL_FILTERED,
        );
        SemanticObservationAssembler::new(request, snapshot)
            .expect("assembler")
            .finish()
            .expect("observation")
    }

    fn read(observation: &SemanticObservation, capture_millis: u64) -> SemanticReadResult<'_> {
        read_semantic_observation(
            observation,
            SemanticReadAuthority::Initial,
            SemanticCaptureInstant::from_millis(capture_millis),
            SemanticReadSensitivityLimit::Sensitive,
            SemanticReadBudget::STANDARD,
        )
        .expect("read")
    }

    struct FixedCounter {
        revision: SemanticTokenizerRevision,
    }

    impl SemanticTokenCounter for FixedCounter {
        fn count_tokens(
            &self,
            input: &str,
        ) -> Result<SemanticTokenMeasurement, SemanticTokenCounterError> {
            if input.is_empty() {
                return Err(SemanticTokenCounterError::InvalidResult);
            }
            SemanticTokenMeasurement::try_new(
                self.revision.clone(),
                100,
                SemanticTokenCountQuality::ExactLocal,
            )
            .map_err(|_| SemanticTokenCounterError::InvalidResult)
        }
    }

    fn delivered(read: &SemanticReadResult<'_>) -> SemanticReadDeliveryReceipt {
        let revision =
            SemanticTokenizerRevision::try_new("extract-test-v1".to_owned()).expect("revision");
        let counter = FixedCounter {
            revision: revision.clone(),
        };
        let budget = SemanticModelEncodingBudget::try_new(
            32 * 1024,
            1_000,
            SemanticTokenCountRequirement::Exact,
        )
        .expect("encoding budget");
        encode_semantic_read(read, budget)
            .expect("encode")
            .admit(&counter, &revision)
            .expect("admit")
            .settle_delivery(SemanticModelDeliverySettlement::Committed)
            .expect("commit")
    }

    fn schema() -> SemanticExtractionSchema {
        SemanticExtractionSchema::try_new(
            SemanticExtractionSchemaId::new(29).expect("schema id"),
            vec![
                SemanticExtractionFieldSchema::try_text("title".to_owned(), true, 64)
                    .expect("title"),
                SemanticExtractionFieldSchema::try_boolean("active".to_owned(), true)
                    .expect("active"),
                SemanticExtractionFieldSchema::try_unsigned("count".to_owned(), true, 100)
                    .expect("count"),
                SemanticExtractionFieldSchema::try_text_list("tags".to_owned(), false, 4, 64)
                    .expect("tags"),
            ],
        )
        .expect("schema")
    }

    fn valid_output() -> Value {
        json!({
            "v": SEMANTIC_EXTRACTION_SCHEMA_VERSION,
            "schema": 29,
            "fields": [
                {"name": "title", "value": {
                    "k": "text", "value": "Quarterly summary", "sources": ["@r1"]
                }},
                {"name": "active", "value": {
                    "k": "boolean", "value": true, "sources": ["@r4"]
                }},
                {"name": "count", "value": {
                    "k": "unsigned", "value": 42, "sources": ["@r2"]
                }},
                {"name": "tags", "value": {
                    "k": "text_list", "sources": ["@r1", "@r2"], "items": [
                        {"value": "Quarterly", "sources": ["@r1"]},
                        {"value": "Private", "sources": ["@r5"]}
                    ]
                }}
            ]
        })
    }

    fn extract_value_error(output: &Value) -> SemanticExtractionError {
        let observation = observation();
        let read = read(&observation, 31);
        let delivery = delivered(&read);
        extract_semantic_read(
            &schema(),
            &read,
            &delivery,
            SemanticReadSensitivityLimit::Sensitive,
            &serde_json::to_vec(output).expect("output"),
        )
        .expect_err("output must fail")
    }

    #[test]
    fn money_refuses_a_clipped_amount_even_when_its_prefix_matches() {
        let observation = observation_with_completeness(
            json!([
                {"k":1,"r":"document","o":16,"fc":true},
                {"k":2,"p":0,"r":"paragraph","t":"USD 123","fc":false}
            ]),
            "field_limit",
        );
        let read = read(&observation, 31);
        let delivery = delivered(&read);
        let schema = SemanticExtractionSchema::try_new(
            SemanticExtractionSchemaId::new(29).unwrap(),
            vec![SemanticExtractionFieldSchema::try_money(
                "price".into(),
                true,
                vec!["USD".into()],
            )
            .unwrap()],
        )
        .unwrap();
        let output = serde_json::to_vec(&json!({"v":1,"schema":29,"fields":[{"name":"price","value":{"k":"money","amount":"123","currency":"USD","sources":["@r1"]}}]})).unwrap();
        assert_eq!(
            extract_semantic_read(
                &schema,
                &read,
                &delivery,
                SemanticReadSensitivityLimit::PublicOnly,
                &output
            )
            .unwrap_err(),
            SemanticExtractionError::SourceInvalid
        );
    }

    #[test]
    fn money_requires_matching_text_evidence_and_host_currency() {
        let observation = observation_with_nodes(json!([
            {"k":1,"r":"document","o":16},
            {"k":2,"p":0,"r":"paragraph","t":"Price 1.299,50 EUR"},
            {"k":3,"p":0,"r":"paragraph","t":"$1299.50"}
        ]));
        let read = read(&observation, 31);
        let delivery = delivered(&read);
        let schema = SemanticExtractionSchema::try_new(
            SemanticExtractionSchemaId::new(29).unwrap(),
            vec![SemanticExtractionFieldSchema::try_money(
                "price".into(),
                true,
                vec!["EUR".into()],
            )
            .unwrap()],
        )
        .unwrap();
        let output = |amount: &str, currency: &str, source: &str| {
            serde_json::to_vec(&json!({"v":1,"schema":29,"fields":[{"name":"price","value":{"k":"money","amount":amount,"currency":currency,"sources":[source]}}]})).unwrap()
        };
        let token = read
            .fragments()
            .iter()
            .find(|source| {
                source
                    .content()
                    .text()
                    .is_some_and(|text| text.as_str().contains("EUR"))
            })
            .unwrap()
            .id()
            .model_token();
        let accepted = extract_semantic_read(
            &schema,
            &read,
            &delivery,
            SemanticReadSensitivityLimit::PublicOnly,
            &output("1299.50", "EUR", &token),
        )
        .unwrap();
        assert!(
            matches!(accepted.fields()[0].value(), SemanticExtractedValue::Money(value) if value.amount() == "1299.50" && value.currency() == "EUR")
        );
        // A wrong citation is answered by the one fragment showing the amount.
        assert!(extract_semantic_read(
            &schema,
            &read,
            &delivery,
            SemanticReadSensitivityLimit::PublicOnly,
            &output("1299.50", "EUR", "@r999")
        )
        .is_ok());
        for (amount, currency, source) in [
            ("1299.50", "USD", token.as_str()),
            ("1299.51", "EUR", token.as_str()),
            ("1300", "EUR", "@r999"),
        ] {
            assert!(extract_semantic_read(
                &schema,
                &read,
                &delivery,
                SemanticReadSensitivityLimit::PublicOnly,
                &output(amount, currency, source)
            )
            .is_err());
        }
        for currencies in [
            vec![],
            vec!["EUR".into(), "EUR".into()],
            vec!["$".into()],
            vec!["usd".into()],
        ] {
            assert!(
                SemanticExtractionFieldSchema::try_money("price".into(), true, currencies).is_err()
            );
        }
    }

    #[test]
    fn page_findings_keep_query_bearing_native_link_sources_without_admitting_prose_urls() {
        let destination = "https://example.test/station?id=8443970&date=2026-11-14";
        let observation = observation_with_nodes(json!([
            {"k":1,"r":"document","o":16},
            {"k":2,"p":0,"r":"link","n":"Station predictions","u":destination},
            {"k":3,"p":0,"r":"paragraph","t":"https://unobserved.example.test/?account=42"}
        ]));
        let schema = SemanticExtractionSchema::try_new(
            SemanticExtractionSchemaId::new(29).unwrap(),
            vec![
                SemanticExtractionFieldSchema::try_text_list("output_0".into(), true, 16, 1024)
                    .unwrap(),
            ],
        )
        .unwrap();
        let read = crate::read_semantic_observation_for_schema(
            &observation,
            SemanticReadAuthority::Initial,
            SemanticCaptureInstant::from_millis(31),
            SemanticReadSensitivityLimit::PublicOnly,
            SemanticReadBudget::STANDARD,
            &schema,
        )
        .unwrap();
        let links: Vec<_> = read
            .fragments()
            .iter()
            .filter(|f| f.field() == crate::SemanticReadField::LinkDestination)
            .collect();
        assert_eq!(links.len(), 1);
        assert_eq!(
            links[0].content().value_preview().unwrap().text(),
            destination
        );
        let token = links[0].id().model_token();
        let result = extract_semantic_read(&schema, &read, &delivered(&read), SemanticReadSensitivityLimit::PublicOnly,
            &serde_json::to_vec(&json!({"v":1,"schema":29,"fields":[{"name":"output_0","value":{
                "k":"text_list","sources":[token],"items":[{"value":"Station predictions are on the linked station page.","sources":[token]}]
            }}]})).unwrap()).unwrap();
        let SemanticExtractedValue::TextList(items) = result.fields()[0].value() else {
            panic!()
        };
        let sources = result.sources(items.items()[0].source_span()).unwrap();
        assert_eq!(sources.len(), 1);
        assert_eq!(
            sources[0].fragment().field(),
            crate::SemanticReadField::LinkDestination
        );
    }

    #[test]
    fn url_extraction_requires_exact_screened_destination_evidence_and_schema_selection() {
        let url = "https://shop.example.test/item/42?variant=blue#main-content";
        let observation = observation_with_nodes(json!([
            {"k":1,"r":"document","o":16},
            {"k":2,"p":0,"r":"paragraph","t":url},
            {"k":3,"p":0,"r":"link","n":"Example item","u":url},
            {"k":4,"p":0,"r":"link","n":"Private","u":"https://shop.example.test/?token=private-token"}
        ]));
        let plain = read(&observation, 31);
        assert!(!plain
            .fragments()
            .iter()
            .any(|source| source.field() == crate::SemanticReadField::LinkDestination));
        let schema = SemanticExtractionSchema::try_new(
            SemanticExtractionSchemaId::new(29).unwrap(),
            vec![SemanticExtractionFieldSchema::try_url("product_url".into(), true, 512).unwrap()],
        )
        .unwrap();
        let read = crate::read_semantic_observation_for_schema(
            &observation,
            SemanticReadAuthority::Initial,
            SemanticCaptureInstant::from_millis(31),
            SemanticReadSensitivityLimit::PublicOnly,
            SemanticReadBudget::STANDARD,
            &schema,
        )
        .unwrap();
        let urls: Vec<_> = read
            .fragments()
            .iter()
            .filter(|source| source.field() == crate::SemanticReadField::LinkDestination)
            .collect();
        // The private link is kept only without its token.
        let previews: Vec<_> = urls
            .iter()
            .map(|source| source.content().value_preview().unwrap().text().to_owned())
            .collect();
        assert_eq!(previews, [url, "https://shop.example.test/"]);
        let token = urls[0].id().model_token();
        let delivery = delivered(&read);
        let output = |value: &str, sources: Vec<&str>| {
            serde_json::to_vec(&json!({"v":1,"schema":29,
            "fields":[{"name":"product_url","value":{"k":"url","value":value,"sources":sources}}]}))
            .unwrap()
        };
        let accepted = extract_semantic_read(
            &schema,
            &read,
            &delivery,
            SemanticReadSensitivityLimit::PublicOnly,
            &output(url, vec![&token]),
        )
        .unwrap();
        assert!(
            matches!(accepted.fields()[0].value(), SemanticExtractedValue::Url(value) if value.as_str() == url)
        );
        let source_only = |sources: Vec<&str>| {
            serde_json::to_vec(&json!({"v":1,"schema":29,"fields":[
                {"name":"product_url","value":{"k":"url","sources":sources}}
            ]}))
            .unwrap()
        };
        let resolved = extract_semantic_read(
            &schema,
            &read,
            &delivery,
            SemanticReadSensitivityLimit::PublicOnly,
            &source_only(vec![&token]),
        )
        .unwrap();
        assert!(
            matches!(resolved.fields()[0].value(), SemanticExtractedValue::Url(value) if value.as_str() == url)
        );
        // A paragraph that prints the address is evidence for it too.
        for sources in [
            vec![token.as_str(), token.as_str()],
            vec![&token[1..]],
            vec!["@r1"],
            vec!["@r01"],
        ] {
            let resolved = extract_semantic_read(
                &schema,
                &read,
                &delivery,
                SemanticReadSensitivityLimit::PublicOnly,
                &source_only(sources),
            )
            .unwrap();
            assert!(
                matches!(resolved.fields()[0].value(), SemanticExtractedValue::Url(value) if value.as_str() == url)
            );
        }
        for sources in [vec![], vec!["@r999"]] {
            assert!(extract_semantic_read(
                &schema,
                &read,
                &delivery,
                SemanticReadSensitivityLimit::PublicOnly,
                &source_only(sources)
            )
            .is_err());
        }
        // The value is always the observed address, never the model's copy:
        // a cited link wins over a miscopied value, and an exact copy finds
        // its link when the citation names other text.
        for (value, source) in [
            (
                "https://shop.example.test/item/42?variant=blue",
                token.as_str(),
            ),
            ("https://shop.example.test/item/43", token.as_str()),
            (url, "@r1"),
            ("https://shop.example.test/?token=secret", token.as_str()),
        ] {
            let resolved = extract_semantic_read(
                &schema,
                &read,
                &delivery,
                SemanticReadSensitivityLimit::PublicOnly,
                &output(value, vec![source]),
            )
            .unwrap();
            assert!(
                matches!(resolved.fields()[0].value(), SemanticExtractedValue::Url(found) if found.as_str() == url)
            );
        }
        for (value, source) in [
            ("https://shop.example.test/item/43", "@r1"),
            ("https://shop.example.test/?token=private-token", "@r1"),
        ] {
            assert!(extract_semantic_read(
                &schema,
                &read,
                &delivery,
                SemanticReadSensitivityLimit::PublicOnly,
                &output(value, vec![source])
            )
            .is_err());
        }
        assert!(crate::encode_semantic_extraction_request(
            &schema,
            &plain,
            crate::SemanticModelEncodingBudget::EXTRACTION_PROVIDER_EXACT_CONSERVATIVE
        )
        .is_err());
        let mut retained = crate::SemanticRetainedReadEvidence::default();
        let ack = crate::SemanticObservationAcknowledgement::from_fingerprint(
            crate::semantic_diff::SemanticObservationFingerprint::from_observation(&observation),
        );
        retained.retain(&read, &ack).unwrap();
        assert!(retained.merge_for_extraction(plain).is_err());
    }

    #[test]
    fn image_urls_require_image_sources_and_exclude_navigation_and_secret_urls() {
        let url = "https://images.example.test/product.webp";
        let observation = observation_with_nodes(json!([
            {"k":1,"r":"document","o":16},
            {"k":2,"p":0,"r":"link","n":"Image download","u":url},
            {"k":3,"p":0,"r":"image","n":"Product","m":url},
            {"k":4,"p":0,"r":"image","n":"Secret","m":"https://images.example.test/p.webp?token=secret"}
        ]));
        let schema = SemanticExtractionSchema::try_new(
            SemanticExtractionSchemaId::new(29).unwrap(),
            vec![SemanticExtractionFieldSchema::try_image_url("image".into(), true, 512).unwrap()],
        )
        .unwrap();
        let read = crate::read_semantic_observation_for_schema(
            &observation,
            SemanticReadAuthority::Initial,
            SemanticCaptureInstant::from_millis(31),
            SemanticReadSensitivityLimit::PublicOnly,
            SemanticReadBudget::STANDARD,
            &schema,
        )
        .unwrap();
        assert!(!read
            .fragments()
            .iter()
            .any(|source| source.field() == crate::SemanticReadField::LinkDestination));
        let images: Vec<_> = read
            .fragments()
            .iter()
            .filter(|source| source.field() == crate::SemanticReadField::ImageSource)
            .collect();
        let previews: Vec<_> = images
            .iter()
            .map(|source| source.content().value_preview().unwrap().text().to_owned())
            .collect();
        assert_eq!(previews, [url, "https://images.example.test/p.webp"]);
        let token = images[0].id().model_token();
        let delivery = delivered(&read);
        let output = |kind: &str, value: &str, source: &str| {
            serde_json::to_vec(&json!({"v":1,"schema":29,"fields":[
                {"name":"image","value":{"k":kind,"value":value,"sources":[source]}}
            ]}))
            .unwrap()
        };
        let accepted = extract_semantic_read(
            &schema,
            &read,
            &delivery,
            SemanticReadSensitivityLimit::PublicOnly,
            &output("image_url", url, &token),
        )
        .unwrap();
        assert!(
            matches!(accepted.fields()[0].value(), SemanticExtractedValue::ImageUrl(value) if value.as_str() == url)
        );
        let source_only = serde_json::to_vec(&json!({"v":1,"schema":29,"fields":[
            {"name":"image","value":{"k":"image_url","sources":[token]}}
        ]}))
        .unwrap();
        let resolved = extract_semantic_read(
            &schema,
            &read,
            &delivery,
            SemanticReadSensitivityLimit::PublicOnly,
            &source_only,
        )
        .unwrap();
        assert!(
            matches!(resolved.fields()[0].value(), SemanticExtractedValue::ImageUrl(value) if value.as_str() == url)
        );
        for (value, source) in [
            (url, "@r1"),
            ("https://images.example.test/other.webp", token.as_str()),
        ] {
            let resolved = extract_semantic_read(
                &schema,
                &read,
                &delivery,
                SemanticReadSensitivityLimit::PublicOnly,
                &output("image_url", value, source),
            )
            .unwrap();
            assert!(
                matches!(resolved.fields()[0].value(), SemanticExtractedValue::ImageUrl(found) if found.as_str() == url)
            );
        }
        for (kind, value, source) in [
            ("url", url, token.as_str()),
            ("image_url", "https://images.example.test/other.webp", "@r1"),
            (
                "image_url",
                "https://images.example.test/p.webp?token=secret",
                "@r1",
            ),
        ] {
            assert!(extract_semantic_read(
                &schema,
                &read,
                &delivery,
                SemanticReadSensitivityLimit::PublicOnly,
                &output(kind, value, source)
            )
            .is_err());
        }
    }

    #[test]
    fn rows_refuse_mixed_cards_but_allow_shared_search_state() {
        let observation = observation_with_nodes(json!([
            {"k":1,"r":"document","fc":true},
            {"k":2,"p":0,"r":"button","n":"Nov 18 – 21; two guests","fc":true},
            {"k":3,"p":0,"r":"group","fc":true},
            {"k":4,"p":2,"r":"heading","l":2,"n":"Amber stay","fc":true},
            {"k":5,"p":2,"r":"link","n":"Open Amber","u":"https://stays.example/amber?guests=2","fc":true},
            {"k":6,"p":2,"r":"button","n":"$218 total","fc":true},
            {"k":7,"p":0,"r":"group","fc":true},
            {"k":8,"p":6,"r":"heading","l":2,"n":"Blue stay","fc":true},
            {"k":9,"p":6,"r":"link","n":"Open Blue","u":"https://stays.example/blue?guests=2","fc":true},
            {"k":10,"p":6,"r":"button","n":"$264 total","fc":true},
            {"k":11,"p":0,"r":"landmark","lm":"navigation","fc":true},
            {"k":12,"p":10,"r":"group","fc":true},
            {"k":13,"p":11,"r":"heading","l":2,"n":"Help","fc":true},
            {"k":14,"p":11,"r":"link","n":"Help link","u":"https://stays.example/help","fc":true},
            {"k":15,"p":10,"r":"group","fc":true},
            {"k":16,"p":14,"r":"heading","l":2,"n":"About","fc":true},
            {"k":17,"p":14,"r":"link","n":"About link","u":"https://stays.example/about","fc":true}
        ]));
        let text = |name: &str| {
            SemanticExtractionFieldSchema::try_text(name.into(), true, 128)
                .unwrap()
                .with_verbatim_text()
                .unwrap()
        };
        let schema = SemanticExtractionSchema::try_new(
            SemanticExtractionSchemaId::new(1).unwrap(),
            vec![SemanticExtractionFieldSchema::try_rows(
                "stays".into(),
                true,
                vec![
                    text("name"),
                    SemanticExtractionFieldSchema::try_url("url".into(), true, 2048).unwrap(),
                    text("price"),
                    text("settings"),
                ],
                3,
            )
            .unwrap()],
        )
        .unwrap();
        let read = crate::read_semantic_observation_for_schema(
            &observation,
            SemanticReadAuthority::Initial,
            SemanticCaptureInstant::from_millis(1),
            SemanticReadSensitivityLimit::PublicOnly,
            SemanticReadBudget::STANDARD,
            &schema,
        )
        .unwrap();
        for fragment in read.fragments().iter().filter(|fragment| {
            fragment_text(**fragment)
                .is_some_and(|text| matches!(text, "Help" | "Help link" | "About" | "About link"))
        }) {
            assert!(
                fragment.record_root().is_none(),
                "navigation is not a product card"
            );
        }
        let delivery = delivered(&read);
        let token = |text: &str| {
            read.fragments()
                .iter()
                .find(|fragment| fragment_text(**fragment) == Some(text))
                .unwrap()
                .id()
                .model_token()
        };
        let admit = |url: &str, price: &str| {
            let output = json!({"fields":[{"name":"stays","value":{"k":"rows","items":[{"fields":[
                {"name":"name","value":{"k":"text","sources":[token("Amber stay")]}},
                {"name":"url","value":{"k":"url","sources":[token(url)]}},
                {"name":"price","value":{"k":"text","sources":[token(price)]}},
                {"name":"settings","value":{"k":"text","sources":[token("Nov 18 – 21; two guests")]}}
            ]}]}}]});
            extract_semantic_read(
                &schema,
                &read,
                &delivery,
                SemanticReadSensitivityLimit::PublicOnly,
                &serde_json::to_vec(&output).unwrap(),
            )
        };
        assert!(admit("https://stays.example/amber?guests=2", "$218 total").is_ok());
        for (url, price) in [
            ("https://stays.example/blue?guests=2", "$218 total"),
            ("https://stays.example/amber?guests=2", "$264 total"),
        ] {
            assert!(matches!(
                admit(url, price),
                Err(SemanticExtractionError::RecordBoundary)
            ));
        }
        assert!(semantic_extraction_refusal_is_retryable(
            SemanticExtractionError::RecordBoundary
        ));
    }

    #[test]
    fn flattened_record_repair_preserves_each_value_and_its_delivered_source() {
        let mut nodes = vec![json!({"k":1,"r":"document","fc":true})];
        for index in 0..3 {
            nodes.extend([
                json!({"k":index*3+2,"p":0,"r":"heading","l":2,"n":format!("Stay {index}"),"fc":true}),
                json!({"k":index*3+3,"p":0,"r":"link","n":format!("Stay {index}"),"u":format!("https://example.test/stay/{index}?adults=2&date=2026-11-18"),"fc":true}),
                json!({"k":index*3+4,"p":0,"r":"paragraph","t":format!("{} EUR",100+index),"fc":true}),
            ]);
        }
        let observation = observation_with_nodes(Value::Array(nodes));
        let schema = SemanticExtractionSchema::try_new(
            SemanticExtractionSchemaId::new(1).unwrap(),
            vec![SemanticExtractionFieldSchema::try_rows(
                "listings".into(),
                true,
                vec![
                    SemanticExtractionFieldSchema::try_text("name".into(), true, 200)
                        .unwrap()
                        .with_verbatim_text()
                        .unwrap(),
                    SemanticExtractionFieldSchema::try_url("url".into(), true, 2048).unwrap(),
                    SemanticExtractionFieldSchema::try_text("price".into(), false, 64)
                        .unwrap()
                        .with_verbatim_text()
                        .unwrap(),
                ],
                3,
            )
            .unwrap()],
        )
        .unwrap();
        let read = crate::read_semantic_observation_for_schema(
            &observation,
            SemanticReadAuthority::Initial,
            SemanticCaptureInstant::from_millis(31),
            SemanticReadSensitivityLimit::PublicOnly,
            SemanticReadBudget::STANDARD,
            &schema,
        )
        .unwrap();
        let delivery = delivered(&read);
        let token = |text: &str| {
            read.fragments()
                .iter()
                .find(|fragment| fragment_text(**fragment) == Some(text))
                .unwrap()
                .id()
                .model_token()
        };
        let fields: Vec<Value> = (0..3).flat_map(|index| [
            json!({"name":"name","value":{"k":"text","value":format!("Stay {index}"),"sources":[token(&format!("Stay {index}"))]}}),
            json!({"name":"url","value":{"k":"url","sources":[token(&format!("https://example.test/stay/{index}?adults=2&date=2026-11-18"))]}}),
            json!({"name":"price","value":{"k":"text","value":format!("{} EUR",100+index),"sources":[token(&format!("{} EUR",100+index))]}}),
        ]).collect();
        let output = json!({"fields":[{"name":"listings","value":{"k":"rows","items":[{"fields":fields}]}}]});
        let admit = |output: &Value| {
            extract_semantic_read(
                &schema,
                &read,
                &delivery,
                SemanticReadSensitivityLimit::PublicOnly,
                &serde_json::to_vec(output).unwrap(),
            )
        };
        let result = admit(&output).unwrap();
        let SemanticExtractedValue::Rows(rows) = result.fields()[0].value() else {
            panic!("rows")
        };
        assert_eq!(rows.items().len(), 3);
        assert_eq!(result.stats().dropped(), 0);
        for (index, row) in rows.items().iter().enumerate() {
            let values: Vec<_> = row
                .fields()
                .iter()
                .map(|field| match field.value() {
                    SemanticExtractedValue::Text(text) | SemanticExtractedValue::Url(text) => {
                        text.as_str()
                    }
                    _ => panic!("scalar"),
                })
                .collect();
            assert_eq!(
                values,
                vec![
                    format!("Stay {index}"),
                    format!("https://example.test/stay/{index}?adults=2&date=2026-11-18"),
                    format!("{} EUR", 100 + index)
                ]
            );
        }
        let mut ambiguous = output.clone();
        ambiguous["fields"][0]["value"]["items"][0]["fields"]
            .as_array_mut()
            .unwrap()
            .remove(4);
        assert_eq!(
            admit(&ambiguous).unwrap_err(),
            SemanticExtractionError::DuplicateField
        );
        let mut forged = output.clone();
        forged["fields"][0]["value"]["items"][0]["fields"][3]["value"] =
            json!({"k":"text","value":"Not on this page","sources":["@r999"]});
        let result = admit(&forged).unwrap();
        let SemanticExtractedValue::Rows(rows) = result.fields()[0].value() else {
            panic!("rows")
        };
        assert_eq!(rows.items().len(), 2);
        assert!(result.stats().dropped() > 0);
    }

    #[test]
    fn record_collection_preserves_optional_fields_and_per_cell_provenance() {
        let observation = observation();
        let read = read(&observation, 31);
        let delivery = delivered(&read);
        let schema = SemanticExtractionSchema::try_new(
            SemanticExtractionSchemaId::new(29).unwrap(),
            vec![SemanticExtractionFieldSchema::try_rows(
                "records".into(),
                true,
                vec![
                    SemanticExtractionFieldSchema::try_text("name".into(), true, 64).unwrap(),
                    SemanticExtractionFieldSchema::try_unsigned("count".into(), false, 100)
                        .unwrap(),
                ],
                2,
            )
            .unwrap()],
        )
        .unwrap();
        let output = json!({"v":1,"schema":29,"fields":[{"name":"records","value":{"k":"rows","items":[
            {"fields":[{"name":"name","value":{"k":"text","value":"Quarterly summary","sources":["@r1"]}},{"name":"count","value":{"k":"unsigned","value":42,"sources":["@r2"]}}]},
            {"fields":[{"name":"name","value":{"k":"text","value":"Another record","sources":["@r1"]}}]}
        ]}}]});
        let extract = |value: &Value| {
            extract_semantic_read(
                &schema,
                &read,
                &delivery,
                SemanticReadSensitivityLimit::PublicOnly,
                &serde_json::to_vec(value).unwrap(),
            )
        };
        let result = extract(&output).unwrap().into_owned().unwrap();
        let SemanticExtractedValue::Rows(rows) = result.fields()[0].value() else {
            panic!()
        };
        assert_eq!(rows.items().len(), 2);
        assert_eq!(rows.items()[1].fields().len(), 1);
        let SemanticExtractedValue::Unsigned(count) = rows.items()[0].fields()[1].value() else {
            panic!()
        };
        assert_eq!(
            result
                .sources(count.source_span())
                .unwrap()
                .next()
                .unwrap()
                .id
                .get(),
            2
        );
        assert_eq!(result.stats().values(), 3);
        assert!(!format!("{rows:?}").contains("Quarterly"));
        // A record whose own evidence fails is left out; the others stand.
        let rows_of = |value: &Value| {
            let result = extract(value).unwrap().into_owned().unwrap();
            let dropped = result.stats().dropped();
            let SemanticExtractedValue::Rows(rows) = result.fields()[0].value() else {
                panic!()
            };
            (
                rows.items()
                    .iter()
                    .map(|row| row.fields().len())
                    .collect::<Vec<_>>(),
                dropped,
            )
        };
        let mut missing = output.clone();
        missing["fields"][0]["value"]["items"][0]["fields"] = json!([]);
        assert_eq!(rows_of(&missing), (vec![1], 1));
        let mut foreign = output.clone();
        foreign["fields"][0]["value"]["items"][0]["fields"][1]["value"]["sources"] =
            json!(["@r999"]);
        assert_eq!(rows_of(&foreign), (vec![1, 1], 1));
        let mut sensitive = output.clone();
        sensitive["fields"][0]["value"]["items"][0]["fields"][1]["value"]["sources"] =
            json!(["@r5"]);
        assert_eq!(rows_of(&sensitive), (vec![1, 1], 1));
        let mut nameless = output.clone();
        nameless["fields"][0]["value"]["items"][1]["fields"][0]["value"]["sources"] =
            json!(["@r999"]);
        assert_eq!(rows_of(&nameless), (vec![2], 1));
        // A miscited name the page shows verbatim is cited where it appears.
        let mut miscited = output.clone();
        miscited["fields"][0]["value"]["items"][0]["fields"][0]["value"]["sources"] =
            json!(["@r999"]);
        assert_eq!(rows_of(&miscited), (vec![2, 1], 0));
        let mut none = nameless.clone();
        none["fields"][0]["value"]["items"][0]["fields"][0]["value"] =
            json!({"k":"text","value":"Not on the page","sources":["@r999"]});
        assert_eq!(
            extract(&none).unwrap_err(),
            SemanticExtractionError::SourceMissing
        );
        let mut excess = output.clone();
        excess["fields"][0]["value"]["items"]
            .as_array_mut()
            .unwrap()
            .push(output["fields"][0]["value"]["items"][0].clone());
        assert_eq!(rows_of(&excess), (vec![2, 1], 1));
    }

    #[test]
    fn descriptive_record_names_keep_their_own_card_image() {
        let observation = observation_with_media(
            json!([
                {"k":1,"r":"document","fc":true},
                {"k":2,"p":0,"r":"group","fc":true},
                {"k":3,"p":1,"r":"link","n":"Amber record","u":"https://example.test/amber","fc":true},
                {"k":4,"p":1,"r":"image","b":{"x":10,"y":30,"w":128,"h":96},"m":"https://example.test/amber.png","fc":true},
                {"k":5,"p":1,"r":"paragraph","t":"Quiet flat with a balcony","fc":true},
                {"k":6,"p":0,"r":"group","fc":true},
                {"k":7,"p":5,"r":"link","n":"Blue record","u":"https://example.test/blue","fc":true},
                {"k":8,"p":5,"r":"image","b":{"x":240,"y":30,"w":128,"h":96},"m":"https://example.test/blue.png","fc":true},
                {"k":9,"p":5,"r":"paragraph","t":"Bright studio by the park","fc":true}
            ]),
            "complete",
            json!([
                {"k":4,"t":"image","r":[3],"l":true},
                {"k":8,"t":"image","r":[7],"l":true}
            ]),
        );
        let schema = SemanticExtractionSchema::try_new(
            SemanticExtractionSchemaId::new(1).unwrap(),
            vec![SemanticExtractionFieldSchema::try_rows(
                "stays".into(),
                true,
                vec![
                    SemanticExtractionFieldSchema::try_text("name".into(), true, 128)
                        .unwrap()
                        .with_verbatim_text()
                        .unwrap(),
                    SemanticExtractionFieldSchema::try_image_url("image".into(), false, 2048)
                        .unwrap(),
                ],
                2,
            )
            .unwrap()],
        )
        .unwrap();
        let read = crate::read_semantic_observation_for_schema(
            &observation,
            SemanticReadAuthority::Initial,
            SemanticCaptureInstant::from_millis(1),
            SemanticReadSensitivityLimit::PublicOnly,
            SemanticReadBudget::STANDARD,
            &schema,
        )
        .unwrap();
        let token = |text: &str| {
            read.fragments()
                .iter()
                .find(|fragment| fragment_text(**fragment) == Some(text))
                .unwrap()
                .id()
                .model_token()
        };
        let items: Vec<_> = ["Quiet flat with a balcony", "Bright studio by the park"].into_iter().map(|name|
            json!({"fields":[{"name":"name","value":{"k":"text","sources":[token(name)]}}]})
        ).collect();
        let output = json!({"fields":[{"name":"stays","value":{"k":"rows","items":items}}]});
        let result = extract_semantic_read(
            &schema,
            &read,
            &delivered(&read),
            SemanticReadSensitivityLimit::PublicOnly,
            &serde_json::to_vec(&output).unwrap(),
        )
        .unwrap();
        let SemanticExtractedValue::Rows(rows) = result.fields()[0].value() else {
            panic!("rows");
        };
        for (row, expected) in rows.items().iter().zip([
            "https://example.test/amber.png",
            "https://example.test/blue.png",
        ]) {
            assert!(
                matches!(row.fields()[1].value(), SemanticExtractedValue::ImageUrl(url) if url.as_str() == expected)
            );
        }
        assert_eq!(result.media.len(), 2);
        assert!(result
            .media
            .iter()
            .all(|media| !media.local_crop_permitted(std::time::Instant::now())));
    }

    #[test]
    fn record_container_plan_is_exact_name_bound_and_lower_priority_than_a_loaded_picture() {
        for loaded in [false, true] {
            let observation = observation_with_media(
                json!([
                    {"k":1,"r":"document","fc":true},
                    {"k":2,"p":0,"r":"document","b":{"x":0,"y":0,"w":220,"h":140},"fc":true},
                    {"k":3,"p":1,"r":"heading","l":2,"n":"Amber record","fc":true},
                    {"k":4,"p":1,"r":"image","b":{"x":10,"y":30,"w":128,"h":96},"m":"https://example.test/amber.png","fc":true},
                    {"k":5,"p":0,"r":"document","b":{"x":230,"y":0,"w":220,"h":140},"fc":true},
                    {"k":6,"p":4,"r":"heading","l":2,"n":"Blue record","fc":true}
                ]),
                "complete",
                json!([
                    {"k":2,"t":"record","r":[3],"l":true},
                    {"k":4,"t":"image","r":[3],"l":loaded},
                    {"k":5,"t":"record","r":[6],"l":true}
                ]),
            );
            let read = read(&observation, 31);
            let source = |name: &str| {
                read.fragments()
                    .iter()
                    .find(|fragment| {
                        fragment
                            .content()
                            .text()
                            .is_some_and(|value| value.as_str() == name)
                    })
                    .unwrap()
                    .id()
            };
            let mut counts = read.media_diagnostics();
            read.count_media_relations(&[source("Amber record")], &mut counts);
            read.count_media_relations(&[source("Blue record")], &mut counts);
            assert_eq!(
                counts,
                crate::SemanticRecordMediaDiagnostics {
                    observed_images: 1,
                    eligible_image_geometry: 1,
                    structural_candidates: 3,
                    saturated_candidates: 0,
                    identity_roles: [2, 0, 0, 0, 0, 0, 0],
                    identity_fields: [2, 0, 0, 0],
                    self_image_pairs: 0,
                    records: 2,
                    identity_sources: 2,
                    same_capture_pairs: 6,
                    related_pairs: 3,
                }
            );
            let amber = read
                .media_for_record(0, &[source("Amber record")], [7; 32])
                .unwrap();
            let blue = read
                .media_for_record(1, &[source("Blue record")], [7; 32])
                .unwrap();
            assert_eq!(amber.key, if loaded { 4 } else { 2 });
            assert_eq!(blue.key, 5);
            assert!(
                !amber.local_crop_permitted(std::time::Instant::now()),
                "DOM metadata cannot mint screenshot permission"
            );
            assert_ne!(amber.source(), blue.source());
        }
    }

    #[test]
    fn local_crop_permission_cannot_change_account_context_deadline_or_permission() {
        use crate::{
            AgentAccountAttestationId, AgentAccountId, AgentAccountScope,
            AgentContextAccountBinding as Binding,
        };
        let context = observation().request().context();
        let other = crate::ContextJoin::work_execution(
            ContextIdentity::new(
                ContextId::from_raw(999),
                context.identity().owner(),
                context.identity().profile(),
                ContextKind::Owned,
            ),
            context.context_generation(),
            context.navigation_epoch(),
            context.frame_generation(),
        );
        let account = Binding::new(
            AgentAccountAttestationId::generate(),
            context,
            AgentAccountScope::Authenticated(AgentAccountId::generate()),
            crate::AgentPolicyInstant::from_millis(1),
        );
        let changed = Binding::new(
            AgentAccountAttestationId::generate(),
            context,
            AgentAccountScope::Authenticated(AgentAccountId::generate()),
            crate::AgentPolicyInstant::from_millis(1),
        );
        let refreshed = Binding::new(
            AgentAccountAttestationId::generate(),
            context,
            account.account(),
            crate::AgentPolicyInstant::from_millis(2),
        );
        let now = std::time::Instant::now();
        let expires = now + std::time::Duration::from_secs(2);
        assert!(crate::semantic_media::SemanticRecordCropPermit::admit(
            context, account, account, true, now, expires
        )
        .is_some());
        assert!(
            crate::semantic_media::SemanticRecordCropPermit::admit(
                context, account, refreshed, true, now, expires
            )
            .is_none(),
            "a stale sample is never silently treated as the refreshed attestation"
        );
        assert!(
            crate::semantic_media::SemanticRecordCropPermit::admit(
                context, refreshed, refreshed, true, now, expires
            )
            .is_some(),
            "only the verified sample frozen before mapping can remain exact"
        );
        assert!(crate::semantic_media::SemanticRecordCropPermit::admit(
            context, account, account, false, now, expires
        )
        .is_none());
        assert!(crate::semantic_media::SemanticRecordCropPermit::admit(
            context, account, changed, true, now, expires
        )
        .is_none());
        assert!(crate::semantic_media::SemanticRecordCropPermit::admit(
            other, account, account, true, now, expires
        )
        .is_none());
        assert!(crate::semantic_media::SemanticRecordCropPermit::admit(
            context, account, account, true, now, now
        )
        .is_none());
        assert!(crate::semantic_media::SemanticRecordCropPermit::admit(
            context,
            account,
            account,
            true,
            now,
            now + std::time::Duration::from_secs(9)
        )
        .is_none());
    }

    #[test]
    fn local_crop_budget_is_shared_one_shot_and_cannot_be_replayed_after_expiry() {
        use crate::semantic_media::{SemanticRecordCropPermit, SemanticRecordMediaPlan};
        use crate::{AgentAccountAttestationId, AgentAccountScope, AgentContextAccountBinding};
        use std::sync::atomic::{AtomicU8, Ordering};
        let observation = observation();
        let context = observation.request().context();
        let account = AgentContextAccountBinding::new(
            AgentAccountAttestationId::generate(),
            context,
            AgentAccountScope::Anonymous,
            crate::AgentPolicyInstant::from_millis(1),
        );
        let now = std::time::Instant::now();
        let expires = now + std::time::Duration::from_secs(2);
        let mut permission =
            SemanticRecordCropPermit::admit(context, account, account, true, now, expires).unwrap();
        permission.remaining = std::sync::Arc::new(AtomicU8::new(1));
        let mut plan = SemanticRecordMediaPlan {
            outcome: Default::default(),
            fetch_stage: Default::default(),
            crop: None,
            record: 0,
            source: [1; 32],
            frame: observation.frames()[0].frame().clone(),
            invocation: crate::SemanticInvocationId::new(1).unwrap(),
            snapshot: crate::SemanticSnapshotGeneration::new(1).unwrap(),
            key: 2,
            name_key: 3,
        };
        let native = plan.clone();
        native.record_native_outcome(crate::SemanticRecordMediaOutcome::MissingSource);
        assert!(plan.native_outcome().permits_public_candidate());
        native.record_native_outcome(crate::SemanticRecordMediaOutcome::PrivacyRefused);
        native.record_native_outcome(crate::SemanticRecordMediaOutcome::Fetched);
        assert_eq!(
            plan.native_outcome(),
            crate::SemanticRecordMediaOutcome::PrivacyRefused
        );
        assert!(!plan.native_outcome().permits_public_candidate());
        assert!(
            !plan.begin_local_crop(now),
            "an archive alone has no crop permission"
        );
        plan.crop = Some(permission.for_record());
        let same_record = plan.clone();
        let mut sibling = plan.clone();
        sibling.record = 1;
        sibling.crop = Some(permission.for_record());
        assert!(plan.begin_local_crop(now));
        assert!(
            !same_record.begin_local_crop(now),
            "clones cannot replay the reservation"
        );
        assert!(
            !sibling.begin_local_crop(now),
            "records share the original remaining budget"
        );
        assert_eq!(permission.remaining.load(Ordering::Acquire), 0);
        assert!(plan.local_crop_reserved(now));
        assert!(
            !plan.local_crop_reserved(expires),
            "a spent reservation cannot extend its original deadline"
        );
    }

    #[test]
    fn cited_public_picture_is_a_candidate_without_native_pixel_authority() {
        let observation = observation_with_nodes(json!([
            {"k":1,"r":"document","o":16},
            {"k":2,"p":0,"r":"heading","l":1,"n":"Cabin Alpha"},
            {"k":3,"p":0,"r":"image","n":"Cabin Alpha","m":"https://images.example.test/sibling.jpg"}
        ]));
        let schema = SemanticExtractionSchema::try_new(
            SemanticExtractionSchemaId::new(1).unwrap(),
            vec![SemanticExtractionFieldSchema::try_rows(
                "records".into(),
                true,
                vec![
                    SemanticExtractionFieldSchema::try_text("name".into(), true, 512).unwrap(),
                    SemanticExtractionFieldSchema::try_image_url("photo".into(), false, 2048)
                        .unwrap(),
                ],
                8,
            )
            .unwrap()],
        )
        .unwrap();
        let read = crate::read_semantic_observation_for_schema(
            &observation,
            SemanticReadAuthority::Initial,
            SemanticCaptureInstant::from_millis(31),
            SemanticReadSensitivityLimit::PublicOnly,
            SemanticReadBudget::STANDARD,
            &schema,
        )
        .unwrap();
        let token = |field| {
            read.fragments()
                .iter()
                .find(|fragment| fragment.field() == field)
                .unwrap()
                .id()
                .model_token()
        };
        let output = json!({"v":1,"schema":1,"fields":[{"name":"records","value":{"k":"rows","items":[{"fields":[
            {"name":"name","value":{"k":"text","value":"Cabin Alpha","sources":[token(crate::SemanticReadField::AccessibleName)]}},
            {"name":"photo","value":{"k":"image_url","value":"https://images.example.test/sibling.jpg","sources":[token(crate::SemanticReadField::ImageSource)]}}
        ]}]}}]});
        let result = extract_semantic_read(
            &schema,
            &read,
            &delivered(&read),
            SemanticReadSensitivityLimit::PublicOnly,
            &serde_json::to_vec(&output).unwrap(),
        )
        .unwrap();
        let SemanticExtractedValue::Rows(rows) = result.fields()[0].value() else {
            panic!("rows")
        };
        assert_eq!(rows.items().len(), 1);
        assert_eq!(rows.items()[0].fields().len(), 2);
        assert_eq!(rows.items()[0].fields()[0].name(), "name");
        assert_eq!(result.stats().dropped(), 0);
        assert!(
            result.media.is_empty(),
            "a cited URL never mints a native pixel/crop plan"
        );
        let mut missing = output.clone();
        missing["fields"][0]["value"]["items"][0]["fields"]
            .as_array_mut()
            .unwrap()
            .pop();
        let repaired = extract_semantic_read(
            &schema,
            &read,
            &delivered(&read),
            SemanticReadSensitivityLimit::PublicOnly,
            &serde_json::to_vec(&missing).unwrap(),
        )
        .unwrap();
        let SemanticExtractedValue::Rows(rows) = repaired.fields()[0].value() else {
            panic!("rows")
        };
        assert_eq!(
            rows.items()[0].fields().len(),
            2,
            "the observed named-image candidate also fills an omitted optional image field"
        );
        assert!(repaired.media.is_empty());
    }

    #[test]
    fn listing_records_bind_pictures_to_native_card_provenance_not_image_names() {
        // Shaped like the recorded amazon.com and x-kom.pl listings: the model
        // cites the card text for everything, or leaves the link out.
        let corvette = "https://www.amazon.com/LEGO-Technic-Chevrolet-Corvette-Stingray/dp/B0DFTPRHFK/ref=sr_1_1";
        let mclaren =
            "https://www.amazon.com/LEGO-Technic-McLaren-Hypercar/dp/B0CWH4RKRP/ref=sr_1_3";
        let observation = observation_with_media(
            json!([
                {"k":1,"r":"document","o":16},
                {"k":2,"p":0,"r":"list_item","t":"LEGO 2K+ bought in past month Price, product page PLN 230.57"},
                {"k":3,"p":0,"r":"image","n":"Wrong unrelated label","b":{"x":0,"y":0,"w":160,"h":110},"m":"https://m.media-amazon.com/images/I/810qnPKsqBL.jpg"},
                {"k":4,"p":0,"r":"link","n":"Technic Chevrolet Corvette Stingray Toy Car - Model Car Kit for Display - 42205","u":corvette},
                {"k":5,"p":0,"r":"link","n":"PLN 230.57","u":corvette},
                {"k":6,"p":0,"r":"list_item","t":"LEGO Price, product page PLN 1 299,00 zł"},
                {"k":7,"p":0,"r":"image","b":{"x":200,"y":0,"w":160,"h":110},"m":"https://m.media-amazon.com/images/I/71mclaren.jpg"},
                {"k":8,"p":0,"r":"link","n":"LEGO Technic McLaren P1 Hypercar","u":mclaren},
                {"k":9,"p":0,"r":"paragraph","t":"1 299,00 zł"}
            ]),
            "complete",
            json!([
                {"k":3,"t":"image","r":[2,4,5],"l":true},
                {"k":7,"t":"image","r":[6,8,9],"l":true}
            ]),
        );
        let row = vec![
            SemanticExtractionFieldSchema::try_text("name".into(), true, 512).unwrap(),
            SemanticExtractionFieldSchema::try_text("price".into(), false, 1024)
                .unwrap()
                .with_verbatim_text()
                .unwrap(),
            SemanticExtractionFieldSchema::try_url("url".into(), true, 2048).unwrap(),
            SemanticExtractionFieldSchema::try_image_url("photo".into(), false, 2048).unwrap(),
        ];
        let schema = SemanticExtractionSchema::try_new(
            SemanticExtractionSchemaId::new(1).unwrap(),
            vec![SemanticExtractionFieldSchema::try_rows("output_0".into(), true, row, 8).unwrap()],
        )
        .unwrap();
        let read = crate::read_semantic_observation_for_schema(
            &observation,
            SemanticReadAuthority::Initial,
            SemanticCaptureInstant::from_millis(31),
            SemanticReadSensitivityLimit::PublicOnly,
            SemanticReadBudget::STANDARD,
            &schema,
        )
        .unwrap();
        let delivery = delivered(&read);
        let token = |text: &str| {
            read.fragments()
                .iter()
                .find(|fragment| fragment_text(**fragment) == Some(text))
                .unwrap()
                .id()
                .model_token()
        };
        let card = token("LEGO Price, product page PLN 1 299,00 zł");
        // No envelope header, a url cited from card text, no picture, and a
        // record given as a plain object map.
        let output = json!({"fields":[{"name":"output_0","value":{"k":"rows","items":[
            {"fields":[
                {"name":"name","value":{"k":"text","value":"LEGO Technic Chevrolet Corvette Stingray Toy Car - Model Car Kit for Display - 42205","sources":[token("LEGO 2K+ bought in past month Price, product page PLN 230.57")]}},
                {"name":"price","value":{"k":"text","sources":[token("PLN 230.57")]}},
                {"name":"url","value":{"k":"url","sources":[token("PLN 230.57")]}}
            ]},
            {"name":{"value":"LEGO Technic McLaren P1 Hypercar","sources":[card.clone()]},
             "price":{"k":"text","sources":[token("1 299,00 zł")]},
             "url":{"k":"url","sources":[card]}}
        ]}}]});
        // A mapping that admits no record is told so once; one that admits
        // any is not.
        let empty = json!({"fields":[{"name":"output_0","value":{"k":"rows","items":[]}}]});
        assert!(extract_semantic_read(
            &schema,
            &read,
            &delivery,
            SemanticReadSensitivityLimit::PublicOnly,
            &serde_json::to_vec(&empty).unwrap(),
        )
        .unwrap()
        .is_empty());
        let result = extract_semantic_read(
            &schema,
            &read,
            &delivery,
            SemanticReadSensitivityLimit::PublicOnly,
            &serde_json::to_vec(&output).unwrap(),
        )
        .unwrap();
        assert!(!result.is_empty());
        let result = result.into_owned().unwrap();
        let SemanticExtractedValue::Rows(rows) = result.fields()[0].value() else {
            panic!("rows");
        };
        let cells: Vec<Vec<(String, String)>> = rows
            .items()
            .iter()
            .map(|row| {
                row.fields()
                    .iter()
                    .map(|field| {
                        let text = match field.value() {
                            SemanticExtractedValue::Text(text)
                            | SemanticExtractedValue::Url(text)
                            | SemanticExtractedValue::ImageUrl(text) => text.as_str().to_owned(),
                            _ => panic!("kind"),
                        };
                        (field.name().to_owned(), text)
                    })
                    .collect()
            })
            .collect();
        assert_eq!(cells.len(), 2);
        assert_eq!(cells[0][1], ("price".into(), "PLN 230.57".into()));
        assert_eq!(cells[0][2], ("url".into(), corvette.into()));
        assert_eq!(
            cells[0][3],
            (
                "photo".into(),
                "https://m.media-amazon.com/images/I/810qnPKsqBL.jpg".into()
            )
        );
        assert_eq!(cells[1][1], ("price".into(), "1 299,00 zł".into()));
        assert_eq!(cells[1][2], ("url".into(), mclaren.into()));
        assert_eq!(
            cells[1][3],
            (
                "photo".into(),
                "https://m.media-amazon.com/images/I/71mclaren.jpg".into()
            )
        );
    }

    #[test]
    fn only_a_text_value_may_cite_the_viewport_image_and_it_is_read_from_pixels() {
        // A gallery whose prices are drawn as images: little text, pictures.
        let observation = observation_with_nodes(json!([
            {"k":1,"r":"document","o":16},
            {"k":2,"p":0,"r":"heading","l":1,"n":"Sets"},
            {"k":3,"p":0,"r":"image","n":"Technic 42205"}
        ]));
        assert!(crate::semantic_observation_reads_sparse(&observation));
        let row = vec![
            SemanticExtractionFieldSchema::try_text("name".into(), true, 512).unwrap(),
            SemanticExtractionFieldSchema::try_text("price".into(), false, 1024)
                .unwrap()
                .with_verbatim_text()
                .unwrap(),
            SemanticExtractionFieldSchema::try_url("url".into(), false, 2048).unwrap(),
        ];
        let schema = SemanticExtractionSchema::try_new(
            SemanticExtractionSchemaId::new(1).unwrap(),
            vec![SemanticExtractionFieldSchema::try_rows("output_0".into(), true, row, 8).unwrap()],
        )
        .unwrap();
        let read = crate::read_semantic_observation_for_schema_with_viewport_image(
            &observation,
            SemanticReadAuthority::Initial,
            SemanticCaptureInstant::from_millis(31),
            SemanticReadSensitivityLimit::PublicOnly,
            SemanticReadBudget::EXTRACTION,
            &schema,
        )
        .unwrap();
        let delivery = delivered(&read);
        let token = |field: crate::SemanticReadField| {
            read.fragments()
                .iter()
                .find(|fragment| fragment.field() == field)
                .unwrap()
                .id()
                .model_token()
        };
        let pixels = token(crate::SemanticReadField::ViewportImage);
        let name = token(crate::SemanticReadField::AccessibleName);
        let output = json!({"fields":[{"name":"output_0","value":{"k":"rows","items":[
            {"fields":[
                {"name":"name","value":{"k":"text","value":"Technic 42205","sources":[name]}},
                {"name":"price","value":{"k":"text","value":"899 zł","sources":[pixels.clone()]}},
                {"name":"url","value":{"k":"url","sources":[pixels.clone()]}}
            ]}
        ]}}]});
        let result = extract_semantic_read(
            &schema,
            &read,
            &delivery,
            SemanticReadSensitivityLimit::PublicOnly,
            &serde_json::to_vec(&output).unwrap(),
        )
        .unwrap();
        let SemanticExtractedValue::Rows(rows) = result.fields()[0].value() else {
            panic!("rows");
        };
        let fields = rows.items()[0].fields();
        // The price stands as read from the image; a link cannot come from it.
        assert!(fields.iter().any(|field| field.name() == "price"
            && matches!(field.value(), SemanticExtractedValue::Text(price) if price.as_str() == "899 zł")));
        assert!(!fields.iter().any(|field| field.name() == "url"));
        // A look holding anything private gets no viewport image.
        let private = observation_with_nodes(json!([
            {"k":1,"r":"document","o":16},
            {"k":2,"p":0,"r":"textbox","n":"Email","q":"sensitive"}
        ]));
        let read = crate::read_semantic_observation_for_schema_with_viewport_image(
            &private,
            SemanticReadAuthority::Initial,
            SemanticCaptureInstant::from_millis(31),
            SemanticReadSensitivityLimit::PublicOnly,
            SemanticReadBudget::EXTRACTION,
            &schema,
        )
        .unwrap();
        assert!(!read
            .fragments()
            .iter()
            .any(|fragment| fragment.field() == crate::SemanticReadField::ViewportImage));
    }

    #[test]
    fn record_links_printed_in_cited_page_facts_resolve_against_the_page() {
        // Shaped like the recorded x-kom.pl page facts: one summary paragraph
        // lists every product with a site-relative address.
        let observation = observation_with_nodes(json!([
            {"k":1,"r":"document","o":16},
            {"k":2,"p":0,"r":"paragraph","n":"Page facts","t":"product: Acer Aspire 14 AI/32GB | price: 3249 PLN | url: /p/1322289-acer.html ;; product: Dell 15 Ryzen 7/32GB | price: 4399 PLN | url: /p/1520309-dell.html"}
        ]));
        let row = vec![
            SemanticExtractionFieldSchema::try_text("name".into(), true, 512).unwrap(),
            SemanticExtractionFieldSchema::try_text("price".into(), false, 1024)
                .unwrap()
                .with_verbatim_text()
                .unwrap(),
            SemanticExtractionFieldSchema::try_url("url".into(), true, 2048).unwrap(),
        ];
        let schema = SemanticExtractionSchema::try_new(
            SemanticExtractionSchemaId::new(1).unwrap(),
            vec![SemanticExtractionFieldSchema::try_rows("output_0".into(), true, row, 8).unwrap()],
        )
        .unwrap();
        let read = crate::read_semantic_observation_for_schema(
            &observation,
            SemanticReadAuthority::Initial,
            SemanticCaptureInstant::from_millis(31),
            SemanticReadSensitivityLimit::PublicOnly,
            SemanticReadBudget::EXTRACTION,
            &schema,
        )
        .unwrap();
        let delivery = delivered(&read);
        let facts = read
            .fragments()
            .iter()
            .find(|fragment| fragment.field() == crate::SemanticReadField::VisibleText)
            .unwrap()
            .id()
            .model_token();
        let output = json!({"fields":[{"name":"output_0","value":{"k":"rows","items":[
            {"fields":[
                {"name":"name","value":{"k":"text","value":"Acer Aspire 14 AI/32GB","sources":[facts]}},
                {"name":"price","value":{"k":"text","value":"3249 PLN","sources":[facts]}},
                {"name":"url","value":{"k":"url","sources":[facts]}}
            ]},
            {"fields":[
                {"name":"name","value":{"k":"text","value":"Dell 15 Ryzen 7/32GB","sources":[facts]}},
                {"name":"price","value":{"k":"text","value":"4399 PLN or less","sources":[facts]}},
                {"name":"url","value":{"k":"url","value":"/p/1520309-dell.html","sources":[facts]}}
            ]}
        ]}}]});
        let result = extract_semantic_read(
            &schema,
            &read,
            &delivery,
            SemanticReadSensitivityLimit::PublicOnly,
            &serde_json::to_vec(&output).unwrap(),
        )
        .unwrap();
        let SemanticExtractedValue::Rows(rows) = result.fields()[0].value() else {
            panic!("rows");
        };
        // A price column copies one amount the cited text shows; a price
        // written with words around it publishes the amount it names.
        assert!(
            matches!(rows.items()[0].fields()[1].value(), SemanticExtractedValue::Text(price) if price.as_str() == "3249 PLN")
        );
        assert!(
            matches!(rows.items()[1].fields()[1].value(), SemanticExtractedValue::Text(price) if price.as_str() == "4399 PLN")
        );
        let urls: Vec<_> = rows
            .items()
            .iter()
            .map(|row| match row.fields().last().unwrap().value() {
                SemanticExtractedValue::Url(url) => url.as_str().to_owned(),
                _ => panic!("url"),
            })
            .collect();
        assert_eq!(
            urls,
            [
                "https://extract.example.test/p/1322289-acer.html",
                "https://extract.example.test/p/1520309-dell.html"
            ]
        );
    }

    #[test]
    fn record_schema_rejects_nested_collections_and_charges_child_fields() {
        let field = SemanticExtractionFieldSchema::try_text("name".into(), true, 64).unwrap();
        let row =
            SemanticExtractionFieldSchema::try_rows("rows".into(), true, vec![field.clone()], 2)
                .unwrap();
        assert_eq!(
            SemanticExtractionFieldSchema::try_rows("nested".into(), true, vec![row], 2)
                .unwrap_err(),
            SemanticExtractionSchemaError::NestedCollection
        );
        let children = (0..64)
            .map(|i| {
                SemanticExtractionFieldSchema::try_text(format!("field_{i}"), false, 64).unwrap()
            })
            .collect();
        let row =
            SemanticExtractionFieldSchema::try_rows("rows".into(), true, children, 2).unwrap();
        assert_eq!(
            SemanticExtractionSchema::try_new(
                SemanticExtractionSchemaId::new(29).unwrap(),
                vec![row]
            )
            .unwrap_err(),
            SemanticExtractionSchemaError::FieldLimit
        );
    }

    #[test]
    fn selected_sources_cannot_use_unselected_read_tokens_or_different_schema_roles() {
        use crate::{read_selected_semantic_observation, SemanticRole};
        let observation = observation();
        let roles = SemanticReadRoleSelection::try_new(&[SemanticRole::Paragraph]).unwrap();
        let read = read_selected_semantic_observation(
            &observation,
            SemanticReadAuthority::Initial,
            SemanticCaptureInstant::from_millis(31),
            SemanticReadSensitivityLimit::PublicOnly,
            SemanticReadBudget::STANDARD,
            roles,
        )
        .unwrap();
        let delivery = delivered(&read);
        let schema = SemanticExtractionSchema::try_new(
            SemanticExtractionSchemaId::new(29).unwrap(),
            vec![SemanticExtractionFieldSchema::try_text("title".into(), true, 64).unwrap()],
        )
        .unwrap()
        .with_source_roles(roles);
        let mut output = json!({"v":1,"schema":29,"fields":[{"name":"title","value":{"k":"text","value":"Quarterly summary","sources":["@r1"]}}]});
        let encode = |output: &Value| serde_json::to_vec(output).unwrap();
        assert!(extract_semantic_read(
            &schema,
            &read,
            &delivery,
            SemanticReadSensitivityLimit::PublicOnly,
            &encode(&output)
        )
        .is_ok());
        output["fields"][0]["value"] =
            json!({"k":"text","value":"Not on the page","sources":["@r3"]});
        assert_eq!(
            extract_semantic_read(
                &schema,
                &read,
                &delivery,
                SemanticReadSensitivityLimit::PublicOnly,
                &encode(&output)
            )
            .unwrap_err(),
            SemanticExtractionError::SourceMissing
        );
        let all_schema = schema.with_source_roles(SemanticReadRoleSelection::ALL);
        assert_eq!(
            extract_semantic_read(
                &all_schema,
                &read,
                &delivery,
                SemanticReadSensitivityLimit::PublicOnly,
                &encode(&output)
            )
            .unwrap_err(),
            SemanticExtractionError::SchemaMismatch
        );
    }

    #[test]
    fn verbatim_text_copies_its_cited_source_and_preserves_privacy() {
        let observation = observation();
        let read = read(&observation, 31);
        let delivery = delivered(&read);
        let field = SemanticExtractionFieldSchema::try_text("title".into(), true, 64).unwrap();
        let schema = SemanticExtractionSchema::try_new(
            SemanticExtractionSchemaId::new(29).unwrap(),
            vec![field.with_verbatim_text().unwrap()],
        )
        .unwrap();
        for (value, sources, expected) in [
            ("Quarterly summary", json!(["@r1"]), None),
            // Whole words of the cited text, or the same words spaced
            // differently, still copy it.
            ("Quarterly", json!(["@r1"]), None),
            ("Quarterly summary ", json!(["@r1"]), None),
            (
                "Quarterly summ",
                json!(["@r1"]),
                Some(SemanticExtractionError::VerbatimMismatch),
            ),
            (
                "Quarterly summary",
                json!(["@r2"]),
                Some(SemanticExtractionError::VerbatimMismatch),
            ),
            ("Quarterly summary", json!(["@r1", "@r2"]), None),
            (
                "Private customer note",
                json!(["@r5"]),
                Some(SemanticExtractionError::Sensitivity),
            ),
        ] {
            let output = json!({"v":1,"schema":29,"fields":[{
                "name":"title","value":{"k":"text","value":value,"sources":sources}
            }]});
            let result = extract_semantic_read(
                &schema,
                &read,
                &delivery,
                SemanticReadSensitivityLimit::PublicOnly,
                &serde_json::to_vec(&output).unwrap(),
            );
            assert_eq!(result.err(), expected);
        }
        let source_only = json!({"v":1,"schema":29,"fields":[{
            "name":"title","value":{"k":"text","sources":["@r1"]}
        }]});
        let copied = extract_semantic_read(
            &schema,
            &read,
            &delivery,
            SemanticReadSensitivityLimit::PublicOnly,
            &serde_json::to_vec(&source_only).unwrap(),
        )
        .unwrap();
        assert!(
            matches!(copied.fields()[0].value(), SemanticExtractedValue::Text(text) if text.as_str() == "Quarterly summary")
        );
        let generated = SemanticExtractionSchema::try_new(
            schema.id(),
            vec![SemanticExtractionFieldSchema::try_text("title".into(), true, 64).unwrap()],
        )
        .unwrap();
        // A generated text left without a value is its one cited fragment's text.
        let copied = extract_semantic_read(
            &generated,
            &read,
            &delivery,
            SemanticReadSensitivityLimit::PublicOnly,
            &serde_json::to_vec(&source_only).unwrap(),
        )
        .unwrap();
        assert!(
            matches!(copied.fields()[0].value(), SemanticExtractedValue::Text(text) if text.as_str() == "Quarterly summary")
        );
        assert_eq!(
            SemanticExtractionFieldSchema::try_unsigned("count".into(), true, 100)
                .unwrap()
                .with_verbatim_text()
                .unwrap_err(),
            SemanticExtractionSchemaError::VerbatimKind,
        );
    }

    #[test]
    fn verbatim_form_values_copy_only_complete_public_previews() {
        for (value, sensitivity, expected) in [
            ("Warsaw".to_owned(), "public", None),
            (
                "Private location".to_owned(),
                "sensitive",
                Some(SemanticExtractionError::Sensitivity),
            ),
            (
                "x".repeat(crate::MAX_SEMANTIC_VALUE_PREVIEW_BYTES + 1),
                "public",
                Some(SemanticExtractionError::VerbatimMismatch),
            ),
        ] {
            let observation = observation_with_nodes(json!([
                {"k":1,"r":"document","o":16},
                {"k":2,"p":0,"r":"textbox","n":"Destination","v":{"k":"text","value":value},"q":sensitivity,"o":11}
            ]));
            let read = read(&observation, 31);
            let source = read
                .fragments()
                .iter()
                .find(|source| source.field() == crate::SemanticReadField::TextValue)
                .unwrap();
            let schema = SemanticExtractionSchema::try_new(
                SemanticExtractionSchemaId::new(29).unwrap(),
                vec![
                    SemanticExtractionFieldSchema::try_text("location".into(), true, 2048)
                        .unwrap()
                        .with_verbatim_text()
                        .unwrap(),
                ],
            )
            .unwrap();
            let output = json!({"v":1,"schema":29,"fields":[{"name":"location","value":{"k":"text","sources":[source.id().model_token()]}}]});
            let result = extract_semantic_read(
                &schema,
                &read,
                &delivered(&read),
                SemanticReadSensitivityLimit::PublicOnly,
                &serde_json::to_vec(&output).unwrap(),
            );
            match expected {
                Some(error) => assert_eq!(result.unwrap_err(), error),
                None => assert!(
                    matches!(result.unwrap().fields()[0].value(), SemanticExtractedValue::Text(text) if text.as_str() == value)
                ),
            }
        }
    }

    #[test]
    fn admits_schema_ordered_values_with_exact_committed_read_provenance() {
        let observation = observation();
        let read = read(&observation, 31);
        assert_eq!(read.fragments().len(), 5);
        let delivery = delivered(&read);
        let result = extract_semantic_read(
            &schema(),
            &read,
            &delivery,
            SemanticReadSensitivityLimit::Sensitive,
            &serde_json::to_vec(&valid_output()).expect("output"),
        )
        .expect("extract");

        assert_eq!(result.schema().get(), 29);
        assert_eq!(result.observation(), read.observation());
        assert_eq!(
            result.observation_generation(),
            read.observation_generation()
        );
        assert_eq!(
            result.captured_at(),
            SemanticCaptureInstant::from_millis(31)
        );
        assert_eq!(result.trust(), SemanticExtractionTrust::ModelMapped);
        assert_eq!(result.fields().len(), 4);
        assert_eq!(result.stats().fields(), 4);
        assert_eq!(result.stats().values(), 5);
        assert_eq!(result.stats().text_bytes(), 33);
        assert_eq!(result.stats().source_edges(), 7);
        assert_eq!(result.stats().sensitive_source_edges(), 1);

        let SemanticExtractedValue::Text(title) = result.fields()[0].value() else {
            panic!("title kind");
        };
        assert_eq!(result.fields()[0].name(), "title");
        assert_eq!(title.as_str(), "Quarterly summary");
        let title_sources = result.sources(title.source_span()).expect("title sources");
        assert_eq!(title_sources.len(), 1);
        assert_eq!(title_sources[0].fragment().id().get(), 1);

        let SemanticExtractedValue::Boolean(active) = result.fields()[1].value() else {
            panic!("active kind");
        };
        assert!(active.value());
        assert_eq!(
            result
                .sources(active.source_span())
                .expect("active sources")[0]
                .fragment()
                .id()
                .get(),
            4
        );

        let SemanticExtractedValue::Unsigned(count) = result.fields()[2].value() else {
            panic!("count kind");
        };
        assert_eq!(count.value(), 42);

        let SemanticExtractedValue::TextList(tags) = result.fields()[3].value() else {
            panic!("tags kind");
        };
        assert_eq!(tags.items().len(), 2);
        assert_eq!(tags.items()[1].as_str(), "Private");
        assert_eq!(
            result
                .sources(tags.items()[1].source_span())
                .expect("item sources")[0]
                .fragment()
                .provenance()
                .sensitivity(),
            SemanticSensitivity::Sensitive
        );

        let debug = format!("{result:?} {:?} {:?}", result.fields()[0], title);
        assert!(!debug.contains("Quarterly summary"));
        assert!(!debug.contains("Private"));
        assert!(!debug.contains("title"));
    }

    #[test]
    fn owned_mapping_outlives_observation_deduplicates_quotes_and_never_promotes_trust() {
        let owned = {
            let observation = observation();
            let read = read(&observation, 31);
            extract_semantic_read(
                &schema(),
                &read,
                &delivered(&read),
                SemanticReadSensitivityLimit::Sensitive,
                &serde_json::to_vec(&valid_output()).unwrap(),
            )
            .unwrap()
            .into_owned()
            .unwrap()
        };
        assert_eq!(owned.trust(), SemanticExtractionTrust::ModelMapped);
        assert_eq!(owned.stats().source_edges(), 7);
        assert_eq!(owned.sources.len(), 4);
        let SemanticExtractedValue::Text(title) = owned.fields()[0].value() else {
            panic!()
        };
        let source = owned.sources(title.source_span()).unwrap().next().unwrap();
        assert_eq!(source.id.get(), 1);
        assert!(
            matches!(&source.content, SemanticOwnedReadContent::Text(value) if value == "Quarterly summary")
        );
        let mut foreign = title.source_span();
        foreign.result_guard[0] ^= 1;
        assert!(owned.sources(foreign).is_none());
        let debug = format!("{owned:?}");
        assert!(!debug.contains("Quarterly"));
        assert!(!debug.contains("Private"));
        assert!(!debug.contains("title"));
    }

    #[test]
    fn page_title_survives_owned_extraction_without_using_model_text() {
        let observation = observation_with_nodes(json!([
            {"k":1,"r":"document","o":16},
            {"k":2,"p":0,"r":"paragraph","t":"Page content"},
            {"k":3,"p":0,"r":"paragraph","n":"Page title","t":"Observed title"}
        ]));
        let read = read(&observation, 31);
        let schema = SemanticExtractionSchema::try_new(
            SemanticExtractionSchemaId::new(29).unwrap(),
            vec![SemanticExtractionFieldSchema::try_text("title".into(), true, 64).unwrap()],
        )
        .unwrap();
        let output = json!({"v":SEMANTIC_EXTRACTION_SCHEMA_VERSION,"schema":29,"fields":[
            {"name":"title","value":{"k":"text","value":"Model title","sources":["@r1"]}}
        ]});
        let owned = extract_semantic_read(
            &schema,
            &read,
            &delivered(&read),
            SemanticReadSensitivityLimit::PublicOnly,
            &serde_json::to_vec(&output).unwrap(),
        )
        .unwrap()
        .into_owned()
        .unwrap();
        assert_eq!(owned.page_title(), Some("Observed title"));
    }

    #[test]
    fn requires_receipt_for_the_exact_read_projection_and_capture() {
        let observation = observation();
        let delivered_read = read(&observation, 31);
        let delivery = delivered(&delivered_read);
        let different_capture = read(&observation, 32);
        assert_eq!(
            extract_semantic_read(
                &schema(),
                &different_capture,
                &delivery,
                SemanticReadSensitivityLimit::Sensitive,
                &serde_json::to_vec(&valid_output()).expect("output"),
            )
            .expect_err("capture substitution"),
            SemanticExtractionError::ReadNotDelivered
        );

        let public_read = read_semantic_observation(
            &observation,
            SemanticReadAuthority::Initial,
            SemanticCaptureInstant::from_millis(31),
            SemanticReadSensitivityLimit::PublicOnly,
            SemanticReadBudget::STANDARD,
        )
        .expect("public read");
        assert_eq!(
            extract_semantic_read(
                &schema(),
                &public_read,
                &delivery,
                SemanticReadSensitivityLimit::PublicOnly,
                &serde_json::to_vec(&valid_output()).expect("output"),
            )
            .expect_err("projection substitution"),
            SemanticExtractionError::ReadNotDelivered
        );
    }

    #[test]
    fn provenance_spans_cannot_be_substituted_across_extraction_results() {
        let observation = observation();
        let read = read(&observation, 31);
        let delivery = delivered(&read);
        let first = extract_semantic_read(
            &schema(),
            &read,
            &delivery,
            SemanticReadSensitivityLimit::Sensitive,
            &serde_json::to_vec(&valid_output()).expect("output"),
        )
        .expect("first");
        let SemanticExtractedValue::Text(first_title) = first.fields()[0].value() else {
            panic!("title kind");
        };

        let mut altered_output = valid_output();
        altered_output["fields"][0]["value"]["sources"] = json!(["@r2"]);
        let second = extract_semantic_read(
            &schema(),
            &read,
            &delivery,
            SemanticReadSensitivityLimit::Sensitive,
            &serde_json::to_vec(&altered_output).expect("output"),
        )
        .expect("second");
        assert!(second.sources(first_title.source_span()).is_none());

        let SemanticExtractedValue::Text(second_title) = second.fields()[0].value() else {
            panic!("title kind");
        };
        assert_eq!(
            second
                .sources(second_title.source_span())
                .expect("own span")[0]
                .fragment()
                .id()
                .get(),
            2
        );
    }

    #[test]
    fn validates_trusted_schema_names_uniqueness_and_bounds() {
        assert!(SemanticExtractionSchemaId::new(0).is_none());
        for name in ["", "_title", "two words", "ümlaut", "a-b"] {
            assert_eq!(
                SemanticExtractionFieldSchema::try_boolean(name.to_owned(), true)
                    .expect_err("invalid name"),
                SemanticExtractionSchemaError::FieldName
            );
        }
        assert_eq!(
            SemanticExtractionFieldSchema::try_text("value".to_owned(), true, 0)
                .expect_err("zero text"),
            SemanticExtractionSchemaError::TextLimit
        );
        assert_eq!(
            SemanticExtractionFieldSchema::try_text_list("items".to_owned(), true, 0, 1)
                .expect_err("zero list"),
            SemanticExtractionSchemaError::ListLimit
        );
        let duplicate =
            SemanticExtractionFieldSchema::try_boolean("same".to_owned(), true).expect("field");
        assert_eq!(
            SemanticExtractionSchema::try_new(
                SemanticExtractionSchemaId::new(1).expect("id"),
                vec![duplicate.clone(), duplicate],
            )
            .expect_err("duplicate"),
            SemanticExtractionSchemaError::DuplicateField
        );
        assert_eq!(
            SemanticExtractionSchema::try_new(
                SemanticExtractionSchemaId::new(1).expect("id"),
                Vec::new(),
            )
            .expect_err("empty"),
            SemanticExtractionSchemaError::FieldLimit
        );
        let too_many = (0..=MAX_SEMANTIC_EXTRACTION_FIELDS)
            .map(|index| {
                SemanticExtractionFieldSchema::try_boolean(format!("field{index}"), false)
                    .expect("field")
            })
            .collect();
        assert_eq!(
            SemanticExtractionSchema::try_new(
                SemanticExtractionSchemaId::new(1).expect("id"),
                too_many,
            )
            .expect_err("field ceiling"),
            SemanticExtractionSchemaError::FieldLimit
        );

        let long_fields = (0..33)
            .map(|index| {
                SemanticExtractionFieldSchema::try_boolean(
                    format!("f{index:02}_{}", "x".repeat(60)),
                    false,
                )
                .expect("long field")
            })
            .collect();
        assert_eq!(
            SemanticExtractionSchema::try_new(
                SemanticExtractionSchemaId::new(1).expect("id"),
                long_fields,
            )
            .expect_err("aggregate names"),
            SemanticExtractionSchemaError::NameLimit
        );
    }

    #[test]
    fn tolerates_harmless_envelope_forms_and_refuses_unusable_ones() {
        let observation = observation();
        let read = read(&observation, 31);
        let delivery = delivered(&read);
        let admit = |raw: &[u8]| {
            extract_semantic_read(
                &schema(),
                &read,
                &delivery,
                SemanticReadSensitivityLimit::Sensitive,
                raw,
            )
        };
        let valid = serde_json::to_string(&valid_output()).unwrap();
        let mut bare = valid_output();
        bare.as_object_mut().unwrap().remove("v");
        bare.as_object_mut().unwrap().remove("schema");
        bare["extra"] = json!(true);
        let mut mapped = valid_output();
        mapped["fields"] = json!({
            "count": {"k": "unsigned", "value": "42", "sources": "@r2"},
            "Title": {"value": "Quarterly summary", "source": ["r1"]},
            "active": {"value": "yes", "sources": [4]},
        });
        for raw in [
            format!("```json\n{valid}\n```"),
            format!("Here is the mapping: {valid} done"),
            serde_json::to_string(&bare).unwrap(),
            serde_json::to_string(&mapped).unwrap(),
            r#"{"v":1,"v":1,"schema":29,"fields":[{"name":"title","value":{"k":"text","value":"Quarterly summary","sources":["@r1"]}},{"name":"active","value":{"k":"boolean","value":true,"sources":["@r4"]}},{"name":"count","value":{"k":"unsigned","value":42,"sources":["@r2"]}}]}"#.to_owned(),
        ] {
            let result = admit(raw.as_bytes()).unwrap_or_else(|error| panic!("{raw}: {error}"));
            assert!(result.fields().len() >= 3, "{raw}");
            let SemanticExtractedValue::Unsigned(count) = result.fields()[2].value() else {
                panic!("count");
            };
            assert_eq!(count.value(), 42);
        }
        for raw in [b"not json".as_slice(), b"[]", b"{\"fields\": 7}"] {
            assert!(admit(raw).is_err());
        }

        let mut version = valid_output();
        version["v"] = json!(2);
        assert_eq!(
            extract_value_error(&version),
            SemanticExtractionError::VersionMismatch
        );
        let mut schema_id = valid_output();
        schema_id["schema"] = json!(30);
        assert_eq!(
            extract_value_error(&schema_id),
            SemanticExtractionError::SchemaMismatch
        );
        let oversized = vec![b' '; MAX_SEMANTIC_EXTRACTION_INPUT_BYTES + 1];
        assert_eq!(
            admit(&oversized).expect_err("input ceiling"),
            SemanticExtractionError::InputLimit
        );

        // Fields the trusted schema lacks are left out and counted.
        let mut extra: Vec<Value> = valid_output()["fields"].as_array().unwrap().clone();
        extra.extend((0..=MAX_SEMANTIC_EXTRACTION_FIELDS).map(|index| {
            json!({"name": format!("field{index}"), "value": {
                "k": "boolean", "value": true, "sources": ["@r1"]
            }})
        }));
        let output = serde_json::to_vec(&json!({"v": 1, "schema": 29, "fields": extra})).unwrap();
        let result = admit(&output).expect("unknown fields dropped");
        assert_eq!(result.fields().len(), 4);
        assert_eq!(
            usize::from(result.stats().dropped()),
            MAX_SEMANTIC_EXTRACTION_FIELDS + 1
        );
    }

    #[test]
    fn field_order_duplicates_and_extras_normalize_while_missing_and_wrong_kinds_fail() {
        let observation = observation();
        let read = read(&observation, 31);
        let delivery = delivered(&read);
        let admit = |output: &Value| {
            extract_semantic_read(
                &schema(),
                &read,
                &delivery,
                SemanticReadSensitivityLimit::Sensitive,
                &serde_json::to_vec(output).expect("output"),
            )
        };
        let mut optional_omitted = valid_output();
        optional_omitted["fields"]
            .as_array_mut()
            .expect("fields")
            .pop();
        assert_eq!(admit(&optional_omitted).unwrap().fields().len(), 3);

        let mut missing = valid_output();
        missing["fields"].as_array_mut().expect("fields").remove(1);
        assert_eq!(
            extract_value_error(&missing),
            SemanticExtractionError::MissingRequiredField
        );

        let mut duplicate = valid_output();
        let mut duplicate_field = duplicate["fields"][0].clone();
        duplicate_field["value"]["value"] = json!("Second copy");
        duplicate["fields"]
            .as_array_mut()
            .expect("fields")
            .insert(1, duplicate_field);
        let result = admit(&duplicate).unwrap();
        let SemanticExtractedValue::Text(title) = result.fields()[0].value() else {
            panic!("title");
        };
        assert_eq!(title.as_str(), "Quarterly summary");

        let mut reordered = valid_output();
        reordered["fields"]
            .as_array_mut()
            .expect("fields")
            .reverse();
        let names: Vec<_> = admit(&reordered)
            .unwrap()
            .fields()
            .iter()
            .map(|field| field.name().to_owned())
            .collect();
        assert_eq!(names, ["title", "active", "count", "tags"]);

        let mut extra = valid_output();
        extra["fields"]
            .as_array_mut()
            .expect("fields")
            .push(json!({"name": "other", "value": {
                "k": "boolean", "value": true, "sources": ["@r1"]
            }}));
        assert_eq!(admit(&extra).unwrap().stats().dropped(), 1);

        let mut wrong_type = valid_output();
        wrong_type["fields"][0]["value"] =
            json!({"k": "boolean", "value": true, "sources": ["@r1"]});
        assert_eq!(
            extract_value_error(&wrong_type),
            SemanticExtractionError::MissingRequiredField
        );
    }

    #[test]
    fn enforces_text_secret_numeric_list_and_primitive_value_bounds() {
        let observation = observation();
        let read = read(&observation, 31);
        let delivery = delivered(&read);
        let admit = |output: &Value| {
            extract_semantic_read(
                &schema(),
                &read,
                &delivery,
                SemanticReadSensitivityLimit::Sensitive,
                &serde_json::to_vec(output).expect("output"),
            )
        };
        let title = |output: &Value| {
            let result = admit(output).unwrap();
            let SemanticExtractedValue::Text(title) = result.fields()[0].value() else {
                panic!("title");
            };
            title.as_str().to_owned()
        };
        let mut text_limit = valid_output();
        text_limit["fields"][0]["value"]["value"] = json!("x".repeat(65));
        assert_eq!(title(&text_limit), "x".repeat(64));

        let mut multiline = valid_output();
        multiline["fields"][0]["value"]["value"] = json!("line\n\tbreak\u{200b} here");
        assert_eq!(title(&multiline), "line break here");

        let mut secret = valid_output();
        secret["fields"][0]["value"]["value"] = json!("sk_live_12345678901234567890");
        assert_eq!(
            extract_value_error(&secret),
            SemanticExtractionError::SecretValue
        );

        let mut unsigned = valid_output();
        unsigned["fields"][2]["value"]["value"] = json!(101);
        assert_eq!(
            extract_value_error(&unsigned),
            SemanticExtractionError::UnsignedLimit
        );

        let mut list = valid_output();
        list["fields"][3]["value"]["items"] = json!([
            {"value": "a", "sources": ["@r1"]},
            {"value": "b", "sources": ["@r1"]},
            {"value": "c", "sources": ["@r1"]},
            {"value": "d", "sources": ["@r1"]},
            {"value": "e", "sources": ["@r1"]}
        ]);
        let result = admit(&list).unwrap();
        let SemanticExtractedValue::TextList(tags) = result.fields()[3].value() else {
            panic!("tags");
        };
        assert_eq!(tags.items().len(), 4);
        assert_eq!(result.stats().dropped(), 1);

        let many_fields = (0..5)
            .map(|index| {
                SemanticExtractionFieldSchema::try_text_list(format!("list{index}"), true, 64, 1)
                    .expect("list schema")
            })
            .collect();
        let many_schema = SemanticExtractionSchema::try_new(
            SemanticExtractionSchemaId::new(41).expect("id"),
            many_fields,
        )
        .expect("many schema");
        let fields: Vec<Value> = (0..5)
            .map(|index| {
                let item_count = if index < 4 { 64 } else { 2 };
                json!({
                    "name": format!("list{index}"),
                    "value": {
                        "k": "text_list",
                        "sources": ["@r1"],
                        "items": (0..item_count).map(|_| {
                            json!({"value": "x", "sources": ["@r1"]})
                        }).collect::<Vec<_>>()
                    }
                })
            })
            .collect();
        let many_output = serde_json::to_vec(&json!({
            "v": SEMANTIC_EXTRACTION_SCHEMA_VERSION,
            "schema": 41,
            "fields": fields
        }))
        .expect("many output");
        // Values past the process-wide ceiling are left out, never admitted.
        let result = extract_semantic_read(
            &many_schema,
            &read,
            &delivery,
            SemanticReadSensitivityLimit::Sensitive,
            &many_output,
        )
        .expect("bounded");
        assert_eq!(
            usize::from(result.stats().values()),
            MAX_SEMANTIC_EXTRACTION_VALUES
        );
        assert_eq!(result.stats().dropped(), 2);
    }

    #[test]
    fn multiline_text_becomes_one_line_and_keeps_only_its_own_provenance() {
        let observation = observation();
        let read = read(&observation, 31);
        let delivery = delivered(&read);
        let legacy = SemanticExtractionSchema::try_new(
            SemanticExtractionSchemaId::new(1).unwrap(),
            vec![SemanticExtractionFieldSchema::try_text("answer".into(), true, 4096).unwrap()],
        )
        .unwrap();
        let prefix = "Summary @r30.\n\nImportant claim @r38.\n\nCaveat @r52. ";
        let multiline = format!("{prefix}{}", "x".repeat(2495 - prefix.len()));
        let mut output = json!({"v":1,"schema":1,"fields":[{"name":"answer","value":{
            "k":"text","value":multiline,"sources":["@r30","@r35","@r36","@r37"]
        }}]});
        // Inline @r strings are not citations, and no cited fragment exists.
        assert_eq!(
            extract_semantic_read(
                &legacy,
                &read,
                &delivery,
                SemanticReadSensitivityLimit::PublicOnly,
                &serde_json::to_vec(&output).unwrap()
            )
            .unwrap_err(),
            SemanticExtractionError::SourceMissing
        );
        output["fields"][0]["value"]["sources"] = json!(["@r1", "@r2", "@r3", "@r4"]);
        let result = extract_semantic_read(
            &legacy,
            &read,
            &delivery,
            SemanticReadSensitivityLimit::PublicOnly,
            &serde_json::to_vec(&output).unwrap(),
        )
        .unwrap();
        let SemanticExtractedValue::Text(answer) = result.fields()[0].value() else {
            panic!("answer");
        };
        assert!(answer
            .as_str()
            .starts_with("Summary @r30. Important claim @r38. Caveat"));

        let schema = SemanticExtractionSchema::try_new(
            legacy.id(),
            vec![
                SemanticExtractionFieldSchema::try_text("summary".into(), true, 640).unwrap(),
                SemanticExtractionFieldSchema::try_text_list(
                    "important_claims".into(),
                    true,
                    8,
                    320,
                )
                .unwrap(),
            ],
        )
        .unwrap();
        let structured = json!({"v":1,"schema":1,"fields":[
            {"name":"summary","value":{"k":"text","value":"A concise brief.","sources":["@r1"]}},
            {"name":"important_claims","value":{"k":"text_list","sources":["@r1","@r2"],"items":[
                {"value":"One claim.\n\nAnother paragraph.","sources":["@r1"]},
                {"value":"Uncited claim.","sources":["@r99"]}
            ]}}
        ]});
        let result = extract_semantic_read(
            &schema,
            &read,
            &delivery,
            SemanticReadSensitivityLimit::PublicOnly,
            &serde_json::to_vec(&structured).unwrap(),
        )
        .unwrap();
        assert_eq!(result.trust(), SemanticExtractionTrust::ModelMapped);
        let SemanticExtractedValue::TextList(claims) = result.fields()[1].value() else {
            panic!("claims");
        };
        assert_eq!(claims.items().len(), 1);
        assert_eq!(claims.items()[0].as_str(), "One claim. Another paragraph.");
        assert_eq!(
            result
                .sources(claims.items()[0].source_span())
                .unwrap()
                .len(),
            1
        );
        assert_eq!(result.stats().dropped(), 1);
    }

    #[test]
    fn citation_sets_normalize_order_and_duplicates_without_changing_evidence() {
        let observation = observation();
        let read = read(&observation, 31);
        let delivery = delivered(&read);
        let schema = schema();
        let title_sources = |raw: Value| {
            let mut output = valid_output();
            output["fields"][0]["value"]["sources"] = raw;
            let bytes = serde_json::to_vec(&output).unwrap();
            let result = extract_semantic_read(
                &schema,
                &read,
                &delivery,
                SemanticReadSensitivityLimit::Sensitive,
                &bytes,
            )
            .unwrap();
            let SemanticExtractedValue::Text(title) = result.fields()[0].value() else {
                panic!("text");
            };
            assert_eq!(title.as_str(), "Quarterly summary");
            result
                .sources(title.source_span())
                .unwrap()
                .iter()
                .map(|source| source.fragment().id().get())
                .collect::<Vec<_>>()
        };
        for raw in [
            json!(["@r2", "@r1"]),
            json!(["@r2", "@r1", "@r2"]),
            json!(["r2", "@R1"]),
            json!("@r1, @r2"),
            json!([2, "@r01"]),
        ] {
            assert_eq!(title_sources(raw), [1, 2]);
        }
        // Citations of fragments the read never delivered are left out.
        assert_eq!(title_sources(json!(["@r99", "@r1", "@r99"])), [1]);
        assert_eq!(
            title_sources(json!(["@r1", "@r1", "@r1", "@r1", "@r1"])),
            [1]
        );
        assert_eq!(
            title_sources(json!(["@r1", "@r2", "@r3", "@r4", "@r5"])),
            [1, 2, 3, 4]
        );
        // With no usable citation, the fragment that shows the text is cited.
        for raw in [json!([]), json!(["@r99"]), json!(["nonsense"])] {
            assert_eq!(title_sources(raw), [1]);
        }
    }

    #[test]
    fn values_without_evidence_or_beyond_sensitivity_are_refused() {
        let mut output = valid_output();
        output["fields"][0]["value"]["value"] = json!("Not shown on this page");
        for sources in [json!([]), json!(["@r99"])] {
            output["fields"][0]["value"]["sources"] = sources.clone();
            assert!(
                matches!(
                    extract_value_error(&output),
                    SemanticExtractionError::SourceLimit | SemanticExtractionError::SourceMissing
                ),
                "{sources}"
            );
        }

        let observation = observation();
        let read = read(&observation, 31);
        let delivery = delivered(&read);
        let mut output = valid_output();
        output["fields"][0]["value"] = json!({
            "k": "text", "value": "Private customer note", "sources": ["@r5"]
        });
        assert_eq!(
            extract_semantic_read(
                &schema(),
                &read,
                &delivery,
                SemanticReadSensitivityLimit::PublicOnly,
                &serde_json::to_vec(&output).expect("output"),
            )
            .expect_err("sensitive citation"),
            SemanticExtractionError::Sensitivity
        );
        // An optional list keeps its public items and leaves the sensitive one out.
        let result = extract_semantic_read(
            &schema(),
            &read,
            &delivery,
            SemanticReadSensitivityLimit::PublicOnly,
            &serde_json::to_vec(&valid_output()).expect("output"),
        )
        .expect("public items");
        let SemanticExtractedValue::TextList(tags) = result.fields()[3].value() else {
            panic!("tags");
        };
        assert_eq!(tags.items().len(), 1);
        assert_eq!(tags.items()[0].as_str(), "Quarterly");
        assert_eq!(result.stats().sensitive_source_edges(), 0);
    }

    #[test]
    fn aggregate_source_table_is_hard_bounded() {
        let fields = (0..4)
            .map(|index| {
                SemanticExtractionFieldSchema::try_text_list(format!("list{index}"), true, 64, 1)
                    .expect("list schema")
            })
            .collect();
        let bounded_schema = SemanticExtractionSchema::try_new(
            SemanticExtractionSchemaId::new(43).expect("id"),
            fields,
        )
        .expect("schema");
        let fields: Vec<Value> = (0..4)
            .map(|index| {
                json!({
                    "name": format!("list{index}"),
                    "value": {
                        "k": "text_list",
                        "sources": ["@r1", "@r2", "@r3", "@r4"],
                        "items": (0..64).map(|_| {
                            json!({
                                "value": "x",
                                "sources": ["@r1", "@r2", "@r3", "@r4"]
                            })
                        }).collect::<Vec<_>>()
                    }
                })
            })
            .collect();
        let output = serde_json::to_vec(&json!({
            "v": SEMANTIC_EXTRACTION_SCHEMA_VERSION,
            "schema": 43,
            "fields": fields
        }))
        .expect("output");
        let observation = observation();
        let read = read(&observation, 31);
        let delivery = delivered(&read);
        assert_eq!(
            extract_semantic_read(
                &bounded_schema,
                &read,
                &delivery,
                SemanticReadSensitivityLimit::Sensitive,
                &output,
            )
            .expect_err("source ceiling"),
            SemanticExtractionError::SourceLimit
        );
    }

    #[test]
    fn a_read_over_budget_keeps_each_kept_record_s_link_for_a_link_column() {
        // Airbnb's listing: cards in the main region, then a map repeating
        // every price, all over the read's item budget.
        let mut nodes = vec![
            json!({"k":1,"r":"document","o":16}),
            json!({"k":2,"p":0,"r":"landmark","lm":"main"}),
        ];
        for card in 0..20 {
            let url = format!("https://www.airbnb.com/rooms/{card}?adults=1&check_in=2027-01-01");
            nodes.push(
                json!({"k":3 + card * 4,"p":1,"r":"link","n":format!("Condo {card}"),"u":url}),
            );
            nodes.push(
                json!({"k":4 + card * 4,"p":1,"r":"paragraph","t":format!("Stylish home {card}")}),
            );
            nodes.push(json!({"k":5 + card * 4,"p":1,"r":"paragraph","t":"1 bath"}));
            nodes.push(
                json!({"k":6 + card * 4,"p":1,"r":"paragraph","t":format!("${},000", card + 3)}),
            );
        }
        for marker in 0..40 {
            nodes.push(
                json!({"k":100 + marker,"p":1,"r":"paragraph","t":format!("Condo, ${marker},500")}),
            );
        }
        let observation = observation_with_nodes(json!(nodes));
        let row = vec![
            SemanticExtractionFieldSchema::try_text("name".into(), true, 512).unwrap(),
            SemanticExtractionFieldSchema::try_url("url".into(), true, 2048).unwrap(),
        ];
        let schema = SemanticExtractionSchema::try_new(
            SemanticExtractionSchemaId::new(1).unwrap(),
            vec![
                SemanticExtractionFieldSchema::try_rows("output_0".into(), true, row, 12).unwrap(),
            ],
        )
        .unwrap();
        let read = crate::read_semantic_observation_for_schema(
            &observation,
            SemanticReadAuthority::Initial,
            SemanticCaptureInstant::from_millis(31),
            SemanticReadSensitivityLimit::PublicOnly,
            SemanticReadBudget::try_new(80, 48 * 1024).unwrap(),
            &schema,
        )
        .unwrap();
        let fields = |field| {
            read.fragments()
                .iter()
                .filter(|fragment| fragment.field() == field)
                .count()
        };
        let links = fields(crate::SemanticReadField::LinkDestination);
        assert!(links >= 10, "{links}");
        let named = read
            .fragments()
            .iter()
            .filter(|fragment| {
                fragment.field() == crate::SemanticReadField::AccessibleName
                    && fragment_text(**fragment).is_some_and(|text| text.starts_with("Condo "))
            })
            .count();
        assert_eq!(named, links);
    }
}
