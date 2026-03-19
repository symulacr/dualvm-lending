# OMP Widget Parity Change State Before

Date: 2026-03-17
Workspace: `/home/kpa/polkadot`
Target runtime: `/home/kpa/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent`
Reference upstream: `/tmp/pi-mono`

## Backups

Backups captured before edits in:
- `OMP_WIDGET_PARITY_BACKUP_20260317/`

Files backed up:
- `extensions-types.ts`
- `rpc-types.ts`
- `rpc-mode.ts`
- `modes-types.ts`
- `interactive-mode.ts`
- `extension-ui-controller.ts`
- `pi-autoresearch-index.ts`

## Current broken behavior

1. Interactive `setWidget()` is routed through `setHookWidget()` and stringified into status-line hook text.
2. `setWidget(undefined)` renders the literal text `undefined`.
3. Factory widgets render as function source text instead of UI components.
4. `string[]` widgets collapse into a single comma-joined string.
5. RPC widget schema lacks upstream placement metadata.
6. `pi-autoresearch` listens to `session_fork` instead of `session_branch`, so branch rebuild is wrong.

## Current implementation points

- OMP interactive widget bug:
  - `/home/kpa/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent/src/modes/controllers/extension-ui-controller.ts`
- OMP widget types:
  - `/home/kpa/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent/src/extensibility/extensions/types.ts`
- OMP RPC widget schema/runtime:
  - `/home/kpa/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent/src/modes/rpc/rpc-types.ts`
  - `/home/kpa/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent/src/modes/rpc/rpc-mode.ts`
- OMP interactive layout/types:
  - `/home/kpa/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent/src/modes/types.ts`
  - `/home/kpa/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent/src/modes/interactive-mode.ts`
- Autoresearch extension:
  - `/home/kpa/.omp/agent/extensions/pi-autoresearch/index.ts`

## Upstream parity slice to port

From `/tmp/pi-mono/packages/coding-agent/src/modes/interactive/interactive-mode.ts`:
- dedicated widget containers above/below editor
- keyed widget maps
- widget render/clear/dispose logic
- `setWidget(..., options?)` wiring

From `/tmp/pi-mono/packages/coding-agent/src/core/extensions/types.ts`:
- `WidgetPlacement`
- `ExtensionWidgetOptions`
- `setWidget(..., options?)` overloads

From `/tmp/pi-mono/packages/coding-agent/src/modes/rpc/rpc-types.ts` and `rpc-mode.ts`:
- RPC `widgetPlacement` field
- RPC `setWidget(..., options?)` handling for string-array widgets

From upstream extension examples:
- `widget-placement.ts`
- `plan-mode/index.ts`
- `.pi/extensions/prompt-url-widget.ts`

## Intended implementation scope

Focused parity slice only:
- widget API/types
- interactive widget containers and rendering
- RPC widget placement support
- autoresearch event typo fix

Out of scope for this change:
- full footer parity
- full header parity
- full custom editor parity
