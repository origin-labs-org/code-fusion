//! Optional pictures remain subordinate to their immutable successful extraction.
use super::{agent_work, Hub};
use rusqlite::{params, Connection, OptionalExtension};
use sha2::{Digest, Sha256};
use zephium_core::{
    ids::ProfileId,
    work::{media::*, port::WorkMediaContext, WorkError},
};

const MAX_PROFILE_RECORD_MEDIA: usize = 256;
const MAX_TOTAL_RECORD_MEDIA_BYTES: usize = 64 * 1024 * 1024;

impl Hub {
    pub(super) fn record_media(
        &mut self,
        profile: ProfileId,
        media: &WorkRecordMediaRefV1,
        png: Option<&[u8]>,
    ) -> Result<Option<WorkMediaContext>, WorkError> {
        media.validate()?;
        if media.profile != profile {
            return Err(WorkError::NotFound);
        }
        if self
            .work_profile_retired(profile)
            .map_err(|_| WorkError::Unavailable)?
        {
            return Err(WorkError::NotFound);
        }
        self.with_work_connection(|connection| {
            Ok(if let Some(png) = png {
                verify_source(connection, profile, media)?;
                put(connection, profile, media, png).map(|()| None)
            } else {
                read(connection, profile, media).map(|bytes| Some(WorkMediaContext(bytes)))
            })
        })
        .map_err(|_| WorkError::Unavailable)?
    }

    pub(super) fn remove_record_media(
        &mut self,
        profile: ProfileId,
        work: zephium_core::work::WorkId,
    ) {
        let _ = self.with_work_connection(|connection| {
            connection
                .execute(
                    "DELETE FROM work_record_media WHERE profile_id=?1 AND work_id=?2",
                    params![profile.to_string(), work.to_string()],
                )
                .map_err(|_| zephium_agentic::AgentWorkJournalError::Uncertain)?;
            Ok(())
        });
    }
}

fn verify_source(
    connection: &Connection,
    profile: ProfileId,
    media: &WorkRecordMediaRefV1,
) -> Result<(), zephium_agentic::AgentWorkJournalError> {
    use zephium_agentic::AgentWorkJournalError as Error;
    let key: Option<Vec<u8>> = connection.query_row(
        "SELECT CASE WHEN length(a.run_key)=32 THEN a.run_key END
         FROM agent_work_artifacts a JOIN agent_work_runs r ON r.run_key=a.run_key
         WHERE a.profile_id=?1 AND a.artifact_id=?2 AND r.terminal=1 AND substr(r.record,3,1)=X'00'",
        params![profile.to_string(), media.extraction.bytes().as_slice()], |row| row.get(0),
    ).optional().map_err(|_| Error::Uncertain)?;
    let archive = agent_work::read_artifact(
        connection,
        key.ok_or(Error::Transition)?
            .try_into()
            .map_err(|_| Error::Uncertain)?,
        profile,
    )?
    .ok_or(Error::Transition)?;
    let source = archive
        .record_media_source(media.record)
        .ok_or(Error::Transition)?;
    if hex(&source) != media.source {
        return Err(Error::Transition);
    }
    Ok(())
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn validate_png(media: &WorkRecordMediaRefV1, png: &[u8]) -> Result<(), WorkError> {
    media.validate()?;
    if png.is_empty() || png.len() > MAX_RECORD_MEDIA_BYTES {
        return Err(WorkError::Capacity);
    }
    if image::guess_format(png).ok() != Some(image::ImageFormat::Png)
        || hex(&Sha256::digest(png)) != media.digest
    {
        return Err(WorkError::Invalid);
    }
    let mut reader =
        image::ImageReader::with_format(std::io::Cursor::new(png), image::ImageFormat::Png);
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(u32::from(MAX_RECORD_MEDIA_WIDTH));
    limits.max_image_height = Some(u32::from(MAX_RECORD_MEDIA_HEIGHT));
    limits.max_alloc = Some(2 * 1024 * 1024);
    reader.limits(limits);
    let decoded = reader.decode().map_err(|_| WorkError::Invalid)?;
    if decoded.width() != u32::from(media.width) || decoded.height() != u32::from(media.height) {
        return Err(WorkError::Invalid);
    }
    Ok(())
}

/// Metadata and PNG bytes as stored.
type StoredMedia = (Vec<u8>, Vec<u8>);

fn stored(
    connection: &Connection,
    profile: ProfileId,
    media: &WorkRecordMediaRefV1,
) -> Result<Option<StoredMedia>, WorkError> {
    connection.query_row(
        "SELECT CASE WHEN length(metadata)<=2048 THEN metadata END,
                CASE WHEN length(png)<=65536 THEN png END
         FROM work_record_media WHERE profile_id=?1 AND attempt_id=?2 AND step_id=?3 AND record_index=?4",
        params![profile.to_string(),media.attempt.to_string(),media.step.to_string(),media.record],
        |row| Ok((row.get(0)?,row.get(1)?)),
    ).optional().map_err(|_| WorkError::Unavailable)
}

fn read(
    connection: &Connection,
    profile: ProfileId,
    media: &WorkRecordMediaRefV1,
) -> Result<Vec<u8>, WorkError> {
    if media.profile != profile {
        return Err(WorkError::NotFound);
    }
    let (metadata, png) = stored(connection, profile, media)?.ok_or(WorkError::NotFound)?;
    let record: WorkRecordMediaRefV1 =
        serde_json::from_slice(&metadata).map_err(|_| WorkError::Invalid)?;
    if record != *media {
        return Err(WorkError::NotFound);
    }
    validate_png(&record, &png)?;
    Ok(png)
}

fn put(
    connection: &mut Connection,
    profile: ProfileId,
    media: &WorkRecordMediaRefV1,
    png: &[u8],
) -> Result<(), WorkError> {
    if media.profile != profile {
        return Err(WorkError::NotFound);
    }
    validate_png(media, png)?;
    let metadata = serde_json::to_vec(media).map_err(|_| WorkError::Invalid)?;
    if metadata.len() > 2048 {
        return Err(WorkError::Capacity);
    }
    let tx = connection
        .transaction()
        .map_err(|_| WorkError::Unavailable)?;
    if let Some((existing, bytes)) = stored(&tx, profile, media)? {
        return if existing == metadata && bytes == png {
            Ok(())
        } else {
            Err(WorkError::Conflict)
        };
    }
    let (step_count,profile_count,total):(usize,usize,usize)=tx.query_row(
        "SELECT (SELECT count(*) FROM work_record_media WHERE profile_id=?1 AND attempt_id=?2 AND step_id=?3),
                (SELECT count(*) FROM work_record_media WHERE profile_id=?1),
                (SELECT coalesce(sum(length(png)),0) FROM work_record_media)",
        params![profile.to_string(),media.attempt.to_string(),media.step.to_string()],
        |row|Ok((row.get(0)?,row.get(1)?,row.get(2)?)),
    ).map_err(|_| WorkError::Unavailable)?;
    if step_count >= MAX_RECORD_MEDIA_PER_STEP
        || profile_count >= MAX_PROFILE_RECORD_MEDIA
        || total.saturating_add(png.len()) > MAX_TOTAL_RECORD_MEDIA_BYTES
    {
        return Err(WorkError::Capacity);
    }
    tx.execute("INSERT INTO work_record_media(profile_id,work_id,execution_id,attempt_id,step_id,record_index,extraction_id,metadata,png)
        VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)",params![profile.to_string(),media.work.to_string(),media.execution.to_string(),media.attempt.to_string(),media.step.to_string(),media.record,media.extraction.bytes().as_slice(),metadata,png]).map_err(|_|WorkError::Unavailable)?;
    tx.commit().map_err(|_| WorkError::OutcomeUnknown)
}

#[cfg(test)]
mod tests {
    use super::*;
    use zephium_core::work::*;

    fn fixture() -> (Connection, ProfileId, WorkRecordMediaRefV1, Vec<u8>) {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys=ON").unwrap();
        crate::migrations::apply(&mut conn, crate::migrations::WORK).unwrap();
        let profile = ProfileId::generate();
        let extraction = WorkArtifactId::generate();
        let mut run = [0_u8; 96];
        run[0] = 1;
        run[1] = zephium_agentic::AgentWorkDisposition::Succeeded as u8;
        run[15] = 3;
        run[16..32].copy_from_slice(&zephium_agentic::AgentWorkIncarnation::generate().bytes());
        run[47] = 1;
        run[63] = 1;
        let record = zephium_agentic::AgentWorkRecord::decode(run).unwrap();
        conn.execute("INSERT INTO agent_work_runs(run_key,record,terminal,result_profile,settled) VALUES (?1,?2,1,?3,1)",
            params![record.key().as_slice(),record.as_bytes().as_slice(),profile.to_string()]).unwrap();
        conn.execute("INSERT INTO agent_work_artifacts(run_key,profile_id,artifact_id,digest,body) VALUES (?1,?2,?3,?4,?5)",
            params![record.key().as_slice(),profile.to_string(),extraction.bytes().as_slice(),[0u8;32].as_slice(),b"invalid archive fixture".as_slice()]).unwrap();
        let mut png = std::io::Cursor::new(Vec::new());
        image::DynamicImage::new_rgba8(2, 3)
            .write_to(&mut png, image::ImageFormat::Png)
            .unwrap();
        let png = png.into_inner();
        let media = WorkRecordMediaRefV1 {
            profile,
            work: WorkId::generate(),
            execution: WorkExecutionId::generate(),
            attempt: WorkAttemptId::generate(),
            step: WorkStepId::generate(),
            extraction,
            record: 0,
            source: "11".repeat(32),
            digest: hex(&Sha256::digest(&png)),
            width: 2,
            height: 3,
            origin: WorkRecordMediaOriginV1::NativeCrop,
        };
        (conn, profile, media, png)
    }

    #[test]
    fn immutable_record_media_roundtrips_and_checks_all_custody() {
        let (mut conn, profile, media, png) = fixture();
        put(&mut conn, profile, &media, &png).unwrap();
        put(&mut conn, profile, &media, &png).unwrap();
        assert_eq!(read(&conn, profile, &media).unwrap(), png);
        assert_eq!(
            read(&conn, ProfileId::generate(), &media),
            Err(WorkError::NotFound)
        );
        for field in 0..11 {
            let mut changed = media.clone();
            match field {
                0 => changed.work = WorkId::generate(),
                1 => changed.execution = WorkExecutionId::generate(),
                2 => changed.attempt = WorkAttemptId::generate(),
                3 => changed.step = WorkStepId::generate(),
                4 => changed.extraction = WorkArtifactId::generate(),
                5 => changed.record += 1,
                6 => changed.source = "22".repeat(32),
                7 => changed.digest = "22".repeat(32),
                8 => changed.width += 1,
                9 => changed.profile = ProfileId::generate(),
                _ => changed.origin = WorkRecordMediaOriginV1::NativeFetch,
            }
            assert_eq!(read(&conn, profile, &changed), Err(WorkError::NotFound));
        }
        let mut changed = media.clone();
        changed.origin = WorkRecordMediaOriginV1::NativeFetch;
        assert_eq!(
            put(&mut conn, profile, &changed, &png),
            Err(WorkError::Conflict)
        );
        assert!(conn
            .execute("UPDATE work_record_media SET png=?1", [png.as_slice()])
            .is_err());
    }

    #[test]
    fn record_media_admission_rejects_corruption_and_source_forgery() {
        let (mut conn, profile, media, png) = fixture();
        assert!(
            verify_source(&conn, profile, &media).is_err(),
            "a row in the archive table alone is not valid extraction evidence"
        );
        assert_eq!(
            put(&mut conn, profile, &media, b"not a PNG"),
            Err(WorkError::Invalid)
        );
        let mut changed = media.clone();
        changed.width += 1;
        assert_eq!(
            put(&mut conn, profile, &changed, &png),
            Err(WorkError::Invalid)
        );
        changed = media.clone();
        changed.digest = "00".repeat(32);
        assert_eq!(
            put(&mut conn, profile, &changed, &png),
            Err(WorkError::Invalid)
        );
        assert_eq!(
            put(
                &mut conn,
                profile,
                &media,
                &vec![0; MAX_RECORD_MEDIA_BYTES + 1]
            ),
            Err(WorkError::Capacity)
        );
    }

    #[test]
    fn record_media_limits_and_archive_deletion_are_enforced_by_storage() {
        let (mut conn, profile, mut media, png) = fixture();
        for index in 0..MAX_RECORD_MEDIA_PER_STEP {
            media.record = index as u16;
            put(&mut conn, profile, &media, &png).unwrap();
        }
        media.record = MAX_RECORD_MEDIA_PER_STEP as u16;
        assert_eq!(
            put(&mut conn, profile, &media, &png),
            Err(WorkError::Capacity)
        );
        for index in MAX_RECORD_MEDIA_PER_STEP..MAX_PROFILE_RECORD_MEDIA {
            media.step = WorkStepId::generate();
            media.record = index as u16;
            put(&mut conn, profile, &media, &png).unwrap();
        }
        media.step = WorkStepId::generate();
        assert_eq!(
            put(&mut conn, profile, &media, &png),
            Err(WorkError::Capacity)
        );
        conn.execute(
            "DELETE FROM agent_work_artifacts WHERE artifact_id=?1",
            [media.extraction.bytes().as_slice()],
        )
        .unwrap();
        assert_eq!(
            conn.query_row("SELECT count(*) FROM work_record_media", [], |r| r
                .get::<_, usize>(0))
                .unwrap(),
            0
        );
    }
}
