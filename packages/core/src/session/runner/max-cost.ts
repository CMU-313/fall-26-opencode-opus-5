export const MAX_COST_PROMPT = `CRITICAL - COST LIMIT REACHED

This session's configured cost cap has been reached before this step could run. No further model calls were made for this task.

This message was generated locally, not by the model, so there is no summary of "work accomplished this step" to give — the cap was enforced before any provider request for this step was sent.`