//! Mechanical checks for the Ask panel: its pure core stays free of I/O,
//! runtimes and logging, and its service stays free of logging.

use std::path::{Path, PathBuf};

use toml::Value;

const CORE_ROOT: &str = "crates/zephium-page-assist";
const SERVICE_ROOT: &str = "crates/zephium-work-composition/src/page_assist";
const CORE_DEPENDENCIES: [&str; 2] = ["zephium-ipc", "cssparser"];
const CORE_DEV_DEPENDENCIES: [&str; 1] = ["proptest"];
const CORE_ATTRIBUTES: [&str; 3] = [
    "#![forbid(unsafe_code)]",
    "#![deny(missing_docs)]",
    "#![deny(clippy::dbg_macro, clippy::print_stderr, clippy::print_stdout)]",
];
/// Anything that reaches outside memory, keeps time, spawns or logs.
const CORE_FORBIDDEN: [&str; 22] = [
    "tokio",
    "reqwest",
    "hyper",
    "tauri",
    "wry",
    "zephium_engine",
    "zephium_app",
    "zephium_store",
    "zephium_agentic",
    "std::fs",
    "std::net",
    "std::process",
    "std::thread",
    "std::env",
    "Instant::now",
    "SystemTime",
    "unsafe ",
    "static mut",
    "include_bytes!",
    "include_str!",
    "OnceLock",
    "thread_local!",
];
/// Logging in any form; production modules report closed errors only.
const LOGGING: [&str; 10] = [
    "println!",
    "eprintln!",
    "print!(",
    "eprint!(",
    "dbg!(",
    "tracing::",
    "log::",
    "std::io::stderr(",
    "std::io::stdout(",
    "debug!(",
];

/// Checks the pure core's manifest and sources, and the service's sources.
pub(crate) fn check(repository: &Path) -> Result<(), String> {
    let core = repository.join(CORE_ROOT);
    for entry in read_directory(&core)? {
        let name = entry
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or_default()
            .to_owned();
        if !matches!(name.as_str(), "Cargo.toml" | "src") {
            return Err(format!(
                "page-assist core has an unapproved build input: {name}"
            ));
        }
    }
    validate_manifest(&read(&core.join("Cargo.toml"))?)?;
    let root = read(&core.join("src/lib.rs"))?;
    for attribute in CORE_ATTRIBUTES {
        if !root.contains(attribute) {
            return Err(format!("page-assist core lost {attribute}"));
        }
    }
    if !root.contains("deny(clippy::panic, clippy::unreachable, clippy::unwrap_used)") {
        return Err("page-assist core lost its no-panic attribute".to_owned());
    }
    for path in rust_sources(&core.join("src"))? {
        let source = read(&path)?;
        let production = production_part(&source);
        for token in CORE_FORBIDDEN.iter().chain(LOGGING.iter()) {
            if production.contains(token) {
                return Err(format!(
                    "page-assist core {} acquired forbidden surface {token}",
                    path.display()
                ));
            }
        }
    }
    let service = repository.join(SERVICE_ROOT);
    if service.exists() {
        for path in rust_sources(&service)? {
            let source = read(&path)?;
            let production = production_part(&source);
            for token in LOGGING {
                if production.contains(token) {
                    return Err(format!(
                        "page-assist service {} acquired logging {token}",
                        path.display()
                    ));
                }
            }
            if production.contains("unsafe ") {
                return Err(format!(
                    "page-assist service {} acquired unsafe code",
                    path.display()
                ));
            }
        }
    }
    Ok(())
}

/// The source above its test module; tests may print and use fixtures.
fn production_part(source: &str) -> &str {
    source
        .find("#[cfg(test)]\nmod tests")
        .map_or(source, |start| &source[..start])
}

fn validate_manifest(source: &str) -> Result<(), String> {
    let manifest: Value = toml::from_str(source)
        .map_err(|error| format!("page-assist core manifest is invalid TOML: {error}"))?;
    let package = manifest
        .get("package")
        .and_then(Value::as_table)
        .ok_or_else(|| "page-assist core package metadata is missing".to_owned())?;
    if package.get("name").and_then(Value::as_str) != Some("zephium-page-assist")
        || package.get("publish").and_then(Value::as_bool) != Some(false)
        || package.get("build").and_then(Value::as_bool) != Some(false)
    {
        return Err("page-assist core package metadata drifted".to_owned());
    }
    for forbidden in ["lib", "bin", "features", "build-dependencies", "target"] {
        if manifest.get(forbidden).is_some() {
            return Err(format!("page-assist core may not declare {forbidden}"));
        }
    }
    for (table, allowed) in [
        ("dependencies", &CORE_DEPENDENCIES[..]),
        ("dev-dependencies", &CORE_DEV_DEPENDENCIES[..]),
    ] {
        let names: Vec<&str> = manifest
            .get(table)
            .and_then(Value::as_table)
            .map(|table| table.keys().map(String::as_str).collect())
            .unwrap_or_default();
        if let Some(name) = names.iter().find(|name| !allowed.contains(name)) {
            return Err(format!(
                "page-assist core may not depend on {name} ({table})"
            ));
        }
    }
    Ok(())
}

fn read(path: &Path) -> Result<String, String> {
    std::fs::read_to_string(path)
        .map_err(|error| format!("cannot read {}: {error}", path.display()))
}

fn read_directory(path: &Path) -> Result<Vec<PathBuf>, String> {
    let mut entries = Vec::new();
    for entry in std::fs::read_dir(path)
        .map_err(|error| format!("cannot read {}: {error}", path.display()))?
    {
        let entry = entry.map_err(|error| format!("cannot inspect {}: {error}", path.display()))?;
        entries.push(entry.path());
    }
    entries.sort();
    Ok(entries)
}

fn rust_sources(directory: &Path) -> Result<Vec<PathBuf>, String> {
    let mut sources = Vec::new();
    for path in read_directory(directory)? {
        let metadata = std::fs::symlink_metadata(&path)
            .map_err(|error| format!("cannot inspect {}: {error}", path.display()))?;
        if metadata.file_type().is_symlink() {
            return Err(format!(
                "page-assist sources may not be symlinks: {}",
                path.display()
            ));
        }
        if metadata.is_dir() {
            sources.extend(rust_sources(&path)?);
        } else if path.extension().is_some_and(|extension| extension == "rs") {
            sources.push(path);
        } else {
            return Err(format!(
                "page-assist sources hold a non-Rust file: {}",
                path.display()
            ));
        }
    }
    Ok(sources)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn repository_passes() {
        let repository = Path::new(env!("CARGO_MANIFEST_DIR")).join("..");
        check(&repository).expect("page-assist boundary");
    }

    #[test]
    fn manifest_rejects_new_dependencies_and_build_inputs() {
        let base = "[package]\nname = \"zephium-page-assist\"\npublish = false\nbuild = false\n";
        assert!(validate_manifest(&format!("{base}[dependencies]\nzephium-ipc = \"1\"\n")).is_ok());
        for extra in [
            "[dependencies]\ntokio = \"1\"\n",
            "[dev-dependencies]\nreqwest = \"1\"\n",
            "[features]\nx = []\n",
            "[build-dependencies]\ncc = \"1\"\n",
        ] {
            assert!(
                validate_manifest(&format!("{base}{extra}")).is_err(),
                "{extra}"
            );
        }
    }

    #[test]
    fn test_modules_are_exempt_but_production_code_is_not() {
        let source = "fn a() {}\n#[cfg(test)]\nmod tests { fn b() { println!(\"x\"); } }";
        assert!(!production_part(source).contains("println!"));
        assert!(production_part("fn a() { println!(\"x\"); }").contains("println!"));
    }
}
