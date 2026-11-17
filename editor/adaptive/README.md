# SAHM Adaptive Layout Data

This module is the server-side persistence foundation for the independent adaptive-layout system. It stores data only in the `SAHM-LAB` Git branch and never edits application HTML/CSS or the screen builder's local drafts.

## Data model

- `adaptive-data/profiles/{id}.json`: reusable responsive profiles and ordered rules.
- `adaptive-data/components/{id}.json`: reusable semantic component style definitions.
- `adaptive-data/assignments/{screenId}.json`: profiles/components assigned to a screen, explicit priorities, and per-screen overrides.
- `adaptive-data/history/{collection}/{id}/v{version}.json`: immutable revision snapshots.

A profile rule must target a stable editor element ID or a semantic role. Arbitrary CSS selectors and class-only targets are rejected. Style properties are allow-listed; computed-style snapshots are not accepted as the source of persisted rules.

## API

All routes are protected by the same Supabase-user/admin authorization used by the visual editor. Read and write requests are authenticated.

- `GET /api/adaptive/{profiles|components|assignments}`
- `POST /api/adaptive/{profiles|components|assignments}` with `id` and document fields
- `GET /api/adaptive/{collection}/{id}`
- `PUT /api/adaptive/{collection}/{id}` with `expectedVersion`
- `DELETE /api/adaptive/{collection}/{id}` with `expectedVersion` (soft archive)
- `GET /api/adaptive/{collection}/{id}/versions`
- `GET /api/adaptive/{collection}/{id}/versions/{version}`
- `POST /api/adaptive/{collection}/{id}/restore` with `version` and `expectedVersion`

## Write integrity

The current document and immutable revision are committed together through one Git data commit. Writes use a non-force branch update, retry branch-head conflicts, and recheck the expected record version before each attempt. This prevents silent overwrites and partial current/history updates.

The token remains server-side in Render. No local file-system writes, Supabase schema changes, or source-screen mutations are performed by this store.

## Current implementation boundary

This commit restores the server startup contract and provides tested persistence/API primitives. The adaptive-management controls and runtime resolver/preview are not yet connected to these endpoints; their UI and visual behavior must be implemented and verified in a separate pass before the full adaptive editor can be called complete.
