# Weekly Data Builder: manager groups and saved names

## Using the update

1. Upload an Opportunity/appointment report, a Wiper report, or both. In Add mode, the existing weekly file is optional: include it to append history, or leave it empty to create a new weekly CSV. The new unlabeled Opportunity layout is **Manager / Coach / Representative / Fiscal Period**, followed by the Commercial, Consumer, and Insurance statistics. The older three-column identity layout remains supported.
2. When a source has multiple dates, choose **one Source period**. Weekly reports are not silently added across different dates. Publication date is still the date written to new weekly rows.
3. Under **Saved managers & automatic name replacements**, review and select **Save detected manager groups**. Coach subtotal rows can supply the relationship, but manager/coach/grand subtotal rows are never representative statistics. Conflicting coach-to-manager assignments are shown for review rather than guessed. An absent coach in a partial export does not delete their saved assignment.
4. In **Clean Upload**, the **Managers — select their coaches** panel controls the existing source-specific coach checkboxes. Select or deselect a manager, then adjust individual coaches as needed. Only coaches present in each incoming source can be selected. A partially selected manager is shown as indeterminate; a manager with no available coaches is disabled. Manager selection is a shortcut for saving an explicit coach scope, not a promise to automatically include future staffing changes.
5. To replace a name automatically, choose Representative, Coach, or Manager; select/type the source name and preferred name; then select **Save replacement**. Rules may be edited, disabled, or deleted. The source reports remain unchanged. Changing a rule invalidates the preview, including Modify finalization, so it must be rebuilt before export.

## Matching and data safeguards

Explicit role-specific name rules are applied before new Opportunity/Wiper records are joined and before weekly Clean Upload/Update Data scope filtering. Case, spacing, typographic punctuation, and Last/First order are normalized for identity. Spelling is never guessed. Cyclic replacements and duplicate rule keys are rejected. A rule cannot silently assign one canonical coach to two different managers.

Opportunity supplies a representative's coach when available. Wiper-only representatives retain the coach from their own export. `COUNT_WIPERS_ACCEPTED` and `COUNT_WIPERS_OFFERED` are distinct columns; the `COUNT` prefix does not override `OFFERED`.

Without a previous weekly file, Add creates Date, Sheet, Name, Manager, standard appointment/wiper columns, and extra supplied fields. New rows from both sources are sorted together by coach, then representative; rows without a source coach appear last. The preview uses those same coach groups. Wiper-only uploads include all valid wiper rows even if the unmatched-wiper option was previously off. Source statistics that were not supplied remain blank.

When a previous weekly file is supplied, Add preserves historical cells and header order and appends the sorted new batch. Manager is filled when the existing weekly template already includes a Manager column; a new column is not injected into an old template. The saved manager directory is independent of that CSV column. Modify still requires the weekly file being changed and at least one source report. A wiper-only Modify leaves coach and manager history untouched. Modify matches date and normalized name, then uses coach to resolve repeated names; ambiguous records are held for review rather than using the first row. Explicit zero values remain zero and missing statistics remain blank. Existing Finalize Modify export gating is unchanged.

The separate All-Star monthly import calculations and other dataset-specific ownership spellings are not rewritten by weekly name rules. Existing Clean Upload fallback and per-source routing remain authoritative.

## Persistence and privacy

Only the small settings object is stored: version, revision, explicit name rules, and Manager/Coach links. No report statistics or uploaded files are stored by this feature. IndexedDB is used when available, with a small localStorage compatibility mirror/fallback. Storage failures are shown; the UI does not report a successful save when both persistence paths fail.

Settings belong to the current browser profile/origin. Browser data clearing, private browsing, another computer, or opening a different local-file origin can make them unavailable. Use **Settings backup / transfer → Export settings** and **Import settings** to transfer a JSON backup. Keep CoachTools' local support scripts with the application. Reset Workspace clears report inputs, not saved settings.

## Tests

Run `node --test tests/weekly-data-builder-manager-settings.test.cjs` from the repository root. Tests use synthetic names/statistics and the actual inline WeeklyCore engine. Uploaded production CSVs are not committed.

Run `npm run test:weekly-integrity` from `CoachTools` for source combinations, optional history, generated weekly columns, coach sorting/grouping, export round trips, name formatting, and readiness checks.
