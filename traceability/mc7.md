# Traceability: <Michael Chen> (mc7)

**Target feature:** API spending cap, found mainly in:
- packages/tui/src/component/dialog-session-max-cost.tsx
- packages/opencode/src/session/prompt.ts
- packages/core/src/session/runner/max-cost.ts
- packages/tui/src/app.tsx
- packages/core/src/session/max-cost-logic.ts

## Requirements

| ID | Interview evidence | Requirement | Acceptance Criteria | Changed in P4? | Property (kind) | Test |
|---|---|---|---|---|---|---|
| R1 |C-1: It'd be nice to continuously see…when you're getting close to the limit.” |When the current session cost gets close to the session cost limit (for the first time), output a warning message. |After the current session cost crosses 90% of the session cost limit, output the following message: “WARNING: 90% of session cost has been used” |No |Invariant |packages/core/test/max-cost-logic.test.ts |
| R2 |C-1: “If the limit is set below the current cost, I would probably expect it to immediately output the stop message.” |If the session cost limit is set below the current session cost, immediately output a limit-reached warning message. |If the user inputs a session cost limit of $5 when the current session cost is $10, output the message: “session will halt before its next step” |No |Invariant |packages/core/test/max-cost-logic.test.ts |
| R3 |C-2, S-3, O-2: "The limit should go back to the previous $5 limit…It's more intuitive for there to be an undo button than needing to set the limit again." |There should be an prevMaxCost (undo) command for reverting the session cost limit after a change is made to it. |If the session cost limit is $5, then the user sets it to $10, the user should be able to enter the prevMaxCost command, which will revert the maxCost to $5 and output a “Spending limit reverted to $5” message. |Yes |Round-trip |packages/core/test/max-cost-logic.test.ts |
| R4 |C-3, O-3, S-4: “I would generally want it to round down, especially with how touchy money can be.” |If the user inputs a session cost limit with more than two decimal places, the input should be accepted, and the cost limit should always round down. |If the user inputs a session cost limit of $4.999, then the cost limit should be rounded down and set to $4.99. |No |Metamorphic |packages/core/test/max-cost-logic.test.ts |
| R5 |O-4: “...there shouldn't be any error. The displayed cost or limit should be to the nearest cent.” |The current session cost tracker should be accurate to the nearest cent. |If a user starts with a prompt that results in a $4.99 Claude charge, the current session cost should display exactly “$4.99 spent”. |No |Oracle |packages/core/test/max-cost-logic.test.ts |

Properties written or suggested by opencode or another AI tool: R1-R5 were all aided by Claude

## Requirement changes

| ID | Original requirement (P3) | Revised requirement | Why it changed |
|---|---|---|---|
|R3 |There should be an undo button for reverting the session cost limit after a change is made to it.|There should be an prevMaxCost (undo) command for reverting the session cost limit after a change is made to it.|The undo button would require a more work than it's worth, as adding a temporary additional button on the toast log is not very supported by the existing framework. The prevMaxCost command is a simple replacement for the undo button that fulfills the user need of undoing a change to the max cost.|