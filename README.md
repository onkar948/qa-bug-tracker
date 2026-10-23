# QA Bug Tracker

## Feature and module terminology

- A top-level **Feature** contains **Modules**; each module contains test cases.
- Dashboard execution counts and summaries are per module, with the parent feature shown alongside it.

## Excel imports and test execution

- Imported table headers follow the Excel sheet's column names. The importer searches the first 20 rows for the header row, allowing a title row above the column names. `Status` is required on every sheet; uploads without it are rejected.
- `Sr. No.` (or `Test No.`) values control the displayed test-case order.
- Column resizing is available by dragging a table header's right edge. Admin users can add or delete non-required columns.
- Test execution must be started with **Start Execution**. It completes automatically when every test case is marked Pass, Fail, or Blocked.
- The hierarchy is Feature → Module → Test Case. The dashboard summarizes each module's test-case count, execution percentage (cases no longer Not Executed), pass percentage (Pass among final-status cases), and failure count.
- Dashboard module counts treat each module as one item: not started, currently under test, or completed. Click a module-status count to see matching modules grouped by feature.
