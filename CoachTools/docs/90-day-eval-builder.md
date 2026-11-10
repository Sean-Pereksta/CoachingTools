# 90 Day Eval Builder

Open **Data Building → 90 Day Eval Builder** in the Horizon desktop. Drop one Excel (`.xlsx` or `.xls`), CSV, or TSV report onto the page, or click to choose a file. A report with one evaluation table converts and downloads automatically. When several tables match, choose the one to export. The page retains a preview and a download button.

The Excel export is named **QA 90 Day Evals - Legacy.xlsx** so existing QA filename detection recognizes it reliably. The original 19 headers begin at **E1**, data begins at **E2**, and columns A–D remain blank. The export contains only the legacy layout. Employee ID, Queue ID, Adj Score, and Non-Performance are excluded. The source file stays unchanged and processing happens locally.

| Source header | Export header |
| --- | --- |
| Conversation ID | Conversationid |
| Date Hire | Hire Date |
| Conversation Start EST | Interaction Start Time |
| Conversation End EST | Interaction End Time |
| Queue Name | Queue |
| Assigned Date EST | Assigned Date |
| Changed Date EST | Changed Date |
| Score | Score % |

Genesys Evaluation ID, Agent Name, Team, Calibration Status, Agent Has Read, Evaluation Status, Evaluator, Evaluation Form, VDN, and Days Hired retain their names. The old header names are also accepted. Matching tolerates capitalization and spacing differences and does not depend on source column order.

Interaction Duration is calculated as end minus start, exported as `H:MM:SS` text for compatibility with the existing QA readers. Source timestamp text retains its clock time. Excel date cells are converted to date/time text without applying the computer's timezone. Score values are carried across without automatic rescaling; Excel percentage formatting is retained.

Missing or duplicate mapped columns prevent conversion and show the specific problem. Invalid, missing, or negative start/end times keep the evaluation in the file with a blank duration and show row notes. For a report with row notes, review the notes and click **Download Excel**. No row is removed because of a duration problem.

The existing Weekly Data Builder is in the same Data Building folder and keeps its existing workflow.
