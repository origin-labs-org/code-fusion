//! Sites the agent may work on as the person: the profile's standing answers.
use super::*;
pub use zephium_core::work::sites::WorkSiteAccessV1;

/// One site as Settings lists it.
#[derive(Clone, Debug, Serialize, Deserialize, Eq, PartialEq, Type)]
#[serde(deny_unknown_fields)]
pub struct WorkSiteRowV1 {
    /// Registrable domain, such as slack.com.
    pub site: String,
    /// What people call it, such as Slack.
    pub name: String,
    pub access: WorkSiteAccessV1,
    /// Banks, password managers and health or tax portals: Always is refused.
    pub sensitive: bool,
}

/// Sets one site's standing answer, or clears it with `access: null`.
#[derive(Clone, Debug, Serialize, Deserialize, Eq, PartialEq, Type)]
#[serde(deny_unknown_fields)]
pub struct WorkSiteChangeV1 {
    pub site: String,
    pub access: Option<WorkSiteAccessV1>,
}

#[derive(Clone, Debug, Serialize, Deserialize, Eq, PartialEq, Type)]
#[serde(deny_unknown_fields)]
pub struct WorkSiteAccessResponseV1 {
    pub version: u16,
    pub profile: String,
    pub sites: Vec<WorkSiteRowV1>,
    pub error: Option<WorkFailureV1>,
}

/// A separately remembered screenshot origin; never account-entry authority.
#[derive(Clone, Debug, Serialize, Deserialize, Eq, PartialEq, Type)]
#[serde(deny_unknown_fields)]
pub struct WorkScreenshotSiteRowV1 {
    pub origin: String,
    pub name: String,
    /// A prior mutation was not confirmed; model-image permission remains closed.
    pub unconfirmed: bool,
}
#[derive(Clone, Debug, Serialize, Deserialize, Eq, PartialEq, Type)]
#[serde(deny_unknown_fields)]
pub struct WorkScreenshotSiteChangeV1 {
    pub origin: String,
    pub allow: bool,
}
#[derive(Clone, Debug, Serialize, Deserialize, Eq, PartialEq, Type)]
pub struct WorkScreenshotSitesResponseV1 {
    pub version: u16,
    pub profile: String,
    pub sites: Vec<WorkScreenshotSiteRowV1>,
    pub error: Option<WorkFailureV1>,
}
