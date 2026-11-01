//! Selected working-tree content compared with the current Git index.
use super::*;
use crate::work_commands::runner::{self, git_index, Failure, ReadOperation};
use sha2::{Digest, Sha256};

impl ComputerTools {
    pub(super) async fn git_changes(
        &self,
        host: &dyn ComputerHost,
        args: &Value,
    ) -> Result<ToolReply, ToolReply> {
        let operation = text(args, "operation")?;
        let selected = match operation {
            "diff" => ReadOperation::Diff,
            "status" => ReadOperation::Status,
            "check" => ReadOperation::Check,
            _ => return Err(ToolReply::fault("operation is diff, status or check")),
        };
        let paths = args
            .get("paths")
            .and_then(Value::as_array)
            .filter(|paths| !paths.is_empty() && paths.len() <= 64)
            .ok_or_else(|| ToolReply::fault("Choose 1 to 64 relative file paths"))?;
        let paths: Vec<String> = paths
            .iter()
            .map(|path| {
                path.as_str()
                    .filter(|path| path.len() <= 4096)
                    .map(str::to_owned)
                    .ok_or_else(|| {
                        ToolReply::fault("Each selected path must be a bounded relative file path")
                    })
            })
            .collect::<Result<_, _>>()?;
        runner::ensure_available().map_err(|error| ToolReply::fault(error.note()))?;
        let root = self
            .files
            .roots()
            .iter()
            .filter(|root| self.root.starts_with(root))
            .max_by_key(|root| root.components().count())
            .ok_or_else(|| ToolReply::fault("The folder is not granted"))?;
        let command =
            format!("git_changes {operation} (working-tree content against current index)");
        let step = host
            .begin(
                WorkStepKindV1::RunCommand {
                    cwd: self.root.to_string_lossy().into_owned(),
                    command: command.clone(),
                    timeout_secs: Some(100),
                    decision: None,
                },
                Some(WorkLocalStepV1 {
                    policy: Some(WorkCommandPolicyV1 {
                        class: WorkCommandClassV1::Read,
                        reason: WorkCommandReasonV1::Inspection,
                        scope: WorkCommandApprovalScopeV1::None,
                        root: root.to_string_lossy().into_owned(),
                    }),
                    ..Default::default()
                }),
            )
            .await
            .map_err(stopped)?;
        let started = std::time::Instant::now();
        let output = git_index::inspect(&self.files, &self.root, &paths, selected, || {
            host.cancelled()
        })
        .await;
        let output = match output {
            Ok(output) => output,
            Err(error) => {
                host.settle(
                    step,
                    if matches!(
                        error,
                        git_index::Error::Stopped | git_index::Error::Runner(Failure::Stopped)
                    ) {
                        WorkStepStatus::Cancelled
                    } else {
                        WorkStepStatus::Failed
                    },
                    Settled::Nothing,
                    Some(error.note().into()),
                )
                .await
                .map_err(stopped)?;
                return Err(ToolReply::fault(error.note()));
            }
        };
        let content = output.text.replace('\r', "");
        let kept = zephium_core::work::agent::clip_text(&content, MAX_WORK_FILE_TEXT_BYTES);
        let truncated = kept.len() != content.len();
        let evidence = WorkCommandEvidenceV1 {
            cwd: self.root.to_string_lossy().into_owned(),
            command,
            exit: Some(output.exit),
            signal: None,
            elapsed_ms: started.elapsed().as_millis().min(u32::MAX as u128) as u32,
            bytes: content.len() as u32,
            digest: format!("{:x}", Sha256::digest(content.as_bytes())),
            truncated,
            text: kept.clone(),
        };
        let key = host
            .settle(
                step,
                if output.success {
                    WorkStepStatus::Succeeded
                } else {
                    WorkStepStatus::Failed
                },
                Settled::Command(Box::new(evidence)),
                Some("Working-tree content compared with current index".into()),
            )
            .await
            .map_err(stopped)?;
        let mut answer = format!("Working-tree content changes against current index for {} selected files ({operation}). Excludes staged-versus-HEAD, untracked files, modes and Git filter transformations.\n", paths.len());
        if kept.is_empty() {
            answer.push_str("No findings for these selected file contents.\n");
        } else {
            answer.push_str(&kept);
        }
        if truncated {
            answer.push_str("\nOutput truncated at the evidence limit.");
        }
        if let Some(key) = key {
            answer.push_str(&format!("\n(source {key})"));
        }
        Ok(ToolReply {
            content: answer,
            is_error: !output.success,
        })
    }
}
