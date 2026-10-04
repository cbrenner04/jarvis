# Expose bulk terminal run dismissal through the daemon

Additive bulk selector on the daemon `dismiss` request, delegating terminal selection to the existing store method.

- [x] [00-bulk-dismiss-daemon-request.md](./00-bulk-dismiss-daemon-request.md) — `dismiss` accepts exactly one of `runId` or `project`, delegates bulk terminal dismissal to the store, returns the dismissed-row count.
