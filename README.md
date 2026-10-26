# QA Bug Tracker

## Firebase cloud access setup

The tracker requires the allowlisted, verified Firebase user to read or write cloud data. The app has no public sign-up flow. The allowlisted account automatically gets Admin mode after sign-in so all saved features appear without a separate in-app password.

1. In Firebase Console for project `qa-bug-tracker-b1d32`, enable **Authentication → Sign-in method → Email/Password**.
2. Create the trusted user under **Authentication → Users**. The published rules currently allow only `onkar.joshi@infoteksoftware.com`; update the email in [`firestore.rules`](./firestore.rules) to change the allowlist.
3. Publish the rules in [`firestore.rules`](./firestore.rules) under **Firestore Database → Rules**.
4. Sign in through the app. If the account has not verified its email yet, the app sends a verification link and requires another sign-in after verification.

The app stores all customers in the single `pocTracker/mainData` document. Every email explicitly allowlisted by these rules can read and change all data in that document. Firestore rules are the access-control boundary; the in-app Admin mode only controls which management actions the interface displays.

When loading existing Firestore data, the app accepts customer records stored as maps or JSON strings and skips blank array entries. If non-empty entries are not recognized, cloud writes are paused to avoid overwriting data the app could not parse.

## Feature and module terminology

- A top-level **Feature** contains **Modules**; each module contains test cases.
- Dashboard execution counts and summaries are per module, with the parent feature shown alongside it.

## Excel imports and test execution

- The file picker accepts any file, but imports require a spreadsheet format supported by the importer. Imported table headers follow the sheet's column names. The importer searches the first 20 rows for the header row, allowing a title row above the column names. `Status` is required on every sheet; uploads without it are rejected. An upload must target an existing feature and appends all workbook rows to one module named after the file inside that feature. Uploads never create new features or split rows by the `Feature` or `Module` column; worksheets in the same workbook are combined into that module.
- `Sr. No.` (or `Test No.`) values control the displayed test-case order and start a test case. Following rows with a blank serial number are merged into that test case, with non-empty cell values joined on separate lines; the continuation rows do not create extra test cases. Repeated serial values remain separate test cases, and a continuation row does not replace the test case's status.
- Each test-case row shows its own status in the Status column. The status, module, and search filters can be used to find matching cases.
- `Sr. No.` and `Test No.` cells can be edited inline; edited values are saved and the table re-sorts by the updated number.
- `Partially Pass` is available as a test-case status and is shown in red, like `Fail`.
- `Not Applicable` is available as a test-case status and uses the same gray styling as `Not Executed`. It counts as complete for execution, but is excluded from the pass-rate denominator.
- All imported Excel columns are shown in the test-case table, including `Test Scenario`.
- Table columns automatically size to their longest text without a fixed width cap and recalculate on render and after cell edits. Headers can also be dragged to temporarily adjust widths; automatic sizing applies again on the next render.
- Test-case table column headers remain sticky while scrolling vertically through a module; the bottom scrollbar proxy continues to control horizontal table movement.
- The dashboard's module summary counts only test cases with a populated `Sr. No.` (or `Test No.`), excluding continuation rows and repeated header rows.
- Admin users can add or delete non-required columns.
- Admin users can rename a feature with **Edit Feature**; renaming keeps its existing access link and modules.
- Test execution must be started with **Start Execution**. It completes automatically when every test case is marked Pass, Fail, or Blocked.
- The hierarchy is Feature → Module → Test Case. The dashboard summarizes each module's test-case count, execution percentage (cases no longer Not Executed), pass percentage (Pass among final-status cases), and failure count.
- Dashboard module counts treat each module as one item: not started, currently under test, or completed. Click a module-status count to see matching modules grouped by feature.
- The dashboard's Module Execution Summary can be filtered to one feature using its Feature dropdown; the All Features option restores the complete table.