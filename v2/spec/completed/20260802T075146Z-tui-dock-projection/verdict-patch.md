1. Retain last-good run rows and pipeline snapshots across repeated refresh/reconnection failures, including ticks with no connected invoking client. They must not disappear merely because no client produced a result that tick.

2. Separate retained observations from live transport ownership. Stale rows must not advertise or execute kill/wait actions through a closed client. When ownership returns, a still-selected actionable run must resume its wait/actionable state.

3. Surface recoverable partial connection failures during initial multi-daemon admission when another client permits the monitor to open. Preserve the existing non-monitor failure path when no client succeeds, and clear dock errors only after a fully successful refresh.

4. Make the resolved machine profile an explicit, required `RunTuiEntryDeps` contract. Production entry must not recover it through a cast or silently substitute `unknown`; fixture-safe defaults belong only to projection state.

5. Expand tabs at four-column stops based on their painted physical row and window position, including after wrapping or horizontal windowing. Preserve cursor visibility, width bounds, and the unchanged buffer.

6. Make command-buffer projection linear-time. The current repeated prefix slicing/reduction is quadratic and can stall periodic rendering for large pasted buffers.

7. Complete the operator documentation with the required error lifecycle: discovery, connection, `list`, and `pipeline_list` failures retain last-good state; a fully successful refresh clears the error; refresh never clears a retained command result; RPC errors take display precedence.
