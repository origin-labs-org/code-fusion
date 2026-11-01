//! One named, qualified test class; never a generic command string.
use super::*;
use crate::work_commands::runner::{python, Failure};
use sha2::{Digest, Sha256};
impl ComputerTools {
    pub(super) async fn python_tests(
        &self,
        host: &dyn ComputerHost,
        args: &Value,
    ) -> Result<ToolReply, ToolReply> {
        let strings = |key: &str, required: bool| -> Result<Vec<String>, ToolReply> {
            let Some(value) = args.get(key) else {
                return if required {
                    Err(ToolReply::fault("tests is required"))
                } else {
                    Ok(Vec::new())
                };
            };
            let values = value
                .as_array()
                .filter(|values| values.len() <= 2_000)
                .ok_or_else(|| {
                    ToolReply::fault("tests and files must be bounded arrays of relative paths")
                })?;
            values
                .iter()
                .map(|value| {
                    value
                        .as_str()
                        .filter(|value| value.len() <= 1024)
                        .map(str::to_owned)
                        .ok_or_else(|| {
                            ToolReply::fault("Each file must be a bounded relative path")
                        })
                })
                .collect()
        };
        let request =
            python::UnittestRequest::new(&strings("tests", true)?, &strings("files", false)?)
                .map_err(|error| ToolReply::fault(error.note()))?;
        python::ensure_available().map_err(|error| ToolReply::fault(error.note()))?;
        let root = self
            .files
            .roots()
            .iter()
            .filter(|root| self.root.starts_with(root))
            .max_by_key(|root| root.components().count())
            .ok_or_else(|| ToolReply::fault("The folder is not granted"))?;
        let command = "python_tests (selected stdlib unittest in a read-only copy)".to_owned();
        let step = host
            .begin(
                WorkStepKindV1::RunCommand {
                    cwd: self.root.to_string_lossy().into_owned(),
                    command: command.clone(),
                    timeout_secs: Some(40),
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
        let output = match python::run(&self.files, &self.root, &request, || host.cancelled()).await
        {
            Ok(output) => output,
            Err(error) => {
                host.settle(
                    step,
                    if error == Failure::Stopped {
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
        let summary = shell::unittest(&content);
        let success = output.success && summary.as_ref().is_some_and(|summary| summary.failed == 0);
        let kept = zephium_core::work::agent::clip_text(&content, MAX_WORK_FILE_TEXT_BYTES);
        let evidence = WorkCommandEvidenceV1 {
            cwd: self.root.to_string_lossy().into_owned(),
            command,
            exit: Some(output.exit),
            signal: None,
            elapsed_ms: started.elapsed().as_millis().min(u32::MAX as u128) as u32,
            bytes: content.len() as u32,
            digest: format!("{:x}", Sha256::digest(content.as_bytes())),
            truncated: kept.len() != content.len(),
            text: kept,
        };
        let note = match &summary {
            Some(summary) => format!(
                "Python unittest: {}{}",
                summary.line(),
                if output.success {
                    ""
                } else {
                    "; process did not succeed"
                }
            ),
            None => "Python did not produce a completed unittest summary".into(),
        };
        let key = host
            .settle(
                step,
                if success {
                    WorkStepStatus::Succeeded
                } else {
                    WorkStepStatus::Failed
                },
                Settled::Command(Box::new(evidence)),
                Some(note.clone()),
            )
            .await
            .map_err(stopped)?;
        let mut answer=format!("{note}. Ran against {} selected test modules and the supplied supporting text files in a read-only copy.\n{}",request.count(),shell::excerpt(&content));
        if let Some(key) = key {
            answer.push_str(&format!("\n(source {key})"));
        }
        Ok(ToolReply {
            content: answer,
            is_error: !success,
        })
    }
}
