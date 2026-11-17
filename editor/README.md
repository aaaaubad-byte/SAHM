# SAHM Visual Editor — first client implementation

The editor is added only to the isolated \`SAHM-LAB\` branch. It does not replace the current screen templates or app business modules.

## Modules
- \`core.js\`: stable runtime element IDs, source locators, visual/structural snapshots, undo/redo and per-session IndexedDB persistence.
- \`ui/layers.js\`: nested independently selectable element tree and same-parent drag ordering.
- \`ui/inspector.js\`: independent visual property inspector for typography, color, dimensions, spacing, layout and text.
- \`bootstrap.js\`: edit-mode toggle, direct selection, add/duplicate/delete, operation recording and session UI.
- \`editor.css\`: styles isolated from Sahm's normal UI.
- \`session.schema.json\`: versioned session interchange contract.

## Implemented in this pass
Selection, hover outline, element tree, property inspector, leaf text editing with explicit static-text confirmation, image src/alt editing, add text/heading/button/card/image/divider, duplicate, delete, same-parent reorder, undo/redo, before/after structural+visual snapshots, operation list, component source map, local session history and JSON export.

A newly added button is marked as pending and receives no invented business action. Structural snapshots omit input values and unedited dynamic text. The HTML source is loaded through separate editor modules; no application screen template is replaced.

## Not yet enabled
Screenshots, import/apply engine, automatic functional wiring, a separate Supabase test project, and Render server deployment/secrets are not yet enabled. Local session persistence uses IndexedDB (with localStorage fallback). A protected Node server adapter exists in `editor/server.js`; actual branch sync requires Render environment variables `GITHUB_TOKEN`, `SAHM_EDITOR_ADMIN_IDS` (or `SAHM_EDITOR_ADMIN_EMAILS`), `SUPABASE_URL`, and `SUPABASE_PUBLISHABLE_KEY`. `GITHUB_TOKEN` must be a fine-grained token limited to this repository with Contents read/write and must be configured only in Render's secret environment settings. No credential belongs in the client or repository. The single available Supabase project is not changed by this editor pass.

## Import contract
Every session records its base commit, branch, screen, before/after component trees, operations and source locators. An importer must compare the requested session with the target source revision, detect conflicts, apply narrow source patches, connect newly-added actions to existing routes/data/RPCs as required, and run functional tests before calling a change fully imported.

## Adaptive screen builder
The **منشئ الشاشات** tool creates an independent screen model instead of cloning or inheriting the currently rendered application DOM or computed CSS. New elements use intrinsic, flexible sizing, content wrapping, responsive grid/flex containers, bounded images and natural content height. The builder supports 320px, 360px, 430px and 768px preview widths, nested containers/cards, element properties, layer selection/reordering, undo/redo, local draft persistence, and standalone HTML export. Exported screens are visual prototypes only; application routes, data bindings and business actions must be mapped and reviewed before integration.
