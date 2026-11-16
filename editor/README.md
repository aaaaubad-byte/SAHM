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
GitHub branch sync, screenshots, import/apply engine, automatic functional wiring, and isolated Supabase credentials. Session persistence is currently local (IndexedDB, with localStorage fallback) until a protected server-side GitHub adapter is configured. The single available Supabase project is not changed by this editor pass.

## Import contract
Every session records its base commit, branch, screen, before/after component trees, operations and source locators. An importer must compare the requested session with the target source revision, detect conflicts, apply narrow source patches, connect newly-added actions to existing routes/data/RPCs as required, and run functional tests before calling a change fully imported.
