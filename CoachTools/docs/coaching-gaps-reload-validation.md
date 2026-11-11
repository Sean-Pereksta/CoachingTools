# Coaching Gaps repeated loading repair

## Cause

The selected-coach repair correctly restored scoped data, but its new directory
subscription treated every identity notification as a reason to reload all five
Coaching Gaps sources. Reapplying a saved team setup rewrote every coach and
emitted `person-updated` even when nothing had changed. The hosted Gaps shell
also started another identity service, repeating setup and background learning.
These notifications repeatedly superseded active loads. Smaller fixtures
eventually settled, while large saved directories could keep restarting the
visible loading workflow for much longer.

The previous browser test used a minimal parent and missed the extra directory
setup and broadcasts in the actual Horizon desktop. The new regression opens
the real desktop and its real Coaching Gaps iframe.

## Repair

- Unchanged observed people and person edits retain their timestamps/revisions
  and do not write or emit changes.
- Saved team/coordinator synchronization applies real changes and sends one
  completion notification, preserving aliases, source evidence and assignment
  history. Partial committed changes still notify if a later write fails.
- Hosted Gaps reuses the desktop identity service. Standalone and inaccessible
  parent contexts retain the local service fallback.
- Gaps coalesces background notification bursts, refreshes scope switches
  immediately, and cancels pending refreshes when its page closes.
- The initial opening retains its progress UI. Later background refreshes and
  the one-time week-alignment read do not reopen that UI. Standalone intelligence
  reads do not run the foreground Gaps canonical preparation.

## Validation

All data is synthetic; existing user storage and production imports were not
used or cleared.

The real Horizon browser regression seeds 10,000 weekly rows across four coaches
and selects three coaches. Re-reading unchanged saved setup in desktop and frame
caused ten additional reload requests on the previous code; the updated code
causes zero. A genuine assignment change refreshes three teams to two, restoring
it returns to three, and rapid coach-to-All switching shows all 10,000 rows.
The complete 10,001-row source AOA remains intact. There are no browser runtime
errors and no new loading masks during these background updates.

Deterministic tests cover 100 notifications coalescing into one quiet read,
immediate scope updates, page-close cancellation, parent identity reuse and
fallback, unchanged setup/person updates, real setup changes, and partial-write
notification delivery. The original cold-registry and mid-read scope tests also
continue to pass.

Run `npm run test:horizon`, `npm run test:coaching-gaps:browser`,
`npm run test:prefetch`, `npm run test:desktop`, and `npm run test:allstar`.
The storage-server check requires access to its local loopback server. The real
All-Star browser startup test exercises modular and portable versions with
50,000 backing rows, 10,000 selected rows, source reuse and scope changes.
