# Datasets Page UI Redesign

The current datasets list and detail pages have several usability issues: cramped layout, unintuitive upload flow, raw JSON editing in tiny textareas, no search/filtering, and poor visual hierarchy. This redesign addresses all of these while staying consistent with the existing NorthStar design system (green accent palette, `ns-` component classes, mono fonts for data).

## Current Problems

### Datasets List Page
- Upload button is a small dashed-border element in the header - easy to miss
- No drag-and-drop zone visible on the page body
- Table rows are dense with no visual separation or scan-ability
- Action buttons (Run, Open, Delete) are cramped inline buttons with no labels
- Empty state is minimal - just an icon and one line of text
- No search or filtering for datasets
- Format/size/cases shown as raw monospace text with no visual weight

### Dataset Detail Page
- Spreadsheet-style table forces a 1160px minimum width with 8 columns
- Raw JSON editing in tiny textareas is unusable for complex objects
- The fixed 300px sidebar wastes space when you need to focus on data editing
- No row expansion or detail preview - everything is inline
- Validation errors appear only at the bottom and are easy to miss
- No keyboard shortcuts for save/revert

## Proposed Changes

### Datasets List Page

#### [MODIFY] [page.tsx](file:///Users/sidmanale/Development/northstar/dashboard/app/(workspace)/projects/[projectId]/datasets/page.tsx)

Replace the current page with a redesigned version:

1. **Full-page drop zone**: The entire page body becomes a drag-and-drop target. When dragging, a full-page overlay with dashed border and upload icon appears with a smooth fade animation.

2. **Header redesign**: Clean header with title/description on the left. Right side has a search input (filters datasets by name/filename) and a prominent "Upload dataset" button using `ns-button ns-button-primary` styling.

3. **Dataset cards instead of dense table**: Replace the cramped table with a card-based list. Each card shows:
   - File icon + dataset name (clickable link) + filename subtitle
   - Format badge (pill-style), case count, file size, created date - as labeled stat pills
   - Right-aligned action area with "Run eval" and "Open" buttons, plus a subtle delete icon
   - Bottom border separator between cards

4. **Rich empty state**: When no datasets exist, show a large centered illustration area with:
   - Database icon in a soft green circle
   - "No datasets yet" heading
   - Description text explaining supported formats
   - Prominent upload button
   - List of supported formats as small pills (JSON, JSONL, CSV, XLSX)

5. **Search**: Add a search input that filters datasets by name and filename in real-time.

---

### Dataset Detail Page

#### [MODIFY] [page.tsx](file:///Users/sidmanale/Development/northstar/dashboard/app/(workspace)/projects/[projectId]/datasets/[datasetId]/page.tsx)

Replace with a redesigned version:

1. **Collapsible metadata sidebar**: Replace the fixed 300px sidebar with a collapsible info panel. Toggle between full-width data editor and side-panel view. Default to full-width for more editing space.

2. **Row-based card layout instead of spreadsheet**: Replace the wide table with a vertical list of row cards. Each card shows:
   - Row number and ID as the card header
   - Fields displayed as labeled sections within the card
   - `input` shown as a full-width text input
   - JSON fields (`messages`, `expected`, `metrics`, `metadata`) shown as collapsible sections with a code editor-style monospace block
   - Delete button in the card header
   - Visual dirty-state indicator (left border turns amber when unsaved changes exist)

3. **Inline JSON validation**: Show validation errors directly on the field that has the error, with a red border and error message beneath the field, instead of a single error bar at the bottom.

4. **Sticky toolbar**: The action bar (Add row, Revert, Save) stays sticky at the top of the scroll area so it is always accessible. Include a dirty-state badge showing "X unsaved changes".

5. **Keyboard shortcuts**: `Cmd+S` to save, `Cmd+Z` to revert (when focused in the editor area).

6. **Metadata drawer**: The dataset info (format, cases, size, created) and run history move to a slide-out drawer toggled by an info button in the header. This frees horizontal space for the editor.

---

## Verification Plan

### Manual Verification
- Load the datasets list page with 0 datasets - verify the empty state renders correctly
- Upload a dataset via the button and via drag-and-drop - verify both flows work
- Load the page with multiple datasets - verify search filtering works
- Open a dataset detail page - verify row cards render correctly
- Edit a field, verify dirty state indicator appears
- Save changes, verify the save flow works
- Test delete on both list and detail pages
- Verify responsive behavior at different viewport widths

### Build Verification
- Run `npm run build` to verify no TypeScript errors
