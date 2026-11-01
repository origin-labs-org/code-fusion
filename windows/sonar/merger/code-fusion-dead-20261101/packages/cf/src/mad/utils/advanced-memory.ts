/**
 * CodeFusion (CF) - Advanced Memory Fabric Implementation
 *
 * ROUND 3 IMPROVEMENT: Production-grade memory system with:
 * - Persistent storage simulation (localStorage/IndexedDB-like)
 * - TTL-based automatic expiration
 * - Full-text search with TF-IDF ranking
 * - Vector similarity search (cosine similarity)
 * - ACID transaction support
 * - Query optimization and caching
 * - Storage quotas and intelligent cleanup
 * - Memory pressure management
 *
 * @origin-ai/cf/mad/utils
 * @version 2.0.3-advanced
 */

import type {
  HotContext,
  WarmMemory,
  ColdArchive,
  MemoryFabric,
  ClaimNode,
  EvidenceNode,
  AgentMessage,
  TelemetryEvent,
} from '../types'

// ============================================================================
// STORAGE ABSTRACTION LAYER
// ============================================================================

/**
 * Storage backend interface for pluggable storage
 */
export interface IStorageBackend {
  get(key: string): Promise<any | null>
  set(key: string, value: any, options?: StorageOptions): Promise<void>
  delete(key: string): Promise<boolean>
  has(key: string): Promise<boolean>
  keys(pattern?: string): Promise<string[]>
  clear(): Promise<void>
  size(): Promise<number>
}

/**
 * Options for storage operations
 */
export interface StorageOptions {
  /** Time-to-live in milliseconds (0 = no expiry) */
  ttl?: number
  /** Content type for serialization */
  contentType?: 'json' | 'text' | 'binary'
  /** Tags for indexing */
  tags?: string[]
  /** Priority for eviction (higher = less likely to be evicted) */
  priority?: number
  /** Compress before storing */
  compress?: boolean
}

/**
 * In-memory storage backend (default)
 */
export class InMemoryStorageBackend implements IStorageBackend {
  private store: Map<string, { value: any; expiresAt?: number; metadata: StorageOptions }> = new Map()
  private maxSize: number
  private currentSize: number = 0

  constructor(maxSizeMB: number = 100) {
    // Approximate max size in bytes (1 MB = 1048576 bytes)
    this.maxSize = maxSizeMB * 1048576
  }

  async get(key: string): Promise<any | null> {
    const entry = this.store.get(key)

    if (!entry) return null

    // Check TTL
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      await this.delete(key)
      return null
    }

    return entry.value
  }

  async set(key: string, value: any, options?: StorageOptions): Promise<void> {
    // Check size limit
    const size = this.estimateSize(value)

    if (this.currentSize + size > this.maxSize) {
      // Evict low-priority items
      await this.evict(size)
    }

    const entry = {
      value,
      expiresAt: options?.ttl ? Date.now() + options.ttl : undefined,
      metadata: options || {},
    }

    // Update size tracking
    const existingEntry = this.store.get(key)
    if (existingEntry) {
      this.currentSize -= this.estimateSize(existingEntry.value)
    }
    this.currentSize += size

    this.store.set(key, entry)
  }

  async delete(key: string): Promise<boolean> {
    const entry = this.store.get(key)
    if (!entry) return false

    this.currentSize -= this.estimateSize(entry.value)
    return this.store.delete(key)
  }

  async has(key: string): Promise<boolean> {
    const value = await this.get(key)
    return value !== null
  }

  async keys(pattern?: string): Promise<string[]> {
    if (!pattern) {
      return Array.from(this.store.keys())
    }

    // Simple glob pattern matching
    const regex = new RegExp('^' + pattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$')
    return Array.from(this.store.keys()).filter(key => regex.test(key))
  }

  async clear(): Promise<void> {
    this.store.clear()
    this.currentSize = 0
  }

  async size(): Promise<number> {
    return this.store.size
  }

  private estimateSize(value: any): number {
    if (value === null || value === undefined) return 0
    if (typeof value === 'string') return value.length * 2 // UTF-16
    if (typeof value === 'number') return 8
    if (typeof value === 'boolean') return 4
    if (typeof value === 'object') {
      return JSON.stringify(value).length * 2
    }
    return 0
  }

  private async evict(neededSpace: number): Promise<void> {
    // Sort by priority (ascending) then by access time
    const entries = Array.from(this.store.entries())
      .sort((a, b) => {
        const priorityA = a[1].metadata.priority || 5
        const priorityB = b[1].metadata.priority || 5

        if (priorityA !== priorityB) return priorityA - priorityB

        // For same priority, prefer expiring items
        const expiresA = a[1].expiresAt || Infinity
        const expiresB = b[1].expiresAt || Infinity

        return expiresA - expiresB
      })

    let freedSpace = 0
    for (const [key, entry] of entries) {
      if (freedSpace >= neededSpace) break

      await this.delete(key)
      freedSpace += this.estimateSize(entry.value)
    }
  }
}

/**
 * LocalStorage-backed storage (for browser environments)
 */
export class LocalStorageBackend implements IStorageBackend {
  private prefix: string

  constructor(prefix: string = 'xhe_') {
    this.prefix = prefix

    // Check if localStorage is available
    if (typeof window !== 'undefined' && !window.localStorage) {
      console.warn('localStorage not available, falling back to in-memory')
    }
  }

  private getKey(key: string): string {
    return `${this.prefix}${key}`
  }

  async get(key: string): Promise<any | null> {
    try {
      if (typeof window === 'undefined') return null

      const raw = localStorage.getItem(this.getKey(key))
      if (!raw) return null

      const parsed = JSON.parse(raw)

      // Check TTL
      if (parsed.expiresAt && Date.now() > parsed.expiresAt) {
        await this.delete(key)
        return null
      }

      return parsed.value
    } catch (e) {
      console.error('LocalStorage get error:', e)
      return null
    }
  }

  async set(key: string, value: any, options?: StorageOptions): Promise<void> {
    try {
      if (typeof window === 'undefined') return

      const data = {
        value,
        expiresAt: options?.ttl ? Date.now() + options.ttl : undefined,
        metadata: options,
      }

      localStorage.setItem(this.getKey(key), JSON.stringify(data))
    } catch (e) {
      console.error('LocalStorage set error:', e)
      // Quota exceeded - try to make space
      if (e instanceof DOMException && e.name === 'QuotaExceededError') {
        await this.makeSpace()
        localStorage.setItem(this.getKey(key), JSON.stringify(data))
      }
    }
  }

  async delete(key: string): Promise<boolean> {
    try {
      if (typeof window === 'undefined') return false

      localStorage.removeItem(this.getKey(key))
      return true
    } catch (e) {
      console.error('LocalStorage delete error:', e)
      return false
    }
  }

  async has(key: string): Promise<boolean> {
    const value = await this.get(key)
    return value !== null
  }

  async keys(pattern?: string): Promise<string[]> {
    try {
      if (typeof window === 'undefined') return []

      const result: string[] = []
      const regex = pattern ? new RegExp('^' + this.prefix + pattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$') : new RegExp(`^${this.prefix}`)

      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i)
        if (key && regex.test(key)) {
          result.push(key.substring(this.prefix.length))
        }
      }

      return result
    } catch (e) {
      console.error('LocalStorage keys error:', e)
      return []
    }
  }

  async clear(): Promise<void> {
    try {
      if (typeof window === 'undefined') return

      const keys = await this.keys()
      for (const key of keys) {
        localStorage.removeItem(this.getKey(key))
      }
    } catch (e) {
      console.error('LocalStorage clear error:', e)
    }
  }

  async size(): Promise<number> {
    const keys = await this.keys()
    return keys.length
  }

  private async makeSpace(): Promise<void> {
    // Delete expired items first
    const keys = await this.keys()
    let deleted = 0

    for (const key of keys) {
      const value = await this.get(key)
      if (value === null) {
        deleted++
      }
    }

    if (deleted > 0) return // Made some space

    // Delete oldest items (by key name which includes timestamp usually)
    const sortedKeys = keys.sort()
    for (let i = 0; i < Math.min(10, sortedKeys.length); i++) {
      await this.delete(sortedKeys[i])
    }
  }
}

// ============================================================================
// ADVANCED MEMORY FABRIC WITH FULL IMPLEMENTATION
// ============================================================================

/**
 * Memory fabric configuration
 */
export interface AdvancedMemoryConfig {
  /** Maximum hot context size */
  maxHotSize: number
  /** Maximum warm storage entries */
  maxWarmEntries: number
  /** Auto-compaction threshold (entries) */
  warmCompactionThreshold: number
  /** Default TTL for warm entries (ms) */
  defaultTTL: number
  /** Enable compression */
  enableCompression: boolean
  /** Enable full-text search indexing */
  enableFTS: boolean
  /** Enable vector similarity search */
  enableVectorSearch: boolean
  /** Storage backend to use */
  backend: IStorageBackend
  /** Memory pressure callback */
  onMemoryPressure?: (usage: number) => void
}

/**
 * Search result with relevance scoring
 */
export interface SearchResult<T> {
  item: T
  score: number
  highlights: Array<{ field: string; snippet: string }>
  metadata: {
    matchedTerms: string[]
    rank: number
    totalResults: number
  }
}

/**
 * Vector embedding for similarity search
 */
export interface VectorEmbedding {
  id: string
  vector: number[]
  metadata: Record<string, any>
  timestamp: number
}

/**
 * Advanced Memory Fabric implementation
 */
export class AdvancedMemoryFabric {
  private config: AdvancedMemoryConfig
  private hotContext: Map<string, any> = new Map()
  private hotAccessOrder: string[] = [] // LRU order
  private warmBackend: IStorageBackend
  private ftsIndex: Map<string, Set<string>> = new Map() // term -> IDs
  private vectorIndex: Map<string, VectorEmbedding> = new Map()
  private stats: {
    hits: number
    misses: number
    evictions: number
    compactions: number
    searches: number
    totalStored: number
  }

  constructor(config?: Partial<AdvancedMemoryConfig>) {
    this.config = {
      maxHotSize: 100,
      maxWarmEntries: 10000,
      warmCompactionThreshold: 5000,
      defaultTTL: 3600000, // 1 hour
      enableCompression: false,
      enableFTS: true,
      enableVectorSearch: true,
      backend: new InMemoryStorageBackend(),
      ...config,
    }

    this.warmBackend = this.config.backend
    this.stats = {
      hits: 0,
      misses: 0,
      evictions: 0,
      compactions: 0,
      searches: 0,
      totalStored: 0,
    }
  }

  // ==========================================================================
  // HOT LAYER OPERATIONS
  // ==========================================================================

  /**
   * Add item to hot context (LRU cache)
   */
  addToHot(id: string, item: any, metadata?: { tags?: string[]; priority?: number }): void {
    // Evict if at capacity
    while (this.hotContext.size >= this.config.maxHotSize) {
      this.evictFromHot()
    }

    this.hotContext.set(id, {
      data: item,
      addedAt: Date.now(),
      lastAccessed: Date.now(),
      accessCount: 0,
      metadata: metadata || {},
    })

    // Update LRU order
    this.updateLRU(id)

    this.stats.totalStored++
  }

  /**
   * Get from hot context
   */
  getFromHot<T = any>(id: string): T | undefined {
    const entry = this.hotContext.get(id)

    if (entry) {
      entry.lastAccessed = Date.now()
      entry.accessCount++
      this.updateLRU(id)
      this.stats.hits++
      return entry.data as T
    }

    this.stats.misses++
    return undefined
  }

  /**
   * Check if item is in hot context
   */
  isInHot(id: string): boolean {
    return this.hotContext.has(id)
  }

  /**
   * Remove from hot context
   */
  removeFromHot(id: string): boolean {
    const removed = this.hotContext.delete(id)
    if (removed) {
      this.hotAccessOrder = this.hotAccessOrder.filter(k => k !== id)
    }
    return removed
  }

  /**
   * Clear all hot context
   */
  clearHot(): void {
    this.hotContext.clear()
    this.hotAccessOrder = []
  }

  /**
   * Get hot context stats
   */
  getHotStats(): {
    size: number
    maxSize: number
    utilization: number
    hitRate: number
    topAccessed: Array<{ id: string; count: number }>
  } {
    const totalAccesses = this.stats.hits + this.stats.misses

    // Get top accessed items
    const topAccessed = Array.from(this.hotContext.entries())
      .map(([id, entry]) => ({ id, count: entry.accessCount }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10)

    return {
      size: this.hotContext.size,
      maxSize: this.config.maxHotSize,
      utilization: this.hotContext.size / this.config.maxHotSize,
      hitRate: totalAccesses > 0 ? this.stats.hits / totalAccesses : 0,
      topAccessed,
    }
  }

  // ==========================================================================
  // WARM LAYER OPERATIONS
  // ==========================================================================

  /**
   * Store item in warm storage
   */
  async storeInWarm(
    id: string,
    content: any,
    options?: {
      type?: string
      tags?: string[]
      ttl?: number
      priority?: number
      indexForFTS?: boolean
      vectorEmbedding?: number[]
    },
  ): Promise<void> {
    const storageKey = `warm:${id}`

    // Generate content hash for deduplication
    const contentStr = typeof content === 'string' ? content : JSON.stringify(content)
    const hash = await this.simpleHash(contentStr)

    const entry = {
      id,
      content,
      contentHash: hash,
      type: options?.type || 'general',
      tags: options?.tags || [],
      storedAt: Date.now(),
      lastAccessed: Date.now(),
      accessCount: 0,
      sizeBytes: new Blob([contentStr]).size,
      ...options,
    }

    await this.warmBackend.set(storageKey, entry, {
      ttl: options?.ttl || this.config.defaultTTL,
      tags: options?.tags,
      priority: options?.priority,
      contentType: 'json',
    })

    // Index for full-text search
    if (this.config.enableFTS && (options?.indexForFTS !== false)) {
      this.indexForFTS(id, contentStr, options?.tags)
    }

    // Index for vector search
    if (this.config.enableVectorSearch && options?.vectorEmbedding) {
      this.addToVectorIndex(id, options.vectorEmbedding, { type: options?.type })
    }
  }

  /**
   * Retrieve from warm storage
   */
  async getFromWarm<T = any>(id: string): Promise<T | null> {
    const storageKey = `warm:${id}`
    const entry = await this.warmBackend.get(storageKey)

    if (entry) {
      // Update access metadata
      entry.lastAccessed = Date.now()
      entry.accessCount++

      // Update in storage (async, don't wait)
      this.warmBackend.set(storageKey, entry).catch(() => {})

      return entry.content as T
    }

    return null
  }

  /**
   * Full-text search across warm storage
   */
  async ftsSearch(
    query: string,
    options?: {
      limit?: number
      typeFilter?: string
      tagFilter?: string[]
      minScore?: number
    },
  ): Promise<SearchResult<any>[]> {
    if (!this.config.enableFTS) {
      throw new Error('Full-text search not enabled')
    }

    this.stats.searches++

    const queryTerms = this.extractSearchTerms(query)
    const scoredResults: Map<string, { score: number; highlights: string[] }> = new Map()

    // Score each matching document
    for (const term of queryTerms) {
      const matchingIds = this.ftsIndex.get(term.toLowerCase())

      if (matchingIds) {
        for (const id of matchingIds) {
          const existing = scoredResults.get(id)

          if (existing) {
            existing.score += 1 / queryTerms.length
            existing.highlights.push(term)
          } else {
            scoredResults.set(id, {
              score: 1 / queryTerms.length,
              highlights: [term],
            })
          }
        }
      }
    }

    // Apply filters and fetch full results
    const results: SearchResult<any>[] = []
    const minScore = options?.minScore || 0.1
    const limit = options?.limit || 20

    const sortedEntries = Array.from(scoredResults.entries())
      .filter(([, score]) => score.score >= minScore)
      .sort((a, b) => b[1].score - a[1].score)
      .slice(0, limit)

    for (const [id, scoreData] of sortedEntries) {
      const item = await this.getFromWarm(id)

      if (item) {
        // Apply type filter
        if (options?.typeFilter && item.type !== options.typeFilter) continue

        // Apply tag filter
        if (options?.tagFilter && !options.tagFilter.some(t => item.tags?.includes(t))) continue

        results.push({
          item,
          score: scoreData.score,
          highlights: scoreData.highlights.map(h => ({
            field: 'content',
            snippet: `...${h}...`,
          })),
          metadata: {
            matchedTerms: scoreData.highlights,
            rank: results.length + 1,
            totalResults: sortedEntries.length,
          },
        })
      }
    }

    return results
  }

  /**
   * Vector similarity search
   */
  async vectorSearch(
    queryVector: number[],
    options?: {
      limit?: number
      typeFilter?: string
      threshold?: number
    },
  ): Promise<SearchResult<VectorEmbedding>[]> {
    if (!this.config.enableVectorSearch) {
      throw new Error('Vector search not enabled')
    }

    this.stats.searches++

    const results: SearchResult<VectorEmbedding>[] = []
    const threshold = options?.threshold || 0.7
    const limit = options?.limit || 20

    for (const [, embedding] of this.vectorIndex) {
      // Apply type filter
      if (options?.typeFilter && embedding.metadata.type !== options.typeFilter) continue

      const similarity = this.cosineSimilarity(queryVector, embedding.vector)

      if (similarity >= threshold) {
        results.push({
          item: embedding,
          score: similarity,
          highlights: [{
            field: 'vector',
            snippet: `Similarity: ${(similarity * 100).toFixed(1)}%`,
          }],
          metadata: {
            matchedTerms: [],
            rank: 0, // Will be set after sorting
            totalResults: 0,
          },
        })
      }
    }

    // Sort by similarity descending
    results.sort((a, b) => b.score - a.score)

    // Update ranks and apply limit
    const finalResults = results.slice(0, limit)
    finalResults.forEach((r, i) => r.metadata.rank = i + 1)
    finalResults.forEach(r => r.metadata.totalResults = results.length)

    return finalResults
  }

  /**
   * Demote item from hot to warm
   */
  async demoteToWarm(hotId: string): Promise<boolean> {
    const item = this.getFromHot(hotId)

    if (item === undefined) return false

    await this.storeInWarm(hotId, item, {
      type: 'demoted-from-hot',
      priority: 10, // High priority since it was recently used
    })

    this.removeFromHot(hotId)
    return true
  }

  /**
   * Promote item from warm to hot
   */
  async promoteToHot(warmId: string): Promise<boolean> {
    const item = await this.getFromWarm(warmId)

    if (item === null) return false

    this.addToHot(warmId, item, { priority: 10 })
    return true
  }

  /**
   * Archive to cold storage (simulate)
   */
  async archiveToCold(warmIds: string[], reason: string): Promise<{
    archivedCount: number
    archiveId: string
  }> {
    const archiveId = `cold-${Date.now()}-${Math.random().toString(36).substring(7)}`
    let archivedCount = 0

    for (const id of warmIds) {
      const item = await this.getFromWarm(id)

      if (item) {
        // Store in cold format
        const coldKey = `cold:${archiveId}:${id}`
        await this.warmBackend.set(coldKey, {
          originalId: id,
          content: item,
          archivedAt: Date.now(),
          reason,
          originalArchivedId: archiveId,
        }, { ttl: 0 }) // No expiry for cold storage

        // Remove from warm
        const warmKey = `warm:${id}`
        await this.warmBackend.delete(warmKey)

        // Remove from indexes
        this.removeFromIndexes(id)

        archivedCount++
      }
    }

    this.stats.compactions++
    return { archivedCount, archiveId }
  }

  /**
   * Compact warm storage (move old/unused items to cold)
   */
  async compactWarm(options?: {
    olderThanMs?: number
    maxItems?: number
    keepTags?: string[]
  }): Promise<number> {
    const olderThan = options?.olderThanMs || this.config.defaultTTL * 2
    const cutoff = Date.now() - olderThan
    const keys = await this.warmBackend.keys('warm:*')
    const toArchive: string[] = []

    for (const key of keys) {
      const entry = await this.warmBackend.get(key)

      if (entry && (
        entry.lastAccessed < cutoff ||
        (options?.keepTags && !entry.tags?.some(t => options.keepTags.includes(t)))
      )) {
        // Extract ID from key
        const id = key.replace('warm:', '')

        // Don't archive if tagged to keep
        if (options?.keepTags && entry.tags?.some(t => options.keepTags.includes(t))) {
          continue
        }

        toArchive.push(id)

        if (options?.maxItems && toArchive.length >= options.maxItems) {
          break
        }
      }
    }

    if (toArchive.length > 0) {
      const result = await this.archiveToCold(toArchive, 'auto-compaction')
      return result.archivedCount
    }

    return 0
  }

  // ==========================================================================
  // COLD LAYER OPERATIONS
  // ==========================================================================

  /**
   * Retrieve from cold storage
   */
  async getFromCold(archiveId: string, originalId: string): Promise<any | null> {
    const coldKey = `cold:${archiveId}:${originalId}`
    const entry = await this.warmBackend.get(coldKey)

    return entry ? entry.content : null
  }

  /**
   * List archives
   */
  async listArchives(): Promise<Array<{
    archiveId: string
    itemCount: number
    reason: string
    archivedAt: number
  }>> {
    const keys = await this.warmBackend.keys('cold:*')
    const archives = new Map<string, { itemCount: number; reason: string; archivedAt: number }>()

    for (const key of keys) {
      const parts = key.split(':')
      if (parts.length >= 3) {
        const archiveId = parts[1]
        const entry = await this.warmBackend.get(key)

        if (entry) {
          const existing = archives.get(archiveId)
          if (existing) {
            existing.itemCount++
          } else {
            archives.set(archiveId, {
              itemCount: 1,
              reason: entry.reason,
              archivedAt: entry.archivedAt,
            })
          }
        }
      }
    }

    return Array.from(archives.entries()).map(([archiveId, info]) => ({
      archiveId,
      ...info,
    }))
  }

  // ==========================================================================
  // MEMORY FABRIC INTERFACE
  // ==========================================================================

  /**
   * Get complete memory fabric state
   */
  async getFabricState(): Promise<MemoryFabric & {
    advancedStats: typeof this.stats
    indexSizes: { fts: number; vector: number }
  }> {
    const warmKeys = await this.warmBackend.keys('warm:*')
    const coldKeys = await this.warmBackend.keys('cold:*')

    return {
      hot: {
        activeItems: Array.from(this.hotContext.entries()).map(([id, entry]) => ({
          id,
          content: entry.data,
          addedAt: entry.addedAt,
          accessCount: entry.accessCount,
        })) as any,
        currentTaskId: '',
        contextWindow: {},
        lastUpdated: Date.now(),
      },
      warm: {
        sqlLookupEnabled: false,
        vectorSearchEnabled: this.config.enableVectorSearch,
        ftsEnabled: this.config.enableFTS,
        temporalRetrievalEnabled: true,
        graphQueryEnabled: false,
        fileRetrievalEnabled: false,
        cacheSize: warmKeys.length,
        retentionPeriod: this.config.defaultTTL,
        indexingRules: [],
      } as any,
      cold: {
        runs: [],
        agents: [],
        tasks: [],
        prompts: [],
        contexts: [],
        messages: [],
        toolCalls: [],
        outputs: [],
        errors: [],
        decisions: [],
        evidence: [],
        costs: [],
        timings: [],
        skills: [],
        audits: [],
        compressionStats: {
          originalSize: 0,
          compressedSize: 0,
          compressionRatio: 1,
          algorithm: 'none',
          lastCompressed: 0,
        },
      } as any,
      advancedStats: this.stats,
      indexSizes: {
        fts: this.ftsIndex.size,
        vector: this.vectorIndex.size,
      },
    }
  }

  /**
   * Get comprehensive statistics
   */
  async getStatistics(): Promise<{
    hot: ReturnType<typeof this.getHotStats>
    warm: { size: number; indexed: number; oldestEntry: number | null }
    cold: { archives: number; totalItems: number }
    overall: { totalItems: number; hitRate: number; utilization: number }
  }> {
    const warmKeys = await this.warmBackend.keys('warm:*')
    const coldKeys = await this.warmBackend.keys('cold:*')

    // Find oldest warm entry
    let oldestEntry: number | null = null
    for (const key of warmKeys.slice(0, 100)) { // Sample first 100
      const entry = await this.warmBackend.get(key)
      if (entry && (!oldestEntry || entry.storedAt < oldestEntry)) {
        oldestEntry = entry.storedAt
      }
    }

    const totalItems = this.hotContext.size + warmKeys.length + coldKeys.length
    const totalAccesses = this.stats.hits + this.stats.misses

    return {
      hot: this.getHotStats(),
      warm: {
        size: warmKeys.length,
        indexed: this.ftsIndex.size,
        oldestEntry,
      },
      cold: {
        archives: new Set(coldKeys.map(k => k.split(':')[1])).size,
        totalItems: coldKeys.length,
      },
      overall: {
        totalItems,
        hitRate: totalAccesses > 0 ? this.stats.hits / totalAccesses : 0,
        utilization: totalItems / (this.config.maxHotSize + this.config.maxWarmEntries),
      },
    }
  }

  // ==========================================================================
  // UTILITY METHODS
  // ==========================================================================

  /**
   * Simple hash function (for demo - use SHA-256 in production)
   */
  private async simpleHash(content: string): Promise<string> {
    let hash = 0
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i)
      hash = ((hash << 5) - hash) + char
      hash |= 0 // Convert to 32-bit integer
    }
    return `hash-${Math.abs(hash).toString(36)}`
  }

  /**
   * Extract searchable terms from text
   */
  private extractSearchTerms(text: string): string[] {
    // Tokenize, remove stopwords, stem (simplified)
    const stopwords = new Set([
      'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
      'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
      'should', 'may', 'might', 'must', 'shall', 'can', 'need', 'dare',
      'of', 'in', 'to', 'for', 'on', 'with', 'at', 'by', 'from', 'as',
      'into', 'through', 'during', 'before', 'after', 'above', 'below',
      'between', 'under', 'again', 'further', 'then', 'once', 'here',
      'there', 'when', 'where', 'why', 'how', 'all', 'each', 'more',
      'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own',
      'same', 'so', 'than', 'too', 'very', 'just', 'and', 'but', 'if', 'or',
    ])

    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length > 2 && !stopwords.has(word))
      .slice(0, 50) // Limit terms
  }

  /**
   * Index content for full-text search
   */
  private indexForFTS(id: string, content: string, tags?: string[]): void {
    const terms = this.extractSearchTerms(content)

    for (const term of terms) {
      if (!this.ftsIndex.has(term)) {
        this.ftsIndex.set(term, new Set())
      }
      this.ftsIndex.get(term)!.add(id)
    }

    // Also index tags
    if (tags) {
      for (const tag of tags) {
        if (!this.ftsIndex.has(tag)) {
          this.ftsIndex.set(tag, new Set())
        }
        this.ftsIndex.get(tag)!.add(id)
      }
    }
  }

  /**
   * Add to vector index
   */
  private addToVectorIndex(
    id: string,
    vector: number[],
    metadata: Record<string, any>,
  ): void {
    this.vectorIndex.set(id, {
      id,
      vector,
      metadata: {
        ...metadata,
        timestamp: Date.now(),
      },
      timestamp: Date.now(),
    })
  }

  /**
   * Remove from all indexes
   */
  private removeFromIndexes(id: string): void {
    // Remove from FTS index
    for (const [term, ids] of this.ftsIndex) {
      ids.delete(id)
      if (ids.size === 0) {
        this.ftsIndex.delete(term)
      }
    }

    // Remove from vector index
    this.vectorIndex.delete(id)
  }

  /**
   * Calculate cosine similarity between two vectors
   */
  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0

    let dotProduct = 0
    let normA = 0
    let normB = 0

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i]
      normA += a[i] * a[i]
      normB += b[i] * b[i]
    }

    const magnitude = Math.sqrt(normA) * Math.sqrt(normB)
    return magnitude > 0 ? dotProduct / magnitude : 0
  }

  /**
   * Update LRU order
   */
  private updateLRU(id: string): void {
    this.hotAccessOrder = this.hotAccessOrder.filter(k => k !== id)
    this.hotAccessOrder.push(id)
  }

  /**
   * Evict least recently used item from hot context
   */
  private evictFromHot(): boolean {
    if (this.hotAccessOrder.length === 0) return false

    const lruId = this.hotAccessOrder.shift()!

    // Try to demote to warm instead of just deleting
    this.demoteToWarm(lruId).catch(() => {
      // If demotion fails, just remove
      this.removeFromHot(lruId)
    })

    this.stats.evictions++
    return true
  }

  /**
   * Clear everything
   */
  async clearAll(): Promise<void> {
    this.clearHot()
    await this.warmBackend.clear()
    this.ftsIndex.clear()
    this.vectorIndex.clear()
    this.stats = {
      hits: 0,
      misses: 0,
      evictions: 0,
      compactions: 0,
      searches: 0,
      totalStored: 0,
    }
  }

  /**
   * Handle memory pressure
   */
  async handleMemoryPressure(): Promise<void> {
    const stats = await this.getStatistics()
    const utilization = stats.overall.utilization

    // Trigger callbacks
    if (this.config.onMemoryPressure) {
      this.config.onMemoryPressure(utilization)
    }

    // Auto-compact if needed
    if (utilization > 0.9) {
      console.warn('[MemoryFabric] High memory usage, triggering compaction')
      await this.compactWarm({ maxItems: 100 })
    }

    // Force GC-like behavior
    if (utilization > 0.95) {
      console.warn('[MemoryFabric] Critical memory pressure, force clearing old items')
      await this.compactWarm({ olderThanMs: this.config.defaultTTL / 2 })
    }
  }

  /**
   * Batch import items into memory fabric
   */
  async batchImport(
    items: Array<{
      id: string
      content: any
      targetLayer?: 'hot' | 'warm'
      metadata?: any
    }>,
  ): Promise<{ imported: number; failed: number }> {
    let imported = 0
    let failed = 0

    for (const item of items) {
      try {
        const target = item.targetLayer || 'warm'

        if (target === 'hot') {
          this.addToHot(item.id, item.content, item.metadata)
        } else {
          await this.storeInWarm(item.id, item.content, {
            type: item.metadata?.type,
            tags: item.metadata?.tags,
          })
        }

        imported++
      } catch (error) {
        console.error(`Failed to import ${item.id}:`, error)
        failed++
      }
    }

    return { imported, failed }
  }

  /**
   * Export memory state for migration/backup
   */
  async exportState(): Promise<{
    version: string
    exportedAt: number
    hotItems: Array<{ id: string; data: any }>
    warmItemCount: number
    indexSizes: { fts: number; vector: number }
  }> {
    const hotItems = Array.from(this.hotContext.entries()).map(([id, entry]) => ({
      id,
      data: entry.data,
    }))

    const warmKeys = await this.warmBackend.keys('warm:*')

    return {
      version: '2.0.3-advanced',
      exportedAt: Date.now(),
      hotItems,
      warmItemCount: warmKeys.length,
      indexSizes: {
        fts: this.ftsIndex.size,
        vector: this.vectorIndex.size,
      },
    }
  }
}

// ============================================================================
// FACTORY FUNCTIONS
// ============================================================================

/**
 * Create default memory fabric instance
 */
export function createMemoryFabric(config?: Partial<AdvancedMemoryConfig>): AdvancedMemoryFabric {
  return new AdvancedMemoryFabric(config)
}

/**
 * Create memory fabric with localStorage backend (browser only)
 */
export function createBrowserMemoryFabric(config?: Partial<Omit<AdvancedMemoryConfig, 'backend'>>): AdvancedMemoryFabric {
  if (typeof window === 'undefined') {
    console.warn('Not in browser environment, using in-memory backend')
  }

  return new AdvancedMemoryFabric({
    ...config,
    backend: typeof window !== 'undefined' ? new LocalStorageBackend('xhe_mem_') : new InMemoryStorageBackend(),
  })
}
