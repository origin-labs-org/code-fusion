use super::*;
use zephium_core::work::collection::{WorkBrowseCollection, WorkBrowseExtraction, WorkBrowseValue};

const IMPLICIT_IMAGE_FIELD: &str = "image";

/// Host-selected record shape; contains no site code or new browser authority.
#[derive(Clone)]
pub struct WorkBrowseCollectionSchema {
    title: String,
    fields: Vec<SemanticExtractionFieldSchema>,
    max_items: usize,
    subject_url_field: Option<String>,
    subject_image_fields: Vec<String>,
    implicit_image: bool,
}

impl TryFrom<&WorkBrowseCollection> for WorkBrowseCollectionSchema {
    type Error = WorkError;

    fn try_from(request: &WorkBrowseCollection) -> Result<Self, Self::Error> {
        request.validate()?;
        let name = SemanticExtractionFieldSchema::try_text("name".into(), true, 512)
            .and_then(SemanticExtractionFieldSchema::with_verbatim_text)
            .map_err(|_| WorkError::Invalid)?;
        let mut fields = vec![name];
        // A single-subject read is on that subject's own page: its subject URL
        // column is the page's own address, which the read itself can cite.
        let subject_url = request
            .columns
            .iter()
            .find(|column| column.value == WorkBrowseValue::Url)
            .map(|column| column.name.as_str());
        for column in &request.columns {
            let name = column.name.clone();
            let required = column.required;
            let mut field = match &column.value {
                WorkBrowseValue::Text => {
                    SemanticExtractionFieldSchema::try_text(name, required, 1024)
                }
                WorkBrowseValue::Money { currencies } => {
                    SemanticExtractionFieldSchema::try_money(name, required, currencies.clone())
                }
                WorkBrowseValue::Url => {
                    SemanticExtractionFieldSchema::try_url(name, required, 2048)
                }
                WorkBrowseValue::ImageUrl => {
                    SemanticExtractionFieldSchema::try_image_url(name, required, 2048)
                }
            }
            .map_err(|_| WorkError::Invalid)?;
            if column.extraction == WorkBrowseExtraction::Verbatim
                && column.value == WorkBrowseValue::Text
            {
                field = field.with_verbatim_text().map_err(|_| WorkError::Invalid)?;
            }
            if request.max_items == 1
                && column.value == WorkBrowseValue::Url
                && (subject_url == Some(column.name.as_str())
                    || matches!(
                        column.name.as_str(),
                        "listing_url" | "homepage" | "url" | "page_url"
                    ))
            {
                field = field
                    .with_document_address()
                    .map_err(|_| WorkError::Invalid)?;
            }
            fields.push(field);
        }
        let mut schema = Self::try_new(
            request.title.clone(),
            fields,
            usize::from(request.max_items),
        )?;
        if let Some(column) = request
            .columns
            .iter()
            .find(|column| column.value == WorkBrowseValue::Url)
        {
            schema = schema.with_subject_url_field(&column.name)?;
        }
        for column in &request.columns {
            if column.value == WorkBrowseValue::ImageUrl {
                schema = schema.with_subject_image_field(&column.name)?;
            }
        }
        if schema.subject_image_fields.is_empty() {
            // Pictures never depend on the request naming a column; a full
            // record shape keeps its limits and simply goes without one.
            if let Ok(pictured) = schema.clone().with_implicit_image() {
                schema = pictured;
            }
        }
        Ok(schema)
    }
}

impl WorkBrowseCollectionSchema {
    /// The first field names each subject; remaining scalar fields become columns.
    pub fn try_new(
        title: String,
        fields: Vec<SemanticExtractionFieldSchema>,
        max_items: usize,
    ) -> Result<Self, WorkError> {
        if title.is_empty()
            || title.len() > 512
            || fields.len() < 2
            || fields.len() > MAX_ARTIFACT_CRITERIA + 1
            || max_items == 0
            || max_items > MAX_ARTIFACT_SUBJECTS
        {
            return Err(WorkError::Invalid);
        }
        SemanticActionText::try_new(title.clone()).map_err(|_| WorkError::Invalid)?;
        let first = &fields[0];
        if !first.required()
            || first.kind() != SemanticExtractionValueKind::Text
            || first.max_text_bytes().is_none_or(|bytes| bytes > 512)
        {
            return Err(WorkError::Invalid);
        }
        let schema = Self {
            title,
            fields,
            max_items,
            subject_url_field: None,
            subject_image_fields: vec![],
            implicit_image: false,
        };
        schema.extraction_field()?;
        Ok(schema)
    }

    fn with_implicit_image(mut self) -> Result<Self, WorkError> {
        if self.fields.len() > MAX_ARTIFACT_CRITERIA
            || self
                .fields
                .iter()
                .any(|field| field.name() == IMPLICIT_IMAGE_FIELD)
        {
            return Err(WorkError::Invalid);
        }
        self.fields.push(
            SemanticExtractionFieldSchema::try_image_url(IMPLICIT_IMAGE_FIELD.into(), false, 2048)
                .map_err(|_| WorkError::Invalid)?,
        );
        self.extraction_field()?;
        self = self.with_subject_image_field(IMPLICIT_IMAGE_FIELD)?;
        self.implicit_image = true;
        Ok(self)
    }

    fn visible(&self, field: &SemanticExtractionFieldSchema) -> bool {
        !(self.implicit_image && field.name() == IMPLICIT_IMAGE_FIELD)
    }

    /// Selects which source-backed URL identifies a subject in Work.
    pub fn with_subject_url_field(mut self, name: &str) -> Result<Self, WorkError> {
        if !self
            .fields
            .iter()
            .any(|field| field.name() == name && field.kind() == SemanticExtractionValueKind::Url)
        {
            return Err(WorkError::Invalid);
        }
        self.subject_url_field = Some(name.to_owned());
        Ok(self)
    }

    /// Selects an observed image field for Work's bounded image candidates.
    pub fn with_subject_image_field(mut self, name: &str) -> Result<Self, WorkError> {
        if self.subject_image_fields.len() >= 3
            || self.subject_image_fields.iter().any(|field| field == name)
            || !self.fields.iter().any(|field| {
                field.name() == name && field.kind() == SemanticExtractionValueKind::ImageUrl
            })
        {
            return Err(WorkError::Invalid);
        }
        self.subject_image_fields.push(name.to_owned());
        Ok(self)
    }

    pub(super) fn extraction_field(&self) -> Result<SemanticExtractionFieldSchema, WorkError> {
        SemanticExtractionFieldSchema::try_rows(
            "output_0".into(),
            true,
            self.fields.clone(),
            self.max_items,
        )
        .map_err(|_| WorkError::Invalid)
    }

    pub(super) fn append_browsing_fields(&self, objective: &mut String) -> Result<(), WorkError> {
        use std::fmt::Write as _;
        writeln!(
            objective,
            "\nCollection output_0: up to {} distinct records. Fields:",
            self.max_items
        )
        .map_err(|_| WorkError::Invalid)?;
        for field in &self.fields {
            let kind = match field.kind() {
                SemanticExtractionValueKind::Text => "text",
                SemanticExtractionValueKind::Url => "url",
                SemanticExtractionValueKind::ImageUrl => "image_url",
                SemanticExtractionValueKind::Money => "money",
                SemanticExtractionValueKind::Boolean => "boolean",
                SemanticExtractionValueKind::Unsigned => "unsigned",
                SemanticExtractionValueKind::TextList | SemanticExtractionValueKind::Rows => {
                    return Err(WorkError::Invalid);
                }
            };
            write!(
                objective,
                "{}: {kind} {}",
                field.name(),
                if field.required() {
                    "required"
                } else {
                    "optional"
                }
            )
            .map_err(|_| WorkError::Invalid)?;
            if let Some(currencies) = field.currencies() {
                write!(objective, " permitted_currencies={}", currencies.join(","))
                    .map_err(|_| WorkError::Invalid)?;
            }
            objective.push('\n');
        }
        Ok(())
    }

    pub(super) fn public_candidate_records(
        &self,
        archive: &AgentWorkArchivedExtraction,
    ) -> Vec<u16> {
        let Some(ArchivedValue::Rows { items }) =
            archive.fields().first().map(ArchivedField::value)
        else {
            return vec![];
        };
        self.candidate_rows(items)
    }

    fn candidate_rows(&self, items: &[Vec<ArchivedField>]) -> Vec<u16> {
        items
            .iter()
            .take(self.max_items)
            .enumerate()
            .filter_map(|(index, row)| {
                row.iter()
                    .any(|field| {
                        self.subject_image_fields
                            .iter()
                            .any(|name| name == field.name())
                            && matches!(field.value(), ArchivedValue::ImageUrl { value, .. }
                    if zephium_core::work::media::is_public_image_candidate(value))
                    })
                    .then_some(index as u16)
            })
            .collect()
    }

    pub(super) fn artifact(
        &self,
        profile: zephium_core::ids::ProfileId,
        output: &str,
        archive: &AgentWorkArchivedExtraction,
        media: Option<&[zephium_core::work::media::WorkRecordMediaRefV1]>,
        public_fallback: &[u16],
    ) -> Result<WorkArtifactDraft, WorkError> {
        if archive.descriptor().profile() != profile
            || archive.fields().len() != 1
            || archive.fields()[0].name() != "output_0"
        {
            return Err(WorkError::Invalid);
        }
        let ArchivedValue::Rows { items } = archive.fields()[0].value() else {
            return Err(WorkError::Invalid);
        };
        if items.is_empty() {
            return Err(WorkError::Unavailable);
        }
        // A page that showed more than was asked for keeps the first rows.
        let items = &items[..items.len().min(self.max_items)];
        let mut cite = Citer {
            archive,
            extraction_id: zephium_core::work::WorkArtifactId::from(u128::from_be_bytes(
                archive.descriptor().id(),
            )),
            evidence: Vec::new(),
        };
        let data = self.comparison_media(items, &mut cite, media, public_fallback)?;
        data.validate(cite.evidence.len())?;
        Ok(WorkArtifactDraft {
            output: output.to_owned(),
            title: self.title.clone(),
            data,
            evidence: cite.evidence,
        })
    }

    #[cfg(test)]
    fn comparison(
        &self,
        items: &[Vec<ArchivedField>],
        cite: &mut impl FnMut(&[u16]) -> Result<Vec<u16>, WorkError>,
    ) -> Result<WorkArtifactDataV1, WorkError> {
        self.comparison_media(items, &mut |sources: &[u16]| cite(sources), None, &[])
    }
    fn comparison_media(
        &self,
        items: &[Vec<ArchivedField>],
        cite: &mut impl Cite,
        media: Option<&[zephium_core::work::media::WorkRecordMediaRefV1]>,
        public_fallback: &[u16],
    ) -> Result<WorkArtifactDataV1, WorkError> {
        let mut subjects = Vec::new();
        let mut cells = Vec::new();
        let mut seen_rows = std::collections::BTreeSet::new();
        let mut refused = None;
        for (record, row) in items.iter().enumerate() {
            // A display name is not an identity (stays and product variants
            // often share one). Only the exact values and their citations dedup.
            let identity = serde_json::to_vec(row).map_err(|_| WorkError::Invalid)?;
            if !seen_rows.insert(identity) {
                continue;
            }
            // One row that breaks its shape or overflows the evidence leaves
            // only itself out; the rows read before it still stand.
            let mark = cite.mark();
            match self.record(record, row, cite, media, public_fallback) {
                Ok((subject, row_cells)) => {
                    subjects.push(subject);
                    cells.push(row_cells);
                }
                Err(error) => {
                    cite.rollback(mark);
                    refused.get_or_insert(error);
                    if error == WorkError::Capacity {
                        break;
                    }
                }
            }
        }
        if subjects.is_empty() {
            return Err(refused.unwrap_or(WorkError::Unavailable));
        }
        let criteria = self
            .fields
            .iter()
            .skip(1)
            .filter(|field| self.visible(field))
            .map(|field| WorkCriterion {
                name: field.name().replace('_', " "),
                kind: if field.kind() == SemanticExtractionValueKind::Boolean {
                    WorkCriterionKind::Presence
                } else {
                    WorkCriterionKind::Text
                },
            })
            .collect();
        let mut notes = vec![if subjects.len() < self.max_items {
            format!("Work validated {} records against a limit of {}; additional matches may exist or remain unread.", subjects.len(), self.max_items)
        } else {
            "Observed records only; this collection does not establish complete site coverage."
                .into()
        }];
        if cells
            .iter()
            .flatten()
            .any(|cell| matches!(cell.value, WorkCellValue::Unknown))
        {
            notes.push(
                "Some requested values were not observed; unknown cells remain empty.".into(),
            );
        }
        Ok(WorkArtifactDataV1::ComparisonMatrix {
            subjects,
            criteria,
            cells,
            notes,
        })
    }

    fn record(
        &self,
        record: usize,
        row: &[ArchivedField],
        cite: &mut impl Cite,
        media: Option<&[zephium_core::work::media::WorkRecordMediaRefV1]>,
        public_fallback: &[u16],
    ) -> Result<(WorkSubject, Vec<WorkCell>), WorkError> {
        let withheld = media.is_some() && !public_fallback.contains(&(record as u16));
        if row
            .iter()
            .any(|cell| !self.fields.iter().any(|field| field.name() == cell.name()))
        {
            return Err(WorkError::Invalid);
        }
        let first = row.first().ok_or(WorkError::Invalid)?;
        if first.name() != self.fields[0].name() {
            return Err(WorkError::Invalid);
        }
        let ArchivedValue::Text {
            value: name,
            sources,
        } = first.value()
        else {
            return Err(WorkError::Invalid);
        };
        // A result the page labels only by its position (Kayak's "Result
        // item 2") is named by its own first text; a sort tab is no record.
        let (name, sources) = if placeholder(name) {
            row.iter()
                .skip(1)
                .find_map(|cell| match cell.value() {
                    ArchivedValue::Text { value, sources }
                        if !interface_label(value) && value.chars().any(char::is_alphabetic) =>
                    {
                        Some((value, sources))
                    }
                    _ => None,
                })
                .ok_or(WorkError::Invalid)?
        } else if interface_label(name) {
            return Err(WorkError::Invalid);
        } else {
            (name, sources)
        };
        let name_evidence = cite.cite(sources)?;
        let mut subject = WorkSubject {
            name: name.clone(),
            descriptor: None,
            homepage: None,
            record_media: media
                .and_then(|media| {
                    media
                        .iter()
                        .find(|media| usize::from(media.record) == record)
                })
                .cloned(),
            media_attempted: withheld,
            image_candidates: vec![],
        };
        let mut row_cells = Vec::new();
        // Include identity evidence in each cell: it binds the value to its subject.
        for field in self.fields.iter().skip(1) {
            if !self.visible(field) {
                match row
                    .iter()
                    .find(|cell| cell.name() == field.name())
                    .map(ArchivedField::value)
                {
                    Some(ArchivedValue::ImageUrl { value, .. }) => {
                        let public = !withheld
                            && zephium_core::work::media::is_public_image_candidate(value);
                        if public {
                            subject.image_candidates.push(value.clone());
                        }
                    }
                    None => {}
                    Some(_) => return Err(WorkError::Invalid),
                }
                continue;
            }
            let mut cell_evidence = name_evidence.clone();
            let value = match row
                .iter()
                .find(|cell| cell.name() == field.name())
                .map(ArchivedField::value)
            {
                Some(ArchivedValue::Text { value, sources })
                    if field.kind() == SemanticExtractionValueKind::Text =>
                {
                    cell_evidence.extend(cite.cite(sources)?);
                    WorkCellValue::Text {
                        text: value.clone(),
                    }
                }
                Some(ArchivedValue::Url { value, sources })
                    if field.kind() == SemanticExtractionValueKind::Url =>
                {
                    cell_evidence.extend(cite.cite(sources)?);
                    if self.subject_url_field.as_deref() == Some(field.name()) {
                        subject.homepage = Some(value.clone());
                    }
                    WorkCellValue::Text {
                        text: value.clone(),
                    }
                }
                Some(ArchivedValue::ImageUrl { value, sources })
                    if field.kind() == SemanticExtractionValueKind::ImageUrl =>
                {
                    cell_evidence.extend(cite.cite(sources)?);
                    if !withheld
                        && zephium_core::work::media::is_public_image_candidate(value)
                        && self
                            .subject_image_fields
                            .iter()
                            .any(|name| name == field.name())
                    {
                        let images = &mut subject.image_candidates;
                        if !images.contains(value) {
                            images.push(value.clone());
                        }
                    }
                    WorkCellValue::Text {
                        text: value.clone(),
                    }
                }
                Some(ArchivedValue::Money {
                    amount,
                    currency,
                    sources,
                }) if field.kind() == SemanticExtractionValueKind::Money
                    && field
                        .currencies()
                        .is_some_and(|currencies| currencies.contains(currency)) =>
                {
                    cell_evidence.extend(cite.cite(sources)?);
                    WorkCellValue::Money {
                        amount: amount.clone(),
                        currency: currency.clone(),
                        observed_at: None,
                    }
                }
                Some(ArchivedValue::Boolean { value, sources })
                    if field.kind() == SemanticExtractionValueKind::Boolean =>
                {
                    cell_evidence.extend(cite.cite(sources)?);
                    WorkCellValue::Presence { present: *value }
                }
                Some(ArchivedValue::Unsigned { value, sources })
                    if field.kind() == SemanticExtractionValueKind::Unsigned =>
                {
                    cell_evidence.extend(cite.cite(sources)?);
                    WorkCellValue::Text {
                        text: value.to_string(),
                    }
                }
                None if !field.required() => WorkCellValue::Unknown,
                _ => return Err(WorkError::Invalid),
            };
            cell_evidence.sort_unstable();
            cell_evidence.dedup();
            row_cells.push(WorkCell {
                value,
                evidence: cell_evidence,
                note: None,
                general_knowledge: false,
            });
        }
        Ok((subject, row_cells))
    }
}

/// A sort tab, filter or heading the page shows above its results ("Best",
/// "Cheapest"), read as if it were one of them: never a record.
fn interface_label(name: &str) -> bool {
    const LABELS: &[&str] = &[
        "best",
        "cheapest",
        "fastest",
        "quickest",
        "recommended",
        "top picks",
        "sort by",
        "relevance",
        "most popular",
        "popular",
        "lowest price",
        "highest rated",
        "other sort",
        "all results",
        "filters",
        "show more",
        "load more",
        "see all",
        "results",
        "sponsored",
        "najtańsze",
        "najlepsze",
        "polecane",
        "trafność",
        "sortuj",
    ];
    LABELS.contains(&letters(name).as_str()) || placeholder(name)
}

/// A container's generic name for a result ("Result item 2", "Card"): the
/// record is real, its name is not.
fn placeholder(name: &str) -> bool {
    const PLACEHOLDERS: &[&str] = &[
        "result",
        "result item",
        "item",
        "listing",
        "product",
        "card",
        "offer",
    ];
    PLACEHOLDERS.contains(&letters(name).as_str())
}

fn letters(name: &str) -> String {
    name.split(|c: char| !c.is_alphabetic())
        .filter(|word| !word.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

/// Cites archive sources as artifact evidence; a row that does not fit is
/// rolled back to its mark.
pub(super) trait Cite {
    fn cite(&mut self, sources: &[u16]) -> Result<Vec<u16>, WorkError>;
    fn mark(&self) -> usize {
        0
    }
    fn rollback(&mut self, _mark: usize) {}
}

impl<F: FnMut(&[u16]) -> Result<Vec<u16>, WorkError>> Cite for F {
    fn cite(&mut self, sources: &[u16]) -> Result<Vec<u16>, WorkError> {
        self(sources)
    }
}

struct Citer<'a> {
    archive: &'a AgentWorkArchivedExtraction,
    extraction_id: zephium_core::work::WorkArtifactId,
    evidence: Vec<WorkEvidenceLink>,
}

impl Cite for Citer<'_> {
    fn cite(&mut self, sources: &[u16]) -> Result<Vec<u16>, WorkError> {
        // A value proven by its first two sources is proven; citing every
        // fragment would spend the artifact's evidence on a few rows.
        sources
            .iter()
            .take(2)
            .map(|source| {
                if self.archive.source(*source).is_none() {
                    return Err(WorkError::Invalid);
                }
                let link = WorkEvidenceLink {
                    extraction_id: self.extraction_id,
                    source_id: *source,
                };
                let index = match self.evidence.iter().position(|item| *item == link) {
                    Some(index) => index,
                    None if self.evidence.len() >= MAX_ARTIFACT_EVIDENCE => {
                        return Err(WorkError::Capacity)
                    }
                    None => {
                        self.evidence.push(link);
                        self.evidence.len() - 1
                    }
                };
                u16::try_from(index).map_err(|_| WorkError::Capacity)
            })
            .collect()
    }
    fn mark(&self) -> usize {
        self.evidence.len()
    }
    fn rollback(&mut self, mark: usize) {
        self.evidence.truncate(mark);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn work_collection_compiles_into_the_checked_native_record_shape() {
        let request: WorkBrowseCollection = serde_json::from_value(serde_json::json!({
            "title":"Products", "max_items":3, "columns":[
                {"name":"price","required":false,"value":{"kind":"money","permitted_currencies":["USD"]}},
                {"name":"product_url","required":true,"value":{"kind":"url"}},
                {"name":"image","required":false,"value":{"kind":"image_url"}}
            ]
        }))
        .unwrap();
        let schema = WorkBrowseCollectionSchema::try_from(&request).unwrap();
        assert_eq!(schema.fields[0].name(), "name");
        assert!(schema.fields[0].required());
        assert_eq!(schema.fields[1].currencies().unwrap(), ["USD"]);
        assert_eq!(schema.subject_url_field.as_deref(), Some("product_url"));
        assert_eq!(schema.subject_image_fields, ["image"]);
        assert!(!schema.fields[2].document_address());
        let mut single = request.clone();
        single.max_items = 1;
        let single = WorkBrowseCollectionSchema::try_from(&single).unwrap();
        assert!(single.fields[2].document_address());
        let mut invalid = request.clone();
        invalid.columns[0].name = "name".into();
        assert!(WorkBrowseCollectionSchema::try_from(&invalid).is_err());
        invalid = request.clone();
        invalid.max_items = 33;
        assert!(WorkBrowseCollectionSchema::try_from(&invalid).is_err());
        invalid = request;
        invalid.columns[0].value = WorkBrowseValue::Money {
            currencies: vec!["USD".into(), "USD".into()],
        };
        assert!(WorkBrowseCollectionSchema::try_from(&invalid).is_err());
    }

    #[test]
    fn multiple_records_copy_identity_as_well_as_requested_observed_fields() {
        let request: WorkBrowseCollection = serde_json::from_value(serde_json::json!({
            "title":"Dated events","max_items":3,"columns":[
                {"name":"date","required":false,"value":{"kind":"text"},"extraction":"verbatim"},
                {"name":"url","required":true,"value":{"kind":"url"}}
            ]
        }))
        .unwrap();
        let schema = WorkBrowseCollectionSchema::try_from(&request).unwrap();
        assert!(
            schema.fields[0].verbatim_text(),
            "record names must retain an exact source fragment for every row"
        );
        assert!(schema.fields[1].verbatim_text());
        assert_eq!(schema.fields[2].kind(), SemanticExtractionValueKind::Url);
    }

    #[test]
    fn a_sort_tab_read_as_a_result_is_no_record() {
        assert!(interface_label("Best"));
        assert!(interface_label("Cheapest $1,178"));
        assert!(interface_label("Result item 2"));
        assert!(!interface_label("10:45 am – 9:28 pm LOT 1 stop"));
        assert!(!interface_label("Best Western Plus Downtown"));
    }

    #[test]
    fn a_result_named_only_by_its_position_is_named_by_its_own_text() {
        let request: WorkBrowseCollection = serde_json::from_value(serde_json::json!({
            "title":"Flights", "max_items":4, "columns":[
                {"name":"route","required":false,"value":{"kind":"text"}},
                {"name":"price","required":false,"value":{"kind":"text"}}
            ]
        }))
        .unwrap();
        let schema = WorkBrowseCollectionSchema::try_from(&request).unwrap();
        let rows: Vec<Vec<ArchivedField>> = serde_json::from_value(serde_json::json!([
            [{"name":"name","value":{"kind":"text","value":"Result item 1","sources":[1]}},
             {"name":"route","value":{"kind":"text","value":"6:05 am – 11:45 am KLM 1 stop","sources":[2]}},
             {"name":"price","value":{"kind":"text","value":"$1,384","sources":[3]}}],
            [{"name":"name","value":{"kind":"text","value":"Cheapest","sources":[4]}},
             {"name":"price","value":{"kind":"text","value":"$1,110","sources":[5]}}],
            [{"name":"name","value":{"kind":"text","value":"Result item 3","sources":[6]}},
             {"name":"price","value":{"kind":"text","value":"$990","sources":[7]}}]
        ]))
        .unwrap();
        let data = schema
            .comparison(&rows, &mut |ids: &[u16]| Ok(ids.to_vec()))
            .unwrap();
        let WorkArtifactDataV1::ComparisonMatrix {
            subjects, cells, ..
        } = data
        else {
            panic!("comparison");
        };
        assert_eq!(subjects.len(), 1);
        assert_eq!(subjects[0].name, "6:05 am – 11:45 am KLM 1 stop");
        assert_eq!(cells[0][0].evidence, vec![2]);
    }

    #[test]
    fn a_row_that_breaks_or_overflows_leaves_only_itself_out() {
        let request: WorkBrowseCollection = serde_json::from_value(serde_json::json!({
            "title":"Stays", "max_items":4, "columns":[
                {"name":"price","required":false,"value":{"kind":"text"}}
            ]
        }))
        .unwrap();
        let schema = WorkBrowseCollectionSchema::try_from(&request).unwrap();
        let rows: Vec<Vec<ArchivedField>> = serde_json::from_value(serde_json::json!([
            [{"name":"name","value":{"kind":"text","value":"Loft","sources":[1]}},
             {"name":"price","value":{"kind":"text","value":"$90","sources":[2]}}],
            [{"name":"name","value":{"kind":"text","value":"Studio","sources":[3]}},
             {"name":"stray","value":{"kind":"text","value":"?","sources":[4]}}],
            [{"name":"name","value":{"kind":"text","value":"Flat","sources":[5]}}],
            [{"name":"name","value":{"kind":"text","value":"Room","sources":[9]}}]
        ]))
        .unwrap();
        let data = schema
            .comparison(&rows, &mut |ids: &[u16]| {
                if ids.contains(&9) {
                    return Err(WorkError::Capacity);
                }
                Ok(ids.iter().map(|id| id - 1).collect())
            })
            .unwrap();
        let WorkArtifactDataV1::ComparisonMatrix { subjects, .. } = data else {
            panic!()
        };
        let names: Vec<_> = subjects.iter().map(|s| s.name.as_str()).collect();
        assert_eq!(names, ["Loft", "Flat"]);
    }

    #[test]
    fn native_image_attempt_never_republishes_local_sources_as_remote_candidates() {
        let request: WorkBrowseCollection = serde_json::from_value(serde_json::json!({
            "title":"Native card", "max_items":1, "columns":[
                {"name":"description","required":true,"value":{"kind":"text"},"extraction":"verbatim"}
            ]
        })).unwrap();
        let schema = WorkBrowseCollectionSchema::try_from(&request).unwrap();
        for url in [
            "http://127.0.0.1/image.png",
            "blob:https://example.test/private",
            "https://example.test/image.png",
        ] {
            let rows: Vec<Vec<ArchivedField>> = serde_json::from_value(serde_json::json!([[
                {"name":"name","value":{"kind":"text","value":"Wool scarf","sources":[1]}},
                {"name":"description","value":{"kind":"text","value":"Source-backed text","sources":[2]}},
                {"name":"image","value":{"kind":"image_url","value":url,"sources":[3]}}
            ]])).unwrap();
            let data = schema
                .comparison_media(
                    &rows,
                    &mut |ids: &[u16]| Ok(ids.iter().map(|id| id - 1).collect()),
                    Some(&[]),
                    &[],
                )
                .unwrap();
            data.validate(3).unwrap();
            let WorkArtifactDataV1::ComparisonMatrix {
                subjects, cells, ..
            } = data
            else {
                panic!()
            };
            assert!(subjects[0].media_attempted);
            assert!(subjects[0].image_candidates.is_empty());
            assert!(
                matches!(&cells[0][0].value, WorkCellValue::Text { text } if text == "Source-backed text")
            );
            // The older no-native path also omits an unsafe optional candidate,
            // rather than discarding source-backed text or relaxing URL policy.
            schema
                .comparison(&rows, &mut |ids| Ok(ids.iter().map(|id| id - 1).collect()))
                .unwrap()
                .validate(3)
                .unwrap();
        }
    }

    #[test]
    fn public_association_miss_keeps_validated_candidate_but_private_row_stays_withheld() {
        let request: WorkBrowseCollection = serde_json::from_value(serde_json::json!({
            "title":"Cards", "max_items":2, "columns":[
                {"name":"description","required":true,"value":{"kind":"text"},"extraction":"verbatim"}
            ]
        })).unwrap();
        let schema = WorkBrowseCollectionSchema::try_from(&request).unwrap();
        let rows: Vec<Vec<ArchivedField>> = serde_json::from_value(serde_json::json!([
            [{"name":"name","value":{"kind":"text","value":"Public card","sources":[1]}},
             {"name":"description","value":{"kind":"text","value":"Observed text","sources":[2]}},
             {"name":"image","value":{"kind":"image_url","value":"https://cdn.example.com/a.png","sources":[3]}}],
            [{"name":"name","value":{"kind":"text","value":"Private card","sources":[4]}},
             {"name":"description","value":{"kind":"text","value":"Other text","sources":[5]}},
             {"name":"image","value":{"kind":"image_url","value":"https://cdn.example.com/b.png","sources":[6]}}]
        ])).unwrap();
        assert_eq!(schema.candidate_rows(&rows), vec![0, 1]);
        let data = schema
            .comparison_media(
                &rows,
                &mut |ids: &[u16]| Ok(ids.iter().map(|id| id - 1).collect()),
                Some(&[]),
                &[0],
            )
            .unwrap();
        data.validate(6).unwrap();
        let WorkArtifactDataV1::ComparisonMatrix {
            subjects, cells, ..
        } = data
        else {
            panic!()
        };
        assert_eq!(
            subjects[0].image_candidates,
            ["https://cdn.example.com/a.png"]
        );
        assert!(!subjects[0].media_attempted);
        assert!(subjects[1].image_candidates.is_empty());
        assert!(subjects[1].media_attempted);
        assert_eq!(cells.len(), 2);
    }

    #[test]
    fn request_without_image_column_reads_an_implicit_picture_outside_the_criteria() {
        let request: WorkBrowseCollection = serde_json::from_value(serde_json::json!({
            "title":"Product details", "max_items":1, "columns":[
                {"name":"price","required":false,"value":{"kind":"text"},"extraction":"verbatim"},
                {"name":"pieces","required":false,"value":{"kind":"text"},"extraction":"verbatim"}
            ]
        }))
        .unwrap();
        let schema = WorkBrowseCollectionSchema::try_from(&request).unwrap();
        let image = schema.fields.last().unwrap();
        assert_eq!(image.name(), "image");
        assert_eq!(image.kind(), SemanticExtractionValueKind::ImageUrl);
        assert!(!image.required());
        let mut objective = String::new();
        schema.append_browsing_fields(&mut objective).unwrap();
        assert!(objective.contains("image: image_url optional"));
        let rows: Vec<Vec<ArchivedField>> = serde_json::from_value(serde_json::json!([[
            {"name":"name","value":{"kind":"text","value":"London","sources":[1]}},
            {"name":"price","value":{"kind":"text","value":"$59.99","sources":[2]}},
            {"name":"image","value":{"kind":"image_url","value":"https://www.lego.com/london.png","sources":[3]}}
        ]])).unwrap();
        let data = schema
            .comparison(&rows, &mut |ids| Ok(ids.iter().map(|id| id - 1).collect()))
            .unwrap();
        data.validate(3).unwrap();
        let WorkArtifactDataV1::ComparisonMatrix {
            subjects,
            criteria,
            cells,
            ..
        } = data
        else {
            panic!()
        };
        assert_eq!(
            subjects[0].image_candidates,
            ["https://www.lego.com/london.png"]
        );
        assert_eq!(
            criteria
                .iter()
                .map(|criterion| criterion.name.as_str())
                .collect::<Vec<_>>(),
            ["price", "pieces"]
        );
        assert_eq!(cells[0].len(), 2);
        let rows: Vec<Vec<ArchivedField>> = serde_json::from_value(serde_json::json!([[
            {"name":"name","value":{"kind":"text","value":"London","sources":[1]}}
        ]]))
        .unwrap();
        let unpictured = schema
            .comparison(&rows, &mut |ids| Ok(ids.iter().map(|id| id - 1).collect()))
            .unwrap();
        let WorkArtifactDataV1::ComparisonMatrix { subjects, .. } = unpictured else {
            panic!()
        };
        assert!(subjects[0].image_candidates.is_empty());
        let mut full = request.clone();
        full.columns = (0..MAX_ARTIFACT_CRITERIA)
            .map(|index| {
                let mut column = request.columns[0].clone();
                column.name = format!("fact_{index}");
                column
            })
            .collect();
        let full = WorkBrowseCollectionSchema::try_from(&full).unwrap();
        assert!(!full.implicit_image);
        assert_eq!(full.fields.len(), MAX_ARTIFACT_CRITERIA + 1);
    }

    #[test]
    fn explicit_image_column_stays_a_visible_criterion_without_an_implicit_field() {
        let request: WorkBrowseCollection = serde_json::from_value(serde_json::json!({
            "title":"Products", "max_items":1, "columns":[
                {"name":"price","required":false,"value":{"kind":"text"}},
                {"name":"photo","required":false,"value":{"kind":"image_url"}}
            ]
        }))
        .unwrap();
        let schema = WorkBrowseCollectionSchema::try_from(&request).unwrap();
        assert!(!schema.implicit_image);
        assert_eq!(schema.subject_image_fields, ["photo"]);
        assert_eq!(schema.fields.len(), 3);
        let rows: Vec<Vec<ArchivedField>> = serde_json::from_value(serde_json::json!([[
            {"name":"name","value":{"kind":"text","value":"London","sources":[1]}},
            {"name":"photo","value":{"kind":"image_url","value":"https://www.lego.com/london.png","sources":[2]}}
        ]])).unwrap();
        let data = schema
            .comparison(&rows, &mut |ids| Ok(ids.iter().map(|id| id - 1).collect()))
            .unwrap();
        let WorkArtifactDataV1::ComparisonMatrix {
            subjects,
            criteria,
            cells,
            ..
        } = data
        else {
            panic!()
        };
        assert_eq!(
            subjects[0].image_candidates,
            ["https://www.lego.com/london.png"]
        );
        assert_eq!(criteria[1].name, "photo");
        assert!(
            matches!(&cells[0][1].value, WorkCellValue::Text { text } if text == "https://www.lego.com/london.png")
        );
        assert_eq!(cells[0][1].evidence, [0, 1]);
    }

    #[test]
    fn short_collection_reports_validated_count_and_missing_values_without_claiming_page_exhaustion(
    ) {
        let request: WorkBrowseCollection = serde_json::from_value(serde_json::json!({
            "title":"Results", "max_items":3, "columns":[
                {"name":"price","required":false,"value":{"kind":"text"}},
                {"name":"url","required":true,"value":{"kind":"url"}}
            ]
        }))
        .unwrap();
        let schema = WorkBrowseCollectionSchema::try_from(&request).unwrap();
        let rows: Vec<Vec<ArchivedField>> = serde_json::from_value(serde_json::json!([[
            {"name":"name","value":{"kind":"text","value":"Observed item","sources":[1]}},
            {"name":"url","value":{"kind":"url","value":"https://example.test/item?variant=2","sources":[2]}}
        ]])).unwrap();
        let data = schema
            .comparison(&rows, &mut |ids| Ok(ids.iter().map(|id| id - 1).collect()))
            .unwrap();
        data.validate(2).unwrap();
        let WorkArtifactDataV1::ComparisonMatrix { notes, cells, .. } = data else {
            panic!()
        };
        assert!(notes[0].contains("validated 1 records against a limit of 3"));
        assert!(notes[0].contains("additional matches may exist or remain unread"));
        assert!(notes[1].contains("unknown cells remain empty"));
        assert!(matches!(cells[0][0].value, WorkCellValue::Unknown));
    }

    #[test]
    fn partial_product_record_preserves_anchored_link_and_unknown_fields() {
        let request = serde_json::from_value::<WorkBrowseCollection>(serde_json::json!({
            "title":"Product details", "max_items":1, "columns":[
                {"name":"price","required":false,"value":{"kind":"text"}},
                {"name":"pieces","required":false,"value":{"kind":"text"}},
                {"name":"dimensions","required":false,"value":{"kind":"text"}},
                {"name":"image","required":false,"value":{"kind":"image_url"}},
                {"name":"url","required":false,"value":{"kind":"url"}}
            ]
        }))
        .unwrap();
        let schema = WorkBrowseCollectionSchema::try_from(&request).unwrap();
        let mut rows: Vec<Vec<ArchivedField>> = serde_json::from_value(serde_json::json!([[
            {"name":"name","value":{"kind":"text","value":"Paris – City of Love","sources":[64]}},
            {"name":"pieces","value":{"kind":"text","value":"958","sources":[33]}},
            {"name":"image","value":{"kind":"image_url","value":"https://www.lego.com/product.png?width=800&height=800","sources":[26]}},
            {"name":"url","value":{"kind":"url","value":"https://www.lego.com/en-us/product/architecture-21064-21064#main-content","sources":[2]}}
        ]])).unwrap();
        let data = schema
            .comparison(&rows, &mut |ids| {
                Ok(ids
                    .iter()
                    .map(|id| match id {
                        64 => 0,
                        33 => 1,
                        26 => 2,
                        2 => 3,
                        _ => panic!(),
                    })
                    .collect())
            })
            .unwrap();
        data.validate(4).unwrap();
        let WorkArtifactDataV1::ComparisonMatrix {
            subjects, cells, ..
        } = data
        else {
            panic!()
        };
        assert_eq!(
            subjects[0].homepage.as_deref(),
            Some("https://www.lego.com/en-us/product/architecture-21064-21064#main-content")
        );
        assert!(matches!(cells[0][0].value, WorkCellValue::Unknown));
        assert!(matches!(cells[0][2].value, WorkCellValue::Unknown));
        assert_eq!(cells[0][1].evidence, [0, 1]);
        for invalid in [
            "javascript:alert(1)",
            "https://user:password@example.test/product#details",
            "http://example.test/product#details",
        ] {
            rows[0][3] = serde_json::from_value(serde_json::json!({"name":"url","value":{"kind":"url","value":invalid,"sources":[2]}})).unwrap();
            let data = schema.comparison(&rows, &mut |_| Ok(vec![0])).unwrap();
            assert!(data.validate(1).is_err());
        }
    }

    #[test]
    fn money_cells_keep_decimal_precision_currency_and_identity_citations() {
        let schema = WorkBrowseCollectionSchema::try_new(
            "Prices".into(),
            vec![
                SemanticExtractionFieldSchema::try_text("name".into(), true, 256).unwrap(),
                SemanticExtractionFieldSchema::try_money("price".into(), false, vec!["EUR".into()])
                    .unwrap(),
            ],
            3,
        )
        .unwrap();
        let rows: Vec<Vec<ArchivedField>> = serde_json::from_value(serde_json::json!([
            [{"name":"name","value":{"kind":"text","value":"Item A","sources":[1]}}, {"name":"price","value":{"kind":"money","amount":"1299.50","currency":"EUR","sources":[2]}}],
            [{"name":"name","value":{"kind":"text","value":"Item B","sources":[3]}}]
        ])).unwrap();
        let data = schema
            .comparison(&rows, &mut |ids| Ok(ids.iter().map(|id| id - 1).collect()))
            .unwrap();
        data.validate(3).unwrap();
        let WorkArtifactDataV1::ComparisonMatrix { cells, .. } = data else {
            panic!()
        };
        assert!(
            matches!(&cells[0][0].value, WorkCellValue::Money { amount, currency, observed_at: None } if amount == "1299.50" && currency == "EUR")
        );
        assert_eq!(cells[0][0].evidence, [0, 1]);
        assert!(matches!(cells[1][0].value, WorkCellValue::Unknown));
    }

    #[test]
    fn subject_url_is_host_selected_and_keeps_identity_and_destination_citations() {
        let schema = WorkBrowseCollectionSchema::try_new(
            "Items".into(),
            vec![
                SemanticExtractionFieldSchema::try_text("name".into(), true, 256).unwrap(),
                SemanticExtractionFieldSchema::try_url("product_url".into(), true, 512).unwrap(),
                SemanticExtractionFieldSchema::try_image_url("image".into(), true, 512).unwrap(),
            ],
            3,
        )
        .unwrap();
        assert!(schema.clone().with_subject_url_field("name").is_err());
        let schema = schema
            .with_subject_url_field("product_url")
            .unwrap()
            .with_subject_image_field("image")
            .unwrap();
        let rows: Vec<Vec<ArchivedField>> = serde_json::from_value(serde_json::json!([[
            {"name":"name","value":{"kind":"text","value":"Item A","sources":[1]}},
            {"name":"product_url","value":{"kind":"url","value":"https://shop.example.test/a","sources":[2]}},
            {"name":"image","value":{"kind":"image_url","value":"https://images.example.test/a.webp","sources":[3]}}
        ]])).unwrap();
        let data = schema
            .comparison(&rows, &mut |ids| Ok(ids.iter().map(|id| id - 1).collect()))
            .unwrap();
        data.validate(3).unwrap();
        let WorkArtifactDataV1::ComparisonMatrix {
            subjects, cells, ..
        } = data
        else {
            panic!()
        };
        assert_eq!(
            subjects[0].homepage.as_deref(),
            Some("https://shop.example.test/a")
        );
        assert_eq!(cells[0][0].evidence, [0, 1]);
        assert_eq!(cells[0][1].evidence, [0, 2]);
        assert_eq!(
            subjects[0].image_candidates,
            ["https://images.example.test/a.webp"]
        );
    }

    #[test]
    fn collection_keeps_row_identity_citations_and_missing_values_distinct() {
        let schema = WorkBrowseCollectionSchema::try_new(
            "Observed items".into(),
            vec![
                SemanticExtractionFieldSchema::try_text("name".into(), true, 256).unwrap(),
                SemanticExtractionFieldSchema::try_text("displayed_price".into(), false, 128)
                    .unwrap(),
                SemanticExtractionFieldSchema::try_boolean("available".into(), false).unwrap(),
            ],
            3,
        )
        .unwrap();
        let rows: Vec<Vec<ArchivedField>> = serde_json::from_value(serde_json::json!([
            [
                {"name":"name","value":{"kind":"text","value":"Item A","sources":[1]}},
                {"name":"displayed_price","value":{"kind":"text","value":"£99.50","sources":[2]}},
                {"name":"available","value":{"kind":"boolean","value":false,"sources":[3]}}
            ],
            [{"name":"name","value":{"kind":"text","value":"Item B","sources":[4]}}]
        ]))
        .unwrap();
        let data = schema
            .comparison(&rows, &mut |ids| Ok(ids.iter().map(|id| id - 1).collect()))
            .unwrap();
        data.validate(4).unwrap();
        let WorkArtifactDataV1::ComparisonMatrix {
            subjects, cells, ..
        } = data
        else {
            panic!()
        };
        assert_eq!(subjects[0].name, "Item A");
        assert_eq!(subjects[1].name, "Item B");
        assert!(matches!(&cells[0][0].value, WorkCellValue::Text { text } if text == "£99.50"));
        assert_eq!(cells[0][0].evidence, [0, 1]);
        assert!(matches!(
            cells[0][1].value,
            WorkCellValue::Presence { present: false }
        ));
        assert_eq!(cells[0][1].evidence, [0, 2]);
        assert!(matches!(cells[1][0].value, WorkCellValue::Unknown));
        assert!(matches!(cells[1][1].value, WorkCellValue::Unknown));
        assert_eq!(cells[1][0].evidence, [3]);
        assert!(schema
            .comparison(&rows, &mut |_| Err(WorkError::Invalid))
            .is_err());
    }

    #[test]
    fn repeated_names_preserve_distinct_values_and_sources_but_exact_rows_dedup() {
        // The observed Airbnb failure used repeated display names. They are
        // separate cited listings, not permission to silently drop later rows.
        let schema = WorkBrowseCollectionSchema::try_new(
            "Observed stays".into(),
            vec![
                SemanticExtractionFieldSchema::try_text("name".into(), true, 256).unwrap(),
                SemanticExtractionFieldSchema::try_text("displayed_price".into(), false, 128)
                    .unwrap(),
            ],
            4,
        )
        .unwrap();
        let row = |name: &str, first: u16, price: &str| {
            serde_json::json!([
                {"name":"name","value":{"kind":"text","value":name,"sources":[first]}},
                {"name":"displayed_price","value":{"kind":"text","value":price,"sources":[first + 1]}}
            ])
        };
        let rows: Vec<Vec<ArchivedField>> = serde_json::from_value(serde_json::json!([
            row("Monthly stay", 1, "$2,100"),
            row(" Monthly stay", 3, "$2,300"),
            row("Studio", 5, "$1,900"),
            row("Monthly stay", 7, "$2,500"),
            row("Monthly stay", 1, "$2,100"),
        ]))
        .unwrap();
        let mut cited = Vec::new();
        let data = schema
            .comparison(&rows, &mut |ids| {
                cited.extend_from_slice(ids);
                Ok(ids.iter().map(|id| id - 1).collect())
            })
            .unwrap();
        data.validate(8).unwrap();
        let WorkArtifactDataV1::ComparisonMatrix {
            subjects, cells, ..
        } = data
        else {
            panic!()
        };
        let names: Vec<_> = subjects
            .iter()
            .map(|subject| subject.name.as_str())
            .collect();
        assert_eq!(
            names,
            ["Monthly stay", " Monthly stay", "Studio", "Monthly stay"]
        );
        assert!(matches!(&cells[0][0].value, WorkCellValue::Text { text } if text == "$2,100"));
        assert_eq!(cited, [1, 2, 3, 4, 5, 6, 7, 8]);
        for (row, expected) in cells.iter().zip(["$2,100", "$2,300", "$1,900", "$2,500"]) {
            assert!(matches!(&row[0].value, WorkCellValue::Text { text } if text == expected));
        }
    }
}
