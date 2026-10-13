# `@ue-shed/ui`

Shared SolidJS primitives for maintained UE Shed interfaces. Components use semantic variables from
`@ue-shed/ui-theme`; extensions keep product-specific composition and layout local.

## Tools and popovers

- `ToolButton` is a 30px tool. Icon-only tools show a tooltip led by `label` on hover and keyboard
  focus; pointer presses and focus returning from a closed popover do not open it. `showLabel`
  renders the label as text for primary controls, and its tooltip then shows only `tooltip`, if
  provided. `badge` is visual; its value, or `badgeLabel`, is appended to the accessible name
  ("Filter, 3 active"). Disabled tools still explain themselves on hover.
- `AnchoredPopover` light-dismisses on outside pointer or focus and on Escape. Content that consumes
  Escape or navigation keys (a submenu closing itself) calls `preventDefault` or
  `stopPropagation`; the popover only handles keys nobody inside it has handled. Text fields keep
  caret keys; a search field hands Up/Down to the list.
- `InvestigationActions` reports results in one reserved slot (floating under compact tools), so
  results never move neighbouring controls. Failures use `role="alert"`; compact disabled reasons
  belong in the export tool's tooltip. `showLabels` names compact Export and Presets beside their
  icons, for toolbars whose other commands are named.
