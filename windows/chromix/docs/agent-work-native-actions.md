# Retained native semantic actions

The macOS engine implements `AgentBrowserPort::work_resource_act` on the existing
retained WKWebView. The accepted native recipes are Click, Fill, and Select.
These reuse the immutable isolated runtime and the separately attested fixed
page-world fill shim. This path neither synthesizes trusted OS input nor grants
page activation. Select writes the native index through the captured setter, checks it,
then dispatches untrusted bubbling `input` and `change` events, as a person's
choice does: sort and filter menus act on those events, never on the write.
A custom listbox (ARIA `listbox` with `option` children) is chosen as a person
chooses: the visible, enabled option inside it is hit-tested and clicked, and
the choice counts only when that option then reads as selected. A list that
closes as it is chosen ends `applied_unverified`; the site prompt steers such
dropdowns to a click on the option with `page_changed` verification.
Fill on a text field ends as a person's edit does: `input`, then `change`,
then (for a plain text box that does not hold focus) `blur` and `focusout`;
a combobox or search box keeps its suggestions open. Typed fields are filled
only with a value the browser stores unchanged, so the exact-value proof
holds: email and URLs without surrounding spaces, telephone numbers on one
line, number fields with a plain decimal, `date` as YYYY-MM-DD, `month`,
`time` as HH:MM and `datetime-local`; any other value is refused before
dispatch. An empty private field (autocomplete email, phone, address) reports
its emptiness, which discloses nothing. A field whose value was not observed
is refused at binding as `value_unobserved`, never typed into and left
unverified.

A target the page re-rendered between the look and the action (a list row
or button replaced by its framework) is rebound once, deterministically:
the one element at the target's observed centre, or its nearest composed
ancestors, whose role and complete action descriptor (name, state,
operations, sensitivity, value) still match takes over the target's key, so
the action and its fresh-observation proof join on one identity. A second
match, or an element the look observed under another key, leaves the
reference `stale_reference`; nothing is guessed.

In a site session every click, fill, select and press asks the runtime to
settle before it answers: the result is held until the page's DOM and its
resource loads have been quiet for 200 ms, or until a ceiling of half the
native budget and at most 1.5 s. Style-attribute changes (JavaScript
animation) do not hold it; sockets, polling and timers are bounded by the
ceiling instead of waited out. The observer exists only while that action is
pending, reads no content and is disconnected on either ending, so the page
controls only how long the bounded wait lasts, never an effect. A scroll keeps
its own rendering sample. Rust's settle and page-change looks still follow.

A look stops its traversal after 2 s and reports `inspection_limit`, so a
huge or slow DOM yields a truthful partial look inside the 5 s observation
budget instead of a timeout. A look the page never pulled, because its main
thread stayed busy past the budget, ran nothing in the page: it ends timed
out, the document keeps its semantic channel, and the controller takes one
more look. A look the page did take may still answer late, so a timeout
there closes the channel as before. Click
also reaches a row, cell or list item the page made clickable itself (a click
handler attribute, a tab stop, or a pointer cursor set on the item and not
inherited from its parent), such as a mail client's thread rows; the decoder
admits Click and nothing else on those roles. Other platforms retain explicit `Unsupported` until they have
their own verified adapter.

The request must already contain an independently policy-authorized native
effect. Page labels, proposed effect classes, account sessions and the resource
lease cannot authorize an effect. Public discovery remains read-only.

## Admission and execution

The native ingress joins the original resource incarnation, lease, last observed
context, document epoch, native deadline and exclusive operation slot. It
retires observation authority before queueing. The main-thread host separately
checks the exact last invocation and snapshot, native document stamp, profile
erasure state and semantic runtime readiness on that retained view. No legacy
tab/context lookup is used.

The original native execution deadline includes queueing and presentation time.
It is never rebased when a task reaches the main thread. Each action owns a
temporary presentation with the same captured app/key/main-window ownership
used by retained observations. Initial presentation also checks the original
responder; subsequent responder changes in the human window are allowed while
the retained page stays attached to its exact non-key, non-main, ignores-mouse
surface. The human window must never route its responder into that page's native
subtree. Presentation does not activate the app or receive pointer input. The
fixed semantic recipe still revalidates its target at the point of effect.

A runtime request may wait for a page pull. Retained actions therefore carry a
native-only predicate checked immediately before handing the recipe to that
pull. It checks lease ownership, port health, the original deadline, captured
human ownership and the exact native document stamp. Refusal returns the
original correlated cancellation terminal without handing effect bytes to the
page. The predicate never reaches the model or page.

Once the recipe has been handed to the page, cancellation cannot claim that an
effect did not occur. Cancellation, ownership loss, expiry or destruction closes
resource reuse and drains the original callback. An uncertain effect is never
automatically replayed. Native results remain provisional until the controller
observes fresh state and verifies the declared effect through policy.

## Return and retirement

The resource retains the task, presentation, bounded wake owner and native
terminal separately. It delivers the terminal only after presentation retirement,
the native callback's next-main-queue return barrier, and semantic channel idle.
Cleanup has bounded wake opportunities and cannot manufacture a missing terminal.

The app's terminal callback can wake another thread before it returns. An exact
action return ticket prevents that thread from issuing the next snapshot too
early. The engine holds action/callback debt through the callback, releases its
original task permit, clears that exact debt, publishes the physical return fact
under the guard, then notifies outside locks. The app waits for that fact before
continuation. A late callback can establish physical return after revocation;
it cannot establish current authority. A callback panic publishes no successful
return.

Pending action debt blocks observation, navigation, lease retirement, resource
reuse, destruction completion and global shutdown. Dropping a dispatched owner
keeps explicit debt and quarantines the resource. An idle retained resource gains
no timer, worker, provider request or action payload from this implementation.

This is the native integration contract. Passing deterministic tests or a Rust
build does not constitute a bundled real-site action witness; that qualification
must exercise the complete app, controller, policy and native path.

## Trusted input on macOS

Retained actions dispatch untrusted DOM events from the isolated world:
`isTrusted` is false and no user activation is granted. A click first sends
pointer and mouse `over`, `enter` and `move`, so menus that open on script
hover open; CSS `:hover`, key defaults (Tab, arrows, Page Down, typing into a
canvas editor such as Google Docs), popups, clipboard and file pickers still
need trusted input.

The only route WebKit exposes for that is AppKit itself: an `NSEvent`
synthesized with `mouseEventWithType:` or `keyEventWithType:` and delivered by
`-[NSWindow sendEvent:]` to the window holding the `WKWebView`, with the view
as that window's first responder for keys. WebKit's UI process turns it into
a trusted web event with user activation. The release-excluded
`macos-agentic-input-probe` already implements this backend
(`macos_app_kit_event`, plus `macos_accessibility`) and its owned-surface
variant refuses a moved frame or a changed responder; only the fixed DOM
recipe is qualified (hidden, 14 cases, zero trusted effects).

Shipping it is not small:

- the retained page's surface is non-key, non-main and ignores the mouse, so
  every trusted key or click needs a responder change confined to that window
  and proof that the person's window, focus and pointer never change;
- trusted input grants transient and sticky user activation, so popups,
  clipboard, fullscreen and downloads become reachable; the activation must be
  tracked as its own axis (agentic-browsing §8.3) and new gates added for each;
- queued native input cannot be withdrawn on cancel or takeover, so it needs
  native drain debt joined to the existing action and human-input fences;
- mouse-move tracking areas and IME composition differ between visible,
  occluded and hidden views and must be qualified per presentation state.

Until that qualification exists on named devices, the production answer for
controls that need trusted input stays a typed refusal and, where a person can
finish the step, a handoff.
