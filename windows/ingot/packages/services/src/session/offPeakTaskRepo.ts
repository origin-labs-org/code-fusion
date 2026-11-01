import { z } from "zod";
import {
  isTasksStorageMigrated,
  isTasksStoragePrepared,
} from "#src/session/tasksDatabase/prepared.js";

import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import {
  OFF_PEAK_TERMINAL_STATUSES,
  modelSelectionSchema,
  resolveWorkspaceKey,
  type CfOffPeakTask,
  type CfOffPeakTaskCreateParams,
  type CfOffPeakTaskStatus,
  type CfTaskMode,
} from "@origin-ai/cf-shared";
import { getTasksIndexDatabasePath } from "#src/paths.js";
import { runTasksDatabaseMigrations } from "#src/session/tasksDatabase/migrations.js";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");
type DatabaseSyncInstance = InstanceType<typeof DatabaseSync>;

export const OFF_PEAK_CLAIM_STALE_MS = 10 * 60_000;

const TERMINAL_SQL_LIST = OFF_PEAK_TERMINAL_STATUSES.map((s) => `'${s}'`).join(", ");

interface OffPeakTaskRow {
  off_peak_task_id: string;
  server_ticket_id: string | null;
  title: string;
  conversation_id: string | null;
  session_id: string | null;
  
  session_title?: string | null;
  prompt: string;
  permission_mode: string;
  model: string | null;
  thought_level: string | null;
  model_selection: string | null;
  workspace_key: string;
  workspace_path: string;
  workspace_identity: string | null;
  project_id?: string | null;
  host_id?: string | null;
  additional_directories?: string | null;
  status: string;
  queued_at: number;
  started_at: number | null;
  ended_at: number | null;
  failure_reason: string | null;
  files_changed: number | null;
  settled_at: number | null;
  history_deleted_at: number | null;
  registered_at: number | null;
  schedulable: number;
  queue_position: number | null;
  next_poll_at: number | null;
  claim_running: number;
  claimed_at: number | null;
  attempt_count: number;
  last_error: string | null;
  created_at: number;
  updated_at: number;
}

function rowToTask(row: OffPeakTaskRow): CfOffPeakTask {
  const modelSelection = readOffPeakModelSelection(row);
  return {
    offPeakTaskId: row.off_peak_task_id,
    serverTicketId: row.server_ticket_id ?? undefined,
    title: row.title,
    conversationId: row.conversation_id ?? undefined,
    sessionId: row.session_id ?? undefined,
    ...(row.session_title ? { sessionTitle: row.session_title } : {}),
    prompt: row.prompt,
    permissionMode: row.permission_mode as CfTaskMode,
    ...(modelSelection ? { modelSelection } : {}),
    ...(!modelSelection
      ? {
          modelSelectionIssue: {
            code: "repair-required" as const,
          },
        }
      : {}),
    workspaceKey: row.workspace_key,
    workspacePath: row.workspace_path,
    workspaceIdentity: row.workspace_identity ?? undefined,
    ...(row.project_id == null ? {} : { projectId: row.project_id }),
    ...(row.host_id == null ? {} : { hostId: row.host_id }),
    ...(row.additional_directories == null
      ? {}
      : {
          additionalDirectories: z
            .array(z.string().min(1))
            .max(256)
            .parse(JSON.parse(row.additional_directories)),
        }),
    status: row.status as CfOffPeakTaskStatus,
    queuedAt: row.queued_at,
    startedAt: row.started_at ?? undefined,
    endedAt: row.ended_at ?? undefined,
    failureReason: row.failure_reason ?? undefined,
    filesChanged: row.files_changed ?? undefined,
    settledAt: row.settled_at ?? undefined,
    historyDeletedAt: row.history_deleted_at ?? undefined,
    registeredAt: row.registered_at ?? undefined,
    schedulable: row.schedulable === 1,
    queuePosition: row.queue_position ?? undefined,
    nextPollAt: row.next_poll_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function readOffPeakModelSelection(row: OffPeakTaskRow): CfOffPeakTask["modelSelection"] | null {
  if (row.model_selection) {
    try {
      const parsed = modelSelectionSchema.safeParse(JSON.parse(row.model_selection));
      if (parsed.success) return parsed.data;
    } catch {
    }
  }
  return null;
}

function serializeOffPeakModelSelection(
  selection: NonNullable<CfOffPeakTask["modelSelection"]>,
): string {
  const options = selection.options;
  return JSON.stringify(
    modelSelectionSchema.parse({
      providerId: selection.providerId,
      modelId: selection.modelId,
      ...(options && Object.keys(options).length > 0 ? { options } : {}),
    }),
  );
}

export function isOffPeakBoundSessionConflict(error: unknown): boolean {
  return (
    error instanceof Error &&
    /UNIQUE constraint failed: off_peak_tasks\.workspace_key, off_peak_tasks\.session_id/.test(
      error.message,
    )
  );
}

export class OffPeakTaskRepo {
  migrationBackupSkipped = false;
  private db: DatabaseSyncInstance | null = null;
  private dbPath: string | null = null;
  private initializePromise: Promise<void> | null = null;
  private readonly resolvedDbPath: string | null;

  constructor(
    dbPath?: string,
    private readonly startupBusyTimeoutMs = 5000,
  ) {
    this.resolvedDbPath = dbPath?.trim() || null;
  }

  private resolveDbPath(): string {
    return this.resolvedDbPath ?? getTasksIndexDatabasePath();
  }

  async ensureReady(): Promise<void> {
    const path = this.resolveDbPath();
    if (this.dbPath && this.dbPath !== path) {
      this.close();
    }
    if (!this.initializePromise) {
      this.initializePromise = this.initialize(path).catch((error) => {
        this.close();
        throw error;
      });
    }
    await this.initializePromise;
  }

  close(options?: { throwOnError?: boolean }): void {
    let closeError: unknown;
    try {
      this.db?.close();
    } catch (error) {
      closeError = error;
      // ignore
    }
    this.db = null;
    this.dbPath = null;
    this.initializePromise = null;
    if (options?.throwOnError && closeError) throw closeError;
  }

  private async initialize(path: string): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    if (!this.db) {
      this.db = new DatabaseSync(path);
      this.dbPath = path;
      this.db.exec(`PRAGMA busy_timeout = ${this.startupBusyTimeoutMs}`);
      this.db.exec("PRAGMA journal_mode = WAL");
      this.db.exec("PRAGMA synchronous = NORMAL");
    }
    if (isTasksStoragePrepared(path, this.db)) return;
    if (!isTasksStorageMigrated(path, this.db))
      this.migrationBackupSkipped = (await runTasksDatabaseMigrations(this.db, path)).backupSkipped;
    this.getDatabase()
      .prepare(
        `UPDATE off_peak_tasks
        SET status = 'running', updated_at = @now
        WHERE status = 'awaiting_approval'`,
      )
      .run({ now: Date.now() });
  }

  private getDatabase(): DatabaseSyncInstance {
    if (!this.db) {
      throw new Error("OffPeakTaskRepo 未初始化：请先 await ensureReady()");
    }
    return this.db;
  }

  private hasTasksIndexTable(): boolean {
    return Boolean(
      this.getDatabase()
        .prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'tasks'`)
        .get(),
    );
  }

  private getRow(offPeakTaskId: string): OffPeakTaskRow | null {
    const row = this.getDatabase()
      .prepare(`SELECT * FROM off_peak_tasks WHERE off_peak_task_id = ?`)
      .get(offPeakTaskId) as OffPeakTaskRow | undefined;
    return row ?? null;
  }

  
  async create(
    params: CfOffPeakTaskCreateParams,
    options?: {
      
      now?: number;
      
      offPeakTaskId?: string;
      serverTicketId?: string;
      queuePosition?: number;
      registeredAt?: number;
      
      schedulable?: boolean;
    },
  ): Promise<CfOffPeakTask> {
    await this.ensureReady();
    const now = options?.now ?? Date.now();
    const offPeakTaskId = options?.offPeakTaskId ?? `offpeak-${randomUUID()}`;
    const workspaceKey = resolveWorkspaceKey({
      workspacePath: params.workspacePath,
      workspaceIdentity: params.workspaceIdentity,
    });
    this.getDatabase()
      .prepare(
        `INSERT INTO off_peak_tasks (
          off_peak_task_id, server_ticket_id, title, conversation_id, session_id,
          prompt, permission_mode, model, thought_level, model_selection,
          workspace_key, workspace_path, workspace_identity, project_id, host_id, additional_directories,
          status, queued_at, registered_at, schedulable, queue_position,
          claim_running, attempt_count, created_at, updated_at
        ) VALUES (
          @off_peak_task_id, @server_ticket_id, @title, NULL, @session_id,
          @prompt, @permission_mode, @model, @thought_level, @model_selection,
          @workspace_key, @workspace_path, @workspace_identity, @project_id, @host_id, @additional_directories,
          'queued', @queued_at, @registered_at, @schedulable, @queue_position,
          0, 0, @now, @now
        )`,
      )
      .run({
        off_peak_task_id: offPeakTaskId,
        server_ticket_id: options?.serverTicketId ?? null,
        title: params.title,
        session_id: params.boundSessionId ?? null,
        prompt: params.prompt,
        permission_mode: params.permissionMode,
        model: null,
        thought_level: null,
        model_selection: serializeOffPeakModelSelection(params.modelSelection),
        workspace_key: workspaceKey,
        workspace_path: params.workspacePath,
        workspace_identity: params.workspaceIdentity ?? null,
        project_id: params.projectId ?? null,
        host_id: params.hostId ?? null,
        additional_directories:
          params.additionalDirectories === undefined
            ? null
            : JSON.stringify(
                z.array(z.string().min(1)).max(256).parse(params.additionalDirectories),
              ),
        queued_at: now,
        registered_at: options?.registeredAt ?? null,
        schedulable: options?.schedulable ? 1 : 0,
        queue_position: options?.queuePosition ?? null,
        now,
      });
    return rowToTask(this.getRow(offPeakTaskId)!);
  }

  async list(scope?: {
    workspacePath?: string;
    workspaceIdentity?: string;
  }): Promise<CfOffPeakTask[]> {
    await this.ensureReady();
    const workspaceKey = scope?.workspacePath
      ? resolveWorkspaceKey({
          workspacePath: scope.workspacePath,
          workspaceIdentity: scope.workspaceIdentity,
        })
      : null;
    const withSessionTitle = this.hasTasksIndexTable();
    const rows = this.getDatabase()
      .prepare(
        withSessionTitle
          ? `SELECT t.*, s.title AS session_title FROM off_peak_tasks t
            LEFT JOIN tasks s ON s.workspace_key = t.workspace_key AND s.task_id = t.session_id
            WHERE (@workspace_key IS NULL OR t.workspace_key = @workspace_key)
            ORDER BY t.created_at DESC`
          : `SELECT * FROM off_peak_tasks
            WHERE (@workspace_key IS NULL OR workspace_key = @workspace_key)
            ORDER BY created_at DESC`,
      )
      .all({ workspace_key: workspaceKey }) as unknown as OffPeakTaskRow[];
    return rows.map(rowToTask);
  }

  async get(offPeakTaskId: string): Promise<CfOffPeakTask | null> {
    await this.ensureReady();
    const row = this.getRow(offPeakTaskId);
    return row ? rowToTask(row) : null;
  }

  
  async invalidateModelSelection(
    offPeakTaskId: string,
    modelSelection: NonNullable<CfOffPeakTask["modelSelection"]>,
    options?: { now?: number },
  ): Promise<CfOffPeakTask | null> {
    await this.ensureReady();
    const db = this.getDatabase();
    db.exec("BEGIN IMMEDIATE");
    try {
      const current = this.getRow(offPeakTaskId);
      if (!current) {
        db.exec("COMMIT");
        return null;
      }
      const currentSelection = readOffPeakModelSelection(current);
      if (
        currentSelection &&
        (currentSelection.providerId !== modelSelection.providerId ||
          currentSelection.modelId !== modelSelection.modelId ||
          currentSelection.options?.reasoningLevel !== modelSelection.options?.reasoningLevel)
      ) {
        db.exec("COMMIT");
        return rowToTask(current);
      }
      db.prepare(
        `UPDATE off_peak_tasks
         SET model = @model, thought_level = @thought_level,
             model_selection = NULL, schedulable = 0, updated_at = @now
         WHERE off_peak_task_id = @id`,
      ).run({
        id: offPeakTaskId,
        model: modelSelection.modelId,
        thought_level: modelSelection.options?.reasoningLevel ?? null,
        now: options?.now ?? Date.now(),
      });
      const invalidated = this.getRow(offPeakTaskId);
      db.exec("COMMIT");
      return invalidated ? rowToTask(invalidated) : null;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  
  async delete(offPeakTaskId: string): Promise<void> {
    await this.ensureReady();
    this.getDatabase()
      .prepare(`DELETE FROM off_peak_tasks WHERE off_peak_task_id = ?`)
      .run(offPeakTaskId);
  }

  
  async markHistoryDeleted(
    offPeakTaskId: string,
    options?: { now?: number },
  ): Promise<CfOffPeakTask | null> {
    await this.ensureReady();
    const row = this.getRow(offPeakTaskId);
    if (!row || row.started_at === null) return row ? rowToTask(row) : null;
    if (row.history_deleted_at !== null) return rowToTask(row);
    const now = options?.now ?? Date.now();
    this.getDatabase()
      .prepare(
        `UPDATE off_peak_tasks
        SET history_deleted_at = @now, updated_at = @now
        WHERE off_peak_task_id = @id AND started_at IS NOT NULL`,
      )
      .run({ id: offPeakTaskId, now });
    return rowToTask(this.getRow(offPeakTaskId)!);
  }

  
  async countNonTerminal(): Promise<number> {
    await this.ensureReady();
    const row = this.getDatabase()
      .prepare(
        `SELECT COUNT(*) AS n FROM off_peak_tasks WHERE status NOT IN (${TERMINAL_SQL_LIST})`,
      )
      .get() as { n: number };
    return row.n;
  }

  
  async hasActiveBoundTask(workspaceKey: string, sessionId: string): Promise<boolean> {
    await this.ensureReady();
    const row = this.getDatabase()
      .prepare(
        `SELECT 1 AS hit FROM off_peak_tasks
         WHERE workspace_key = @workspace_key AND session_id = @session_id
           AND status NOT IN (${TERMINAL_SQL_LIST})
         LIMIT 1`,
      )
      .get({ workspace_key: workspaceKey, session_id: sessionId }) as { hit: number } | undefined;
    return row !== undefined;
  }

  
  async countActive(): Promise<number> {
    await this.ensureReady();
    const row = this.getDatabase()
      .prepare(`SELECT COUNT(*) AS n FROM off_peak_tasks WHERE status = 'running'`)
      .get() as { n: number };
    return row.n;
  }

  
  async updateEditableFields(
    offPeakTaskId: string,
    params: {
      title?: string;
      prompt?: string;
      permissionMode?: string;
      modelSelection?: CfOffPeakTask["modelSelection"] | null;
    },
    options?: { now?: number },
  ): Promise<CfOffPeakTask | null> {
    await this.ensureReady();
    const row = this.getRow(offPeakTaskId);
    if (!row) return null;
    if (row.status !== "queued" && row.status !== "paused") return null;
    if (params.modelSelection === null) return null;
    const nextModelSelection = params.modelSelection ?? readOffPeakModelSelection(row);
    if (!nextModelSelection) {
      throw new Error(`Off-Peak task Missing有效 ModelSelection: ${offPeakTaskId}`);
    }
    this.getDatabase()
      .prepare(
        `UPDATE off_peak_tasks SET
          title = @title, prompt = @prompt, permission_mode = @permission_mode,
          model_selection = @model_selection, updated_at = @now
        WHERE off_peak_task_id = @id`,
      )
      .run({
        id: offPeakTaskId,
        title: params.title ?? row.title,
        prompt: params.prompt ?? row.prompt,
        permission_mode: params.permissionMode ?? row.permission_mode,
        model_selection: serializeOffPeakModelSelection(nextModelSelection),
        now: options?.now ?? Date.now(),
      });
    return rowToTask(this.getRow(offPeakTaskId)!);
  }

  
  async updateSchedulingSnapshot(
    offPeakTaskId: string,
    patch: {
      schedulable?: boolean;
      queuePosition?: number | null;
      nextPollAt?: number | null;
      serverTicketId?: string;
      registeredAt?: number;
      now?: number;
    },
  ): Promise<void> {
    await this.ensureReady();
    const row = this.getRow(offPeakTaskId);
    if (!row) return;
    this.getDatabase()
      .prepare(
        `UPDATE off_peak_tasks SET
          schedulable = @schedulable,
          queue_position = @queue_position,
          next_poll_at = @next_poll_at,
          server_ticket_id = @server_ticket_id,
          registered_at = @registered_at,
          updated_at = @now
        WHERE off_peak_task_id = @id`,
      )
      .run({
        id: offPeakTaskId,
        schedulable: patch.schedulable === undefined ? row.schedulable : patch.schedulable ? 1 : 0,
        queue_position:
          patch.queuePosition === undefined ? row.queue_position : patch.queuePosition,
        next_poll_at: patch.nextPollAt === undefined ? row.next_poll_at : patch.nextPollAt,
        server_ticket_id: patch.serverTicketId ?? row.server_ticket_id,
        registered_at: patch.registeredAt ?? row.registered_at,
        now: patch.now ?? Date.now(),
      });
  }

  
  async claimDue(now: number): Promise<CfOffPeakTask[]> {
    await this.ensureReady();
    const db = this.getDatabase();
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare(
        `UPDATE off_peak_tasks
        SET claim_running = 0, claimed_at = NULL
        WHERE claim_running = 1 AND claimed_at IS NOT NULL AND claimed_at <= @stale`,
      ).run({ stale: now - OFF_PEAK_CLAIM_STALE_MS });
      const dueRows = db
        .prepare(
          `SELECT * FROM off_peak_tasks
          WHERE status = 'queued' AND schedulable = 1 AND claim_running = 0
          ORDER BY queued_at ASC, created_at ASC`,
        )
        .all() as unknown as OffPeakTaskRow[];
      const claimed: CfOffPeakTask[] = [];
      const claim = db.prepare(
        `UPDATE off_peak_tasks
        SET claim_running = 1, claimed_at = @now, updated_at = @now
        WHERE off_peak_task_id = @id AND claim_running = 0`,
      );
      for (const row of dueRows) {
        if (!readOffPeakModelSelection(row)) continue;
        const res = claim.run({ id: row.off_peak_task_id, now });
        if (res.changes === 1) {
          claimed.push(rowToTask({ ...row, claim_running: 1, claimed_at: now }));
        }
      }
      db.exec("COMMIT");
      return claimed;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  
  async markRunning(
    offPeakTaskId: string,
    options: {
      startedAt: number;
      conversationId?: string;
      sessionId?: string;
      serverTicketId?: string;
    },
  ): Promise<CfOffPeakTask | null> {
    await this.ensureReady();
    const res = this.getDatabase()
      .prepare(
        `UPDATE off_peak_tasks
        SET status = 'running',
            started_at = COALESCE(started_at, @started_at),
            conversation_id = COALESCE(@conversation_id, conversation_id),
            session_id = COALESCE(@session_id, session_id),
            server_ticket_id = COALESCE(@server_ticket_id, server_ticket_id),
            claim_running = 0, claimed_at = NULL,
            last_error = NULL,
            updated_at = @started_at
        WHERE off_peak_task_id = @id AND status = 'queued'`,
      )
      .run({
        id: offPeakTaskId,
        started_at: options.startedAt,
        conversation_id: options.conversationId ?? null,
        session_id: options.sessionId ?? null,
        server_ticket_id: options.serverTicketId ?? null,
      });
    if (res.changes !== 1) return null;
    return rowToTask(this.getRow(offPeakTaskId)!);
  }

  
  async markTerminal(
    offPeakTaskId: string,
    options: {
      status: "completed" | "failed" | "cancelled";
      endedAt: number;
      failureReason?: string;
      filesChanged?: number;
      
      dispatchError?: string;
    },
  ): Promise<CfOffPeakTask | null> {
    await this.ensureReady();
    const res = this.getDatabase()
      .prepare(
        `UPDATE off_peak_tasks
        SET status = @status,
            ended_at = @ended_at,
            failure_reason = @failure_reason,
            files_changed = COALESCE(@files_changed, files_changed),
            attempt_count = attempt_count + @dispatch_attempt_inc,
            last_error = COALESCE(@dispatch_error, last_error),
            schedulable = 0,
            claim_running = 0, claimed_at = NULL,
            updated_at = @ended_at
        WHERE off_peak_task_id = @id AND status NOT IN (${TERMINAL_SQL_LIST})`,
      )
      .run({
        id: offPeakTaskId,
        status: options.status,
        ended_at: options.endedAt,
        failure_reason: options.failureReason ?? null,
        files_changed: options.filesChanged ?? null,
        dispatch_attempt_inc: options.dispatchError ? 1 : 0,
        dispatch_error: options.dispatchError ?? null,
      });
    if (res.changes !== 1) return null;
    return rowToTask(this.getRow(offPeakTaskId)!);
  }

  
  async setPaused(
    offPeakTaskId: string,
    paused: boolean,
    options?: { now?: number },
  ): Promise<CfOffPeakTask | null> {
    await this.ensureReady();
    const res = this.getDatabase()
      .prepare(
        `UPDATE off_peak_tasks
        SET status = @to, updated_at = @now
        WHERE off_peak_task_id = @id AND status = @from AND claim_running = 0`,
      )
      .run({
        id: offPeakTaskId,
        to: paused ? "paused" : "queued",
        from: paused ? "queued" : "paused",
        now: options?.now ?? Date.now(),
      });
    if (res.changes !== 1) return null;
    return rowToTask(this.getRow(offPeakTaskId)!);
  }

  
  async releaseClaim(
    offPeakTaskId: string,
    options?: { error?: string; now?: number },
  ): Promise<void> {
    await this.ensureReady();
    this.getDatabase()
      .prepare(
        `UPDATE off_peak_tasks
        SET claim_running = 0, claimed_at = NULL,
            attempt_count = attempt_count + @attempt_inc,
            last_error = COALESCE(@error, last_error),
            updated_at = @now
        WHERE off_peak_task_id = @id AND claim_running = 1`,
      )
      .run({
        id: offPeakTaskId,
        attempt_inc: options?.error ? 1 : 0,
        error: options?.error ?? null,
        now: options?.now ?? Date.now(),
      });
  }

  
  async recoverInterrupted(now: number): Promise<number> {
    await this.ensureReady();
    const db = this.getDatabase();
    db.exec("BEGIN IMMEDIATE");
    try {
      const recovered = db
        .prepare(
          `UPDATE off_peak_tasks
          SET status = 'queued', claim_running = 0, claimed_at = NULL, updated_at = @now
          WHERE status = 'running'`,
        )
        .run({ now });
      db.prepare(
        `UPDATE off_peak_tasks
        SET claim_running = 0, claimed_at = NULL, updated_at = @now
        WHERE claim_running = 1 AND claimed_at IS NOT NULL AND claimed_at <= @stale`,
      ).run({ now, stale: now - OFF_PEAK_CLAIM_STALE_MS });
      db.exec("COMMIT");
      return Number(recovered.changes ?? 0);
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  
  async requeueForContinuation(
    offPeakTaskId: string,
    options?: { now?: number },
  ): Promise<CfOffPeakTask | null> {
    await this.ensureReady();
    const res = this.getDatabase()
      .prepare(
        `UPDATE off_peak_tasks
        SET status = 'queued', schedulable = 0, queue_position = NULL,
            claim_running = 0, claimed_at = NULL, updated_at = @now
        WHERE off_peak_task_id = @id AND status = 'running'`,
      )
      .run({ id: offPeakTaskId, now: options?.now ?? Date.now() });
    if (res.changes !== 1) return null;
    return rowToTask(this.getRow(offPeakTaskId)!);
  }

  
  async listNonTerminal(): Promise<CfOffPeakTask[]> {
    await this.ensureReady();
    const rows = this.getDatabase()
      .prepare(
        `SELECT * FROM off_peak_tasks
        WHERE status NOT IN (${TERMINAL_SQL_LIST})
        ORDER BY queued_at ASC`,
      )
      .all() as unknown as OffPeakTaskRow[];
    return rows.map(rowToTask);
  }

  
  async markSettled(offPeakTaskId: string, settledAt: number): Promise<void> {
    await this.ensureReady();
    this.getDatabase()
      .prepare(
        `UPDATE off_peak_tasks
        SET settled_at = @settled_at, updated_at = @settled_at
        WHERE off_peak_task_id = @id AND status IN (${TERMINAL_SQL_LIST})`,
      )
      .run({ id: offPeakTaskId, settled_at: settledAt });
  }

  
  async listUnsettledTerminal(): Promise<CfOffPeakTask[]> {
    await this.ensureReady();
    const rows = this.getDatabase()
      .prepare(
        `SELECT * FROM off_peak_tasks
        WHERE status IN (${TERMINAL_SQL_LIST}) AND settled_at IS NULL
        ORDER BY ended_at ASC`,
      )
      .all() as unknown as OffPeakTaskRow[];
    return rows.map(rowToTask);
  }
}
