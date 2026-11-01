import { untrack } from "svelte";
import { tabs } from "$domain/tabs";
import * as requests from "./space-requests.svelte";
import { FRESH_LOOK } from "./space-look";

/**
 * The switcher and the editor behind it, as one flow for whichever surface
 * hosts it: the popover on the column's head, or the panel beside the rail.
 * The host says what closing means; the flow keeps what is being made or
 * edited, and takes a request a menu made before there was room for it.
 */
export class SpaceFlow {
  open = $state(false);
  /** The space being edited; null lists them. */
  editingId = $state<string | null>(null);
  /** Made a moment ago, so its name waits to be typed over. */
  fresh = $state(false);
  /** The spaces there were before one was asked for, until it appears. */
  making = $state.raw<string[] | null>(null);
  makeFailed = $state(false);
  /** The editor was opened from the list, so going back returns to it. */
  fromList = false;

  spaces = $derived(tabs.spaces());
  active = $derived(tabs.activeSpace());
  editing = $derived(this.spaces.find((space) => space.id === this.editingId) ?? null);

  #release: (() => void) | null = null;
  #closed: (restore: boolean) => void;

  constructor(closed: (restore: boolean) => void = () => {}) {
    this.#closed = closed;

    $effect(() => {
      const before = this.making;
      if (!before) return;
      const made = this.spaces.find((space) => !before.includes(space.id));
      if (!made) return;
      untrack(() => {
        this.making = null;
        this.editingId = made.id;
        this.fresh = true;
        this.fromList = false;
      });
    });

    // A space deleted from under its editor leaves the flow.
    $effect(() => {
      if (this.editingId !== null && this.editing === null && this.making === null)
        untrack(() => this.dismiss());
    });

    // A menu asked for this before there was room for it.
    $effect(() => {
      const request = requests.pending();
      if (!request || !this.active) return;
      untrack(() => {
        requests.take();
        this.#release = request.release;
        if (request.kind === "new") {
          this.show();
          void this.make();
        } else this.show(request.kind === "edit" ? (this.active?.id ?? null) : null);
      });
    });
  }

  show(id: string | null = null) {
    this.editingId = id;
    this.fresh = false;
    this.fromList = false;
    this.open = true;
  }

  edit(id: string, rename = false) {
    this.editingId = id;
    this.fresh = rename;
    this.fromList = true;
  }

  dismiss(restore = false) {
    if (!this.open) return;
    this.open = false;
    this.editingId = null;
    this.making = null;
    this.makeFailed = false;
    this.#release?.();
    this.#release = null;
    this.#closed(restore);
  }

  /** A new space is made at once, named in order, and its editor opens on it
   *  with the name ready to be typed over. */
  async make() {
    if (this.making) return;
    this.open = true;
    this.makeFailed = false;
    this.making = this.spaces.map((space) => space.id);
    const result = await tabs.createSpace("", FRESH_LOOK);
    if (result.outcome === "failed" || result.outcome === "rejected") {
      this.making = null;
      this.makeFailed = true;
    }
  }

  choose(id: string) {
    this.dismiss(true);
    if (id !== this.active?.id) void tabs.switchSpace(id);
  }

  /** Escape steps back from an editor opened from the list, else closes. */
  escape() {
    if (this.editingId !== null && this.fromList) this.editingId = null;
    else this.dismiss(true);
  }

  /** The editor finished (`done`) or was backed out of. */
  finished(done: boolean) {
    if (done || !this.fromList) this.dismiss(true);
    else this.editingId = null;
  }
}
