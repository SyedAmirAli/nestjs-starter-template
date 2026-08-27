# Agent instructions

- Do not write test files (e.g. `*.spec.ts`, `test/*.e2e-spec.ts`). Do not create, scaffold, or
  modify tests unless the user explicitly asks for tests in that specific message.

- Admin list tables: the ⋮ (three-dot) row-actions menu is the **first data column** — left side
  of every row, immediately after any row-selection checkbox. Use `actionsColumn` /
  `RowActions` from `web/src/components/RowActions.tsx`. That helper always appends **Copy ID**
  to the menu; do not reimplement the ⋮ cell or omit Copy ID on a new table.

- **Any page that displays a list of data (table or list view) follows this exact system —
  don't hand-roll search/pagination/sort again.** Reference implementation:
  `web/src/pages/UsersPage.tsx` + `web/src/routes/_authenticated/users.tsx`. It's the worked
  example for every point below; copy its shape for a new list page rather than inventing a new
  one.

  **The rule that matters most: every control's state is a URL search-query parameter, never
  local `useState`.** Page, page size, sort, search text, and every filter (status, role, date
  range, …) live in the URL, so a reload, a shared link, or the back button reproduces the exact
  same view. This is non-negotiable — a list page with a search box that resets on refresh is a
  bug, not a style choice. Wire it as:
  - Route file: `validateSearch: <a function built on validateListSearch>` from
    `web/src/lib/listQuery.ts`. Extend `ListSearch` per-route for extra filters:
    `type FooSearch = ListSearch & { role?: UserRole }` (see `routes/_authenticated/users.tsx`).
  - In the route's component: `const search = Route.useSearch()` and
    `const onSearchChange = makeSearchPatcher(useNavigate({ from: Route.fullPath }))` — both from
    `listQuery.ts`. Pass `search`/`onSearchChange` down as props to the page component. Do this
    in the route file, not the shared page — TanStack types `useNavigate` against a *literal*
    route path, and hoisting it into shared code widens that type to `string` and loses the
    search-param types.
  - No paginated endpoint for this data (an array embedded in a parent payload, a small static
    list)? Use `useClientList` from `web/src/lib/useClientList.ts` instead — same `search` /
    `onSearchChange` / `rows` / `total` contract, driven by local state over an in-memory array.

  **The table itself is `ListTable`** (`web/src/components/ListTable.tsx`), which bundles the
  full house standard so no page reimplements it:
  - A gear icon opening a **column show/hide toggle** (checkbox per column).
  - A **page-size `Select`** ("Select N in single page").
  - A **search `Input` + explicit Search button** (not search-as-you-type — the box holds a
    draft until Search is pressed or Enter hit).
  - Extra **filter controls** (role, status, date range, …) via the `filters` prop, each one a
    plain antd `Select`/etc. reading `search.<field>` and calling
    `onSearchChange({ <field>: value, page: undefined })` — resetting `page` on any filter
    change so a stale page number doesn't strand the view.
  - A **primary top-right action** (e.g. "Create X") via the `primaryAction` prop.
  - Sortable column headers wired to `orderBy`/`order` automatically.
  - Plain string/number cells get single-line ellipsis + hover tooltip for free
    (`EllipsisText`, `web/src/components/EllipsisText.tsx`) — don't hand-write `.slice()` or
    ad-hoc `Tooltip` wrappers for long cell text.
  - A verbose footer: **"N entries (Showing X items on page Y of total Z pages)"** plus an antd
    `Pagination` control. Keep that exact footer wording — it's the house standard, not
    boilerplate to trim.
  - Optional bulk-selection bar via `bulkBar` (adds row checkboxes) and `onRowClick` for
    "click a row to edit".

  **Row-level conventions, composed into `columns` (`ListTable` doesn't own these):**
  - `actionsColumn` / `RowActions` (above) for the ⋮ menu, always first.
  - An **Active/Inactive column** is a live `Switch`, not a static tag — use `activeColumn` from
    `web/src/components/ActiveColumn.tsx`, which also swallows the cell click so toggling never
    also fires `onRowClick`.

  **Page header:** `PageHeader` (`web/src/components/PageHeader.tsx`) above the table — a title
  (plain text, or a node with a `Tag` badge next to it for a category label) and an optional
  description. Pass a **string** description for anything more than a one-liner: it renders
  through `PageDescription` (`web/src/components/PageDescription.tsx`) as a collapsible Markdown
  guide (first two lines + "Show more"/"Show less"), sanitized by `Markdown`
  (`web/src/components/Markdown.tsx`) — never render untrusted description text with
  `dangerouslySetInnerHTML` anywhere else.

  **AI-assisted fill/translate on a form** (if the page needs it): `AiAssistPanel`
  (`web/src/components/AiAssistPanel.tsx`) — a chat drawer with per-field Inject/Regenerate and
  an optional language toggle. It takes a plain `onSend` callback rather than calling a fixed
  endpoint itself, so wire it to whatever AI route the feature actually has.
