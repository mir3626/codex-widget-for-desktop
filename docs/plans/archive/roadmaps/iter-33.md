## Iteration iter-33: VM Sandbox Adapter Boundary

Status: complete.

Carryover: `future_vm_session` existed as a runtime block; it needed an
adapter-shaped boundary for future Windows Sandbox, Hyper-V, RDP, and cloud
providers.

### iter-33-sprint-01-vm-sandbox-adapter-boundary

Goal: define adapter contracts, mock/local unavailable/dev boundaries, and
fail-closed smoke coverage.

Status: complete. Added `vmSandboxAdapter.ts`, adapter descriptors for mock,
Windows Sandbox, Hyper-V, RDP, and cloud, runtime boundary evidence, selected
adapter metadata, and `smoke:computer-use-vm-sandbox-adapter`.
