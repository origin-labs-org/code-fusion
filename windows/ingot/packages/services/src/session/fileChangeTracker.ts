

interface FileSnapshot {
  path: string;
  
  beforeContent: string | null;
  
  afterContent: string;
  
  writeCount: number;
}

interface TurnFileChanges {
  turnIndex: number;
  
  snapshots: Map<string, FileSnapshot>;
  
  fileState: "applied" | "reverted";
}

interface SerializedFileSnapshot {
  path: string;
  beforeContent: string | null;
  afterContent: string;
  writeCount: number;
}

interface SerializedTurnFileChanges {
  turnIndex: number;
  snapshots: SerializedFileSnapshot[];
  fileState?: "applied" | "reverted";
}

export class SessionFileChangeTracker {
  private turns: TurnFileChanges[] = [];
  private currentTurnIndex = -1;

  
  newTurn(): number {
    this.currentTurnIndex++;
    this.turns.push({
      turnIndex: this.currentTurnIndex,
      snapshots: new Map(),
      fileState: "applied",
    });
    return this.currentTurnIndex;
  }

  
  record(path: string, beforeContent: string | null, afterContent: string): void {
    if (this.currentTurnIndex < 0) {
      this.newTurn();
    }

    const currentTurn = this.turns[this.turns.length - 1]!;
    const existing = currentTurn.snapshots.get(path);

    if (existing) {
      existing.afterContent = afterContent;
      existing.writeCount++;
    } else {
      currentTurn.snapshots.set(path, {
        path,
        beforeContent,
        afterContent,
        writeCount: 1,
      });
    }
  }

  
  getChangesForTurn(turnIndex: number): FileSnapshot[] {
    const turn = this.turns.find((t) => t.turnIndex === turnIndex);
    if (!turn) return [];
    return Array.from(turn.snapshots.values());
  }

  
  getFileStateForTurn(turnIndex: number): "applied" | "reverted" {
    return this.turns.find((turn) => turn.turnIndex === turnIndex)?.fileState ?? "applied";
  }

  
  setFileStateForTurn(turnIndex: number, fileState: "applied" | "reverted"): void {
    const turn = this.turns.find((item) => item.turnIndex === turnIndex);
    if (!turn) {
      return;
    }
    turn.fileState = fileState;
  }

  
  getChangesAfterTurn(turnIndex: number): FileSnapshot[] {
    const result: FileSnapshot[] = [];
    for (const turn of this.turns) {
      if (turn.turnIndex > turnIndex) {
        result.push(...turn.snapshots.values());
      }
    }
    return result;
  }

  
  getRewindOperations(toTurnIndex: number): Map<string, string | null> {
    const rewindOps = new Map<string, string | null>();

    for (let i = this.turns.length - 1; i >= 0; i--) {
      const turn = this.turns[i]!;
      if (turn.turnIndex <= toTurnIndex) break;

      for (const snapshot of turn.snapshots.values()) {
        rewindOps.set(snapshot.path, snapshot.beforeContent);
      }
    }

    for (const turn of this.turns) {
      if (turn.turnIndex > toTurnIndex) break;
      for (const snapshot of turn.snapshots.values()) {
        if (rewindOps.has(snapshot.path)) {
          rewindOps.set(snapshot.path, snapshot.afterContent);
        }
      }
    }

    return rewindOps;
  }

  
  getAllChangedFiles(): Map<string, { originalContent: string | null; finalContent: string }> {
    const result = new Map<string, { originalContent: string | null; finalContent: string }>();

    for (const turn of this.turns) {
      for (const snapshot of turn.snapshots.values()) {
        const existing = result.get(snapshot.path);
        if (existing) {
          existing.finalContent = snapshot.afterContent;
        } else {
          result.set(snapshot.path, {
            originalContent: snapshot.beforeContent,
            finalContent: snapshot.afterContent,
          });
        }
      }
    }

    return result;
  }

  
  getCurrentTurnIndex(): number {
    return this.currentTurnIndex;
  }

  
  restoreCurrentTurnIndex(turnIndex: number): void {
    if (!Number.isFinite(turnIndex)) {
      return;
    }

    this.currentTurnIndex = Math.max(this.currentTurnIndex, Math.trunc(turnIndex));
  }

  
  getTurnCount(): number {
    return this.turns.length;
  }

  
  serialize(): SerializedTurnFileChanges[] {
    return this.turns.map((turn) => ({
      turnIndex: turn.turnIndex,
      snapshots: Array.from(turn.snapshots.values()),
      fileState: turn.fileState,
    }));
  }

  
  static deserialize(data: SerializedTurnFileChanges[]): SessionFileChangeTracker {
    const tracker = new SessionFileChangeTracker();
    for (const turn of data) {
      const snapshots = new Map<string, FileSnapshot>();
      for (const s of turn.snapshots) {
        snapshots.set(s.path, { ...s });
      }
      tracker.turns.push({
        turnIndex: turn.turnIndex,
        snapshots,
        fileState: turn.fileState ?? "applied",
      });
    }
    tracker.currentTurnIndex = data.length > 0 ? data[data.length - 1]!.turnIndex : -1;
    return tracker;
  }

  
  truncateAfterTurn(turnIndex: number): void {
    this.turns = this.turns.filter((t) => t.turnIndex <= turnIndex);
    this.currentTurnIndex = this.turns.length > 0 ? this.turns[this.turns.length - 1]!.turnIndex : -1;
  }
}
