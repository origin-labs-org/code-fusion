//! One fresh read of the page in front, as the core receives it.
use std::collections::BTreeMap;

/// What kind of page this mostly is, judged by the reader from structure.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub enum PageKind {
    /// Long prose: news, blog, reference.
    Article,
    /// One thing for sale or a pricing table.
    Product,
    /// Ordered steps: a recipe or a how-to.
    HowTo,
    /// Many similar items: search results, a feed.
    Listing,
    /// Technical documentation.
    Docs,
    /// Anything else.
    #[default]
    Other,
}

/// Content-free counts that steer the one-click suggestions.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct PageTraits {
    /// Kind the reader judged from structure.
    pub kind: PageKind,
    /// Words of readable text.
    pub words: u32,
    /// Figures in the text: amounts, percentages, dates.
    pub numbers: u16,
    /// Amounts of money.
    pub prices: u16,
    /// Rows of tables.
    pub table_rows: u16,
    /// Items of ordered lists.
    pub steps: u16,
    /// Form fields the person could fill.
    pub fields: u16,
}

/// One passage of the read, addressable by the model by its number.
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct Fragment {
    /// The page's own words exactly as shown, when the read proved them
    /// complete. Only this is ever highlighted or quoted back.
    pub verbatim: Option<String>,
    /// Where a link leads: an absolute `http(s)` address from the reader,
    /// never from the model.
    pub href: Option<String>,
}

/// One fresh read of the tab.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PageRead {
    /// Registrable site, such as wikipedia.org.
    pub site: String,
    /// The tab's host, such as en.wikipedia.org.
    pub host: String,
    /// The page's title, as the page states it (untrusted).
    pub title: Option<String>,
    /// The model-facing encoding of the read (untrusted page content).
    pub payload: String,
    /// Passages the payload names, by their `rN` number.
    pub fragments: BTreeMap<u16, Fragment>,
    /// Structure counts.
    pub traits: PageTraits,
    /// Changes whenever the read's content changes.
    pub fingerprint: u64,
}

impl PageRead {
    /// Whether `id` names a passage of this read.
    pub fn knows(&self, id: u16) -> bool {
        self.fragments.contains_key(&id)
    }

    /// Passages in the read.
    pub fn passages(&self) -> u32 {
        u32::try_from(self.fragments.len()).unwrap_or(u32::MAX)
    }
}
