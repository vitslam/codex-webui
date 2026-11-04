# Task recovery / 异常恢复

Browser refresh/disconnect and service failure are different events. A browser can
reload the persisted transcript and reconnect to the event stream without changing
execution. A stopped service cannot safely assume its old executor also stopped.

网页刷新与服务异常是两回事。网页重连只恢复显示，不改变执行；服务进程停止不代表旧执行必然停止。

## Normal cancellation / 正常取消

Stop changes a running task to `cancelling`, sends `turn/interrupt` when the native
turn ID is known, and waits for completion. If it does not acknowledge promptly,
the owned native process session is terminated. A terminal state is persisted only
after cleanup is confirmed. Partial text and the native thread mapping are retained.
Service shutdown cancels queued work and applies the same cancellation flow to its active workers.
Warm slots close their owned sessions on cancellation; successful reusable slots
keep their runtime lease until idle expiry, retirement or shutdown.

“停止”先标记正在取消，向已知原生 turn 发送中断；未及时响应则终止本轮所属的原生
进程会话。确认收尾后才写入终态，保留部分文本和原生会话。服务正常退出也会取消排队及运行任务。成功可复用的执行槽继续持有归属租约，
直到空闲到期、缩容或退出；取消则关闭所属进程。

## Restart reconciliation / 重启收尾

1. Acquire the data directory's exclusive service lock.
2. Reconcile verified warm-runtime journals, then read persisted `queued`/`running`/`cancelling` tasks, without scheduling any new turns.
3. Validate each journal against the task/owner, machine identity, boot identity
   and Linux process start time. Never infer ownership from a PID alone.
4. Stop only the verified owned process session and verify no live members remain.
   A free execution lease is also required before closing a recovered task.
5. Mark it `interrupted` with `service_restarted`, expire pending approvals, preserve
   user input/partial output and native thread ID. **Never automatically replay it.**

重启后先独占数据目录，再验证遗留任务归属、机器和进程身份。只有确认原执行停止且租约
已释放，才标记中断、使审批过期。保留历史及原生会话，不自动重跑。

The launcher writes ownership **before exec**, so native code cannot start before
its journal exists. This addresses the crash between process spawn and saving its
PID in a database. A parent-death signal, inherited lease and process-session checks
provide additional layers; they do not authorize killing unrelated processes.

启动器在执行原生程序之前先持久化归属记录，避免“进程已启动、PID 尚未存入数据库”的
崩溃窗口。父进程退出信号、继承租约及进程会话检查共同用于安全收尾，不授权误杀其他进程。

## Blocked recovery / 恢复被阻塞

If the journal is invalid, a lease is held without verifiable ownership, a process
cannot be stopped, or the record belongs to another machine, new sends are blocked
and readiness is false. `lazyfish status` includes `execution.recovery_blocked` and
`execution.blocked_jobs` (IDs/status only). The page shows the same blocked notice.
No record or history is deleted as a workaround.

归属文件不完整、租约占用但无法验证、进程无法停止、记录来自其他机器时，暂停新发送。
`lazyfish status` 显示阻塞标志及相关任务编号，页面也会提示。不会通过删历史来绕过。

- Stop this installation using its supervisor/`lazyfish stop`, if still reachable.
- Verify the actual owner and whether its old execution is still running. Do not
  blindly kill the PID in a copied journal or manipulate task states/lock files.
- On the original machine, a normal restart can finish reconciliation once the old
  execution is confirmed stopped. Preserve private logs/journals for diagnosis.
- For backup/migration, stop the original installation first. Never run two
  machines against one live data directory. Foreign-machine records require manual
  operator review; there is intentionally no "force unlock" command in this preview.

先正常停止本实例，再由操作者核实旧执行归属及状态；不要盲目按记录 PID 杀进程或修改任务、
锁文件。确认停止后在原机器重启可再次收尾。迁移前先停原实例；异机记录需要人工核查，
当前故意不提供强制解锁按钮。
