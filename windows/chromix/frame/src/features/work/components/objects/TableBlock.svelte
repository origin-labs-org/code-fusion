<script lang="ts">
  import { tick } from "svelte";
  import Icon from "$shared/ui/Icon";
  import * as m from "$shared/i18n/messages";
  import type { ObjectActions, OwnedData, SheetView } from "../../lib/board/types";
  import { Add01Icon, Cancel01Icon } from "./icons";
  /** The person's own table: its headings and cells typed in place, rows and columns added as they go. */
  let { object, actions }: { object: SheetView; actions: ObjectActions } = $props();
  type Sheet = Extract<OwnedData, { kind: "sheet" }>;
  const MAX_COLUMNS = 8;
  let root = $state<HTMLElement>();

  function change(edit: (sheet: Sheet) => Sheet) {
    actions.edit?.(object.id, (data) => (data.kind === "sheet" ? edit(data) : data));
  }
  async function focus(row: number, column: number) {
    await tick();
    root?.querySelector<HTMLInputElement>(`[data-cell="${row}:${column}"]`)?.focus();
  }
  function setCell(row: number, column: number, value: string) {
    if ((object.rows[row]?.cells[column] ?? "") === value) return;
    change((sheet) => ({
      ...sheet,
      rows: sheet.rows.map((entry, at) =>
        at === row
          ? { ...entry, cells: entry.cells.map((cell, index) => (index === column ? value : cell)) }
          : entry,
      ),
    }));
  }
  function setLabel(column: number, value: string) {
    const label = value.trim();
    if (!label || label === object.columns[column]?.label) return;
    change((sheet) => ({
      ...sheet,
      columns: sheet.columns.map((entry, at) => (at === column ? { ...entry, label } : entry)),
    }));
  }
  function addRow(focusColumn = 0) {
    const row = object.rows.length;
    change((sheet) => ({
      ...sheet,
      rows: [...sheet.rows, { cells: sheet.columns.map(() => "") }],
    }));
    void focus(row, focusColumn);
  }
  function removeRow(row: number) {
    change((sheet) => ({ ...sheet, rows: sheet.rows.filter((_, at) => at !== row) }));
  }
  function addColumn() {
    if (object.columns.length >= MAX_COLUMNS) return;
    const column = object.columns.length;
    change((sheet) => ({
      ...sheet,
      columns: [
        ...sheet.columns,
        { label: m.work_block_column({ number: column + 1 }), kind: "text" },
      ],
      rows: sheet.rows.map((entry) => ({ ...entry, cells: [...entry.cells, ""] })),
    }));
    void tick().then(() =>
      root?.querySelector<HTMLInputElement>(`[data-label="${column}"]`)?.select(),
    );
  }
  function keyed(event: KeyboardEvent, row: number, column: number) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    setCell(row, column, (event.currentTarget as HTMLInputElement).value);
    if (row + 1 < object.rows.length) void focus(row + 1, column);
    else addRow(column);
  }
</script>

<section
  class="table-block"
  bind:this={root}
  aria-label={object.title}
  style:--columns={object.columns.length}
>
  {#if object.title}<h3>{object.title}</h3>{/if}
  <div class="grid" role="grid">
    <div class="row head" role="row">
      {#each object.columns as column, index (index)}<input
          class="label nodrag nopan"
          role="columnheader"
          data-label={index}
          value={column.label}
          aria-label={column.label}
          maxlength="24"
          onblur={(event) => setLabel(index, event.currentTarget.value)}
          onkeydown={(event) => event.key === "Enter" && event.currentTarget.blur()}
        />{/each}
      {#if object.columns.length < MAX_COLUMNS}<button
          type="button"
          class="edge nodrag nopan"
          aria-label={m.work_block_add_column()}
          title={m.work_block_add_column()}
          onclick={addColumn}><Icon icon={Add01Icon} size={13} /></button
        >{:else}<span></span>{/if}
    </div>
    {#each object.rows as row, at (at)}<div class="row" role="row">
        {#each object.columns as column, index (index)}<input
            class="cell nodrag nopan"
            role="gridcell"
            data-cell="{at}:{index}"
            value={row.cells[index] ?? ""}
            aria-label={column.label}
            maxlength="60"
            onblur={(event) => setCell(at, index, event.currentTarget.value)}
            onkeydown={(event) => keyed(event, at, index)}
          />{/each}
        <button
          type="button"
          class="edge remove nodrag nopan"
          aria-label={m.work_block_remove_row()}
          title={m.work_block_remove_row()}
          onclick={() => removeRow(at)}><Icon icon={Cancel01Icon} size={12} /></button
        >
      </div>{/each}
  </div>
  <button type="button" class="new nodrag nopan" onclick={() => addRow()}
    ><Icon icon={Add01Icon} size={13} />{m.work_block_add_row()}</button
  >
</section>

<style>
  .table-block {
    display: flex;
    flex-direction: column;
    gap: 10px;
    box-sizing: border-box;
    inline-size: 100%;
    padding: 16px 14px 12px 18px;
    border-radius: var(--radius-card);
    background: var(--color-surface);
    box-shadow: var(--shadow-raised);
    color: var(--color-text);
  }

  h3 {
    margin: 0;
    font-size: var(--text-object-title);
    font-weight: 650;
    letter-spacing: -0.012em;
  }

  .grid {
    display: flex;
    flex-direction: column;
  }

  .row {
    display: grid;
    grid-template-columns: repeat(var(--columns), minmax(96px, 1fr)) 26px;
    align-items: center;
    column-gap: 12px;
    min-block-size: 34px;
    border-block-end: 1px solid var(--color-border);
  }

  .row.head {
    min-block-size: 30px;
  }

  input {
    min-inline-size: 0;
    padding: 6px 0;
    border: 0;
    background: transparent;
    color: inherit;
    font: inherit;
    outline: none;
  }

  .label {
    color: var(--color-muted);
    font-size: var(--text-label);
    font-weight: 600;
  }

  .cell {
    font-size: var(--text-body);
    font-variant-numeric: tabular-nums;
  }

  input:focus {
    border-radius: var(--radius-control-compact);
    box-shadow: 0 0 0 1.5px var(--color-ring);
  }

  .edge {
    display: grid;
    place-items: center;
    inline-size: 26px;
    block-size: 26px;
    padding: 0;
    border: 0;
    border-radius: var(--radius-control-compact);
    background: transparent;
    color: var(--color-muted);
    cursor: default;
    transition:
      opacity var(--motion-fast) var(--ease-out),
      background-color var(--motion-fast) var(--ease-out);
  }

  .edge:hover {
    background: var(--color-control-hover);
    color: var(--color-text);
  }

  .remove {
    opacity: 0;
  }

  .remove:focus-visible,
  .row:hover .remove {
    opacity: 1;
  }

  .new {
    display: inline-flex;
    align-items: center;
    align-self: flex-start;
    gap: 6px;
    block-size: 28px;
    padding: 0 8px 0 4px;
    border: 0;
    border-radius: var(--radius-control-compact);
    background: transparent;
    color: var(--color-muted);
    font: inherit;
    font-size: var(--text-label);
    font-weight: 500;
    cursor: default;
  }

  .new:hover {
    background: var(--color-control-hover);
    color: var(--color-text);
  }

  .edge:focus-visible,
  .new:focus-visible {
    outline: 2px solid var(--color-ring);
    outline-offset: 1px;
  }
</style>
