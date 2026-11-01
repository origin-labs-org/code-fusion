import type {
  ConversationShareSelectionState,
  ConversationShareSelectionDraft,
  ConversationShareDockState,
} from "@/store/conversationShareSelectionStore.js";

export function createConversationSharePopoverActions(
  set: (
    updater: (
      state: ConversationShareSelectionState,
    ) => Partial<ConversationShareSelectionState> | ConversationShareSelectionState,
  ) => void,
  getConversationShareDraft: (
    state: ConversationShareSelectionState,
    taskId: string,
  ) => ConversationShareSelectionDraft,
  getConversationShareDockState: (
    state: ConversationShareSelectionState,
    taskId: string,
  ) => ConversationShareDockState,
  defaultDockState: ConversationShareDockState,
): Pick<
  ConversationShareSelectionState,
  | "deselectProductTurn"
  | "openShare"
  | "closeShare"
  | "beginSelectionEdit"
  | "togglePendingRow"
  | "setAllPendingRowsSelected"
  | "confirmSelectionEdit"
  | "cancelSelectionEdit"
> {
  return {
    
    deselectProductTurn: (taskId, productTurnId) =>
      set((state) => {
        const current = getConversationShareDraft(state, taskId);
        if (!current.open || !productTurnId || state.dockStates[taskId]?.publishing) return state;
        const editing = current.pendingExcludedRowIds != null;
        const excluded = new Set(current.pendingExcludedRowIds ?? current.excludedRowIds);
        let changed = false;
        for (const rowId of current.availableRowIds) {
          if (current.productTurnIdByRowId[rowId] !== productTurnId || excluded.has(rowId)) {
            continue;
          }
          excluded.add(rowId);
          changed = true;
        }
        if (!changed) return state;
        return {
          drafts: {
            ...state.drafts,
            [taskId]: {
              ...current,
              [editing ? "pendingExcludedRowIds" : "excludedRowIds"]: [...excluded].sort(
                (left, right) => left - right,
              ),
            },
          },
          ...(!editing
            ? {
                dockStates: {
                  ...state.dockStates,
                  [taskId]: {
                    ...getConversationShareDockState(state, taskId),
                    disclosureAccepted: false,
                    error: null,
                  },
                },
              }
            : {}),
        };
      }),
    openShare: (taskId) =>
      set((state) => {
        const current = getConversationShareDraft(state, taskId);
        const dock = getConversationShareDockState(state, taskId);
        if (dock.publishing || current.open) return state;
        const restart = Boolean(dock.publishedShareUrl);
        return {
          drafts: {
            ...state.drafts,
            [taskId]: {
              ...current,
              ...(restart ? { excludedRowIds: [] } : {}),
              open: true,
              pendingExcludedRowIds: null,
            },
          },
          ...(restart
            ? {
                dockStates: {
                  ...state.dockStates,
                  [taskId]: { ...defaultDockState, title: dock.title },
                },
              }
            : {}),
        };
      }),
    closeShare: (taskId) =>
      set((state) => {
        if (state.dockStates[taskId]?.publishing) return state;
        return {
          drafts: {
            ...state.drafts,
            [taskId]: {
              ...getConversationShareDraft(state, taskId),
              open: false,
              pendingExcludedRowIds: null,
            },
          },
        };
      }),
    beginSelectionEdit: (taskId) =>
      set((state) => {
        const current = getConversationShareDraft(state, taskId);
        if (
          !current.open ||
          state.dockStates[taskId]?.publishing ||
          state.dockStates[taskId]?.publishedShareUrl ||
          current.pendingExcludedRowIds != null
        )
          return state;
        return {
          drafts: {
            ...state.drafts,
            [taskId]: {
              ...current,
              pendingExcludedRowIds: [...current.excludedRowIds],
            },
          },
        };
      }),
    togglePendingRow: (taskId, rowId) =>
      set((state) => {
        const current = getConversationShareDraft(state, taskId);
        if (
          current.pendingExcludedRowIds == null ||
          !current.availableRowIds.includes(rowId) ||
          state.dockStates[taskId]?.publishing
        )
          return state;
        const turnId = current.productTurnIdByRowId[rowId];
        const ids = turnId
          ? current.availableRowIds.filter((id) => current.productTurnIdByRowId[id] === turnId)
          : [rowId];
        const excluded = new Set(current.pendingExcludedRowIds);
        const remove = !excluded.has(rowId);
        for (const id of ids) {
          if (remove) excluded.add(id);
          else excluded.delete(id);
        }
        return {
          drafts: {
            ...state.drafts,
            [taskId]: {
              ...current,
              pendingExcludedRowIds: [...excluded].sort((a, b) => a - b),
            },
          },
        };
      }),
    setAllPendingRowsSelected: (taskId, selected) =>
      set((state) => {
        const current = getConversationShareDraft(state, taskId);
        if (current.pendingExcludedRowIds == null || state.dockStates[taskId]?.publishing)
          return state;
        return {
          drafts: {
            ...state.drafts,
            [taskId]: {
              ...current,
              pendingExcludedRowIds: selected ? [] : [...current.availableRowIds],
            },
          },
        };
      }),
    cancelSelectionEdit: (taskId) =>
      set((state) => {
        if (state.dockStates[taskId]?.publishing) return state;
        return {
          drafts: {
            ...state.drafts,
            [taskId]: {
              ...getConversationShareDraft(state, taskId),
              pendingExcludedRowIds: null,
            },
          },
        };
      }),
    confirmSelectionEdit: (taskId) =>
      set((state) => {
        const current = getConversationShareDraft(state, taskId);
        if (current.pendingExcludedRowIds == null || state.dockStates[taskId]?.publishing)
          return state;
        const excluded = current.pendingExcludedRowIds.filter((id) =>
          current.availableRowIds.includes(id),
        );
        if (current.availableRowIds.every((id) => excluded.includes(id))) return state;
        const changed =
          excluded.length !== current.excludedRowIds.length ||
          excluded.some((id) => !current.excludedRowIds.includes(id));
        return {
          drafts: {
            ...state.drafts,
            [taskId]: {
              ...current,
              excludedRowIds: excluded,
              pendingExcludedRowIds: null,
            },
          },
          ...(changed
            ? {
                dockStates: {
                  ...state.dockStates,
                  [taskId]: {
                    ...getConversationShareDockState(state, taskId),
                    disclosureAccepted: false,
                    error: null,
                  },
                },
              }
            : {}),
        };
      }),
  };
}
