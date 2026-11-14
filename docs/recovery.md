# Task recovery

Browser refresh/disconnect and service failure are different events. A browser can
reload the persisted transcript and reconnect to the event stream without changing
execution. A stopped service cannot safely assume its old executor also stopped.

## Normal cancellation

Stop changes a running task to `cancelling`, sends `turn/interrupt` when the native
turn ID is known, and waits for completion. If it does not acknowledge promptly,
the owned native process session is terminated. A terminal state is persisted only
after cleanup is confirmed. Partial text and the native thread mapping are retained.
Service shutdown cancels queued work and applies the same cancellation flow to its active workers.
Warm slots close their owned sessions on cancellation; successful reusable slots
keep their runtime lease until idle expiry, retirement or shutdown.

## Restart reconciliation

1. Acquire the data directory's exclusive service lock.
2. Reconcile verified warm-runtime journals, then read persisted `queued`/`running`/`cancelling` tasks, without scheduling any new turns.
3. Validate each journal against the task/owner, machine identity, boot identity
   and platform-native process start time. Never infer ownership from a PID alone.
4. Stop only the verified owned process session and verify no live members remain.
   A free execution lease is also required before closing a recovered task.
5. Mark it `interrupted` with `service_restarted`, expire pending approvals, preserve
   user input/partial output and native thread ID. **Never automatically replay it.**

The launcher writes ownership **before exec**, so native code cannot start before
its journal exists. This addresses the crash between process spawn and saving its
PID in a database. A parent-death guard, inherited lease and process-session checks
provide additional layers; they do not authorize killing unrelated processes.

## Blocked recovery

If the journal is invalid, a lease is held without verifiable ownership, a process
cannot be stopped, or the record belongs to another machine, new sends are blocked
and readiness is false. `lazyfish status` includes `execution.recovery_blocked` and
`execution.blocked_jobs` (IDs/status only). The page shows the same blocked notice.
No record or history is deleted as a workaround.

- Stop this installation using its supervisor/`lazyfish stop`, if still reachable.
- Verify the actual owner and whether its old execution is still running. Do not
  blindly kill the PID in a copied journal or manipulate task states/lock files.
- On the original machine, a normal restart can finish reconciliation once the old
  execution is confirmed stopped. Preserve private logs/journals for diagnosis.
- For backup/migration, stop the original installation first. Never run two
  machines against one live data directory. Foreign-machine records require manual
  operator review; there is intentionally no "force unlock" command in this preview.
