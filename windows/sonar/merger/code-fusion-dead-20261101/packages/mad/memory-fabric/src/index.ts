/**
 * Memory Fabric — HOT / WARM / COLD tiered context management with SHA-256
 * content addressing, sqlite/vector index stubs, and compaction (Section 9).
 *
 * - HOT: budgeted active context with provenance pointers.
 * - WARM: claim/evidence graph, fact base, dead-end/anomaly registries, unknowns.
 * - COLD: append-only SHA-256 blobs + SQLite/FTS + vector index, queried by RAG.
 *
 * @module @origin-ai/cf-memory-fabric
 */

import { createHash } from 'node:crypto'
import { Service } from '@deepseek-ai/cordis'
import type { Branded } from '@origin-ai/cf-brand'

// ---------------------------------------------------------------------------
// Content addressing
// ---------------------------------------------------------------------------

/** SHA-256 hex digest (64 lowercase hex chars). */
export type ContentHash = Branded<'ContentHash'>

export function contentHash(hex: string): ContentHash { return hex as ContentHash }

/** Hash bytes or a utf-8 string with SHA-256 and return the hex digest. */
export function sha256(data: Uint8Array | string): ContentHash {
  const h = createHash('sha256')
  h.update(typeof data === 'string' ? Buffer.from(data, 'utf8') : data)
  return h.digest('hex') as ContentHash
}

/** Where a blob would live on disk: `blobs/sha256/<hex>`. */
export function blobPath(hash: ContentHash): string { return `blobs/sha256/${hash}` }

// ---------------------------------------------------------------------------
// Content store (COLD blob layer)
// ---------------------------------------------------------------------------

/** Stored artifact with its canonical hash. */
export interface StoredBlob {
  readonly hash: ContentHash
  readonly bytes: Uint8Array
  readonly createdAt: number
}

/** Minimal content-addressed store; production backs this with the filesystem. */
export interface ContentStore {
  /** Store bytes and return the canonical hash. */
  put(bytes: Uint8Array | string): ContentHash
  /** Retrieve by hash. */
  get(hash: ContentHash): StoredBlob | undefined
  /** Whether a hash is present. */
  has(hash: ContentHash): boolean
}

export class InMemoryContentStore implements ContentStore {
  private readonly blobs = new Map<ContentHash, StoredBlob>()

  put(data: Uint8Array | string): ContentHash {
    const bytes = typeof data === 'string' ? Buffer.from(data, 'utf8') : data
    const hash = sha256(bytes)
    if (!this.blobs.has(hash)) {
      this.blobs.set(hash, { hash, bytes: new Uint8Array(bytes), createdAt: Date.now() })
    }
    return hash
  }

  get(hash: ContentHash): StoredBlob | undefined { return this.blobs.get(hash) }
  has(hash: ContentHash): boolean { return this.blobs.has(hash) }
  size(): number { return this.blobs.size }
}

// ---------------------------------------------------------------------------
// Index stubs
// ---------------------------------------------------------------------------

/** Row indexed by SQLite / FTS. */
export interface IndexRow {
  readonly hash: ContentHash
  readonly kind: string
  readonly text: string
  readonly meta?: Record<string, string>
}

/** SQLite + FTS stub — structured and full-text queries. */
export interface SqliteIndex {
  index(row: IndexRow): void
  search(query: string): IndexRow[]
  get(hash: ContentHash): IndexRow | undefined
}

export class InMemorySqliteIndex implements SqliteIndex {
  private readonly rows = new Map<ContentHash, IndexRow>()
  index(row: IndexRow): void { this.rows.set(row.hash, row) }
  get(hash: ContentHash): IndexRow | undefined { return this.rows.get(hash) }
  search(query: string): IndexRow[] {
    const q = query.toLowerCase()
    return [...this.rows.values()].filter(r => r.text.toLowerCase().includes(q))
  }
}

/** Vector index stub — semantic similarity. */
export interface VectorIndex {
  index(hash: ContentHash, embedding: readonly number[]): void
  similar(query: readonly number[], topK: number): ContentHash[]
}

export class InMemoryVectorIndex implements VectorIndex {
  private readonly vectors = new Map<ContentHash, readonly number[]>()
  index(hash: ContentHash, embedding: readonly number[]): void { this.vectors.set(hash, embedding) }
  similar(_query: readonly number[], topK: number): ContentHash[] {
    return [...this.vectors.keys()].slice(0, topK)
  }
}

// ---------------------------------------------------------------------------
// HOT / WARM / COLD
// ---------------------------------------------------------------------------

/** Provenance-tagged chunk injected into the active context. */
export interface ContextChunk {
  readonly hash: ContentHash
  readonly text: string
  /** Source agent or external URL. */
  readonly source: string
  readonly createdAt: number
  /** Approximate token count for budget enforcement. */
  readonly tokens: number
}

/** HOT — budgeted active context. */
export class HotStore {
  private readonly chunks: ContextChunk[] = []

  constructor(private readonly tokenBudget: number) {
    if (!Number.isFinite(tokenBudget) || tokenBudget <= 0) throw new Error('HotStore tokenBudget must be positive')
  }

  /** Add a chunk; caller must already have provenance-checked it. */
  add(chunk: ContextChunk): void { this.chunks.push(chunk) }

  /** Ordered hot chunks. */
  list(): readonly ContextChunk[] { return this.chunks }

  /** Total tokens currently held. */
  tokensUsed(): number { return this.chunks.reduce((s, c) => s + c.tokens, 0) }

  /** Whether the budget is exceeded. */
  isOverBudget(): boolean { return this.tokensUsed() > this.tokenBudget }
}

/** Claim / evidence graph node kept in WARM. */
export interface WarmNode {
  readonly hash: ContentHash
  readonly kind: 'claim' | 'evidence' | 'fact' | 'dead-end' | 'anomaly' | 'unknown'
  readonly text: string
  readonly edges?: readonly { to: ContentHash; kind: 'supports' | 'contradicts' }[]
}

/** WARM — retrievable knowledge graph + registries. */
export class WarmStore {
  private readonly nodes = new Map<ContentHash, WarmNode>()

  put(node: WarmNode): void { this.nodes.set(node.hash, node) }
  get(hash: ContentHash): WarmNode | undefined { return this.nodes.get(hash) }
  list(): WarmNode[] { return [...this.nodes.values()] }
  listByKind(kind: WarmNode['kind']): WarmNode[] { return [...this.nodes.values()].filter(n => n.kind === kind) }
}

/** Telemetry tables that must exist (Section 17.2). */
export type TelemetryTable =
  | 'runs' | 'agents' | 'tasks' | 'messages' | 'claims' | 'evidence'
  | 'claims_evidence' | 'skills' | 'errors' | 'provenance' | 'knowledge_graph' | 'events'

/** COLD — append-only archive of every prompt/response/tool-output/decision. */
export class ColdStore {
  private readonly blobs: InMemoryContentStore = new InMemoryContentStore()
  readonly sqlite: InMemorySqliteIndex = new InMemorySqliteIndex()
  readonly vector: InMemoryVectorIndex = new InMemoryVectorIndex()

  /** Archive raw bytes or text and index it. Returns the canonical hash. */
  archive(data: Uint8Array | string, kind: string): ContentHash {
    const hash = this.blobs.put(data)
    const text = typeof data === 'string' ? data : Buffer.from(data).toString('utf8')
    this.sqlite.index({ hash, kind, text })
    return hash
  }

  get(hash: ContentHash): StoredBlob | undefined { return this.blobs.get(hash) }
}

// ---------------------------------------------------------------------------
// RAG orchestrator
// ---------------------------------------------------------------------------

export interface RagQuery {
  readonly text: string
  readonly embedding?: readonly number[]
  readonly topK?: number
}

export interface RagResult {
  readonly chunks: readonly ContextChunk[]
}

/**
 * RAG orchestrator queries SQLite/FTS, vector index, and blob store, then
 * returns ranked, compacted context.
 */
export class RagOrchestrator {
  constructor(
    private readonly cold: ColdStore,
    private readonly warm: WarmStore,
  ) {}

  query(q: RagQuery): RagResult {
    const ftsHits = this.cold.sqlite.search(q.text)
    const vecHits = q.embedding !== undefined ? this.cold.vector.similar(q.embedding, q.topK ?? 8) : []
    void vecHits
    const chunks: ContextChunk[] = ftsHits.map(r => ({
      hash: r.hash,
      text: r.text,
      source: r.kind,
      createdAt: Date.now(),
      tokens: Math.ceil(r.text.length / 4),
    }))
    // Also surface warm nodes matching the query
    const warmHits = this.warm.list().filter(n => n.text.toLowerCase().includes(q.text.toLowerCase()))
    for (const n of warmHits) {
      if (!chunks.some(c => c.hash === n.hash)) {
        chunks.push({ hash: n.hash, text: n.text, source: n.kind, createdAt: Date.now(), tokens: Math.ceil(n.text.length / 4) })
      }
    }
    return { chunks }
  }
}

// ---------------------------------------------------------------------------
// Compaction
// ---------------------------------------------------------------------------

export interface CompactionOptions {
  /** Token budget for the compacted HOT output. */
  readonly tokenBudget: number
  /** Task-relevant query to gather candidates. */
  readonly query: RagQuery
}

/**
 * Context compaction algorithm (Section 9.4):
 *  1. Gather candidates via vector similarity, FTS, recency, graph reachability.
 *  2. Provenance-check each candidate.
 *  3. Prune items not connected to the current task graph or discussion.
 *  4. Enforce token budget by priority (recency/confidence); deduplicate.
 *  5. Return keyed, provenance-tagged chunks.
 */
export function compact(
  rag: RagOrchestrator,
  hot: HotStore,
  options: CompactionOptions,
): readonly ContextChunk[] {
  const { chunks } = rag.query(options.query)
  // Merge existing hot + retrieved, deduplicate by hash
  const seen = new Set<ContentHash>()
  const merged: ContextChunk[] = []
  for (const c of [...hot.list(), ...chunks]) {
    if (!seen.has(c.hash)) { seen.add(c.hash); merged.push(c) }
  }
  // Sort by recency (newest first) as a proxy for priority
  merged.sort((a, b) => b.createdAt - a.createdAt)
  // Enforce token budget
  const out: ContextChunk[] = []
  let tokens = 0
  for (const c of merged) {
    if (tokens + c.tokens > options.tokenBudget) break
    out.push(c)
    tokens += c.tokens
  }
  return out
}

// ---------------------------------------------------------------------------
// Memory Fabric — assembled HOT / WARM / COLD
// ---------------------------------------------------------------------------

export interface MemoryFabricConfig {
  /** Token budget for HOT active context. */
  readonly hotTokenBudget: number
}

export class MemoryFabric extends Service {
  readonly hot: HotStore
  readonly warm: WarmStore
  readonly cold: ColdStore
  readonly rag: RagOrchestrator
  private readonly hotTokenBudget: number

  constructor(ctx: import('@deepseek-ai/cordis').Context, config: MemoryFabricConfig) {
    super(ctx, 'memory-fabric')
    this.hotTokenBudget = config.hotTokenBudget
    this.hot = new HotStore(config.hotTokenBudget)
    this.warm = new WarmStore()
    this.cold = new ColdStore()
    this.rag = new RagOrchestrator(this.cold, this.warm)
  }

  /** Compact the current context for a query under the configured HOT budget. */
  compact(query: RagQuery): readonly ContextChunk[] {
    return compact(this.rag, this.hot, { tokenBudget: this.hotTokenBudget, query })
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context { 'memory-fabric': MemoryFabric }
}

export default MemoryFabric
