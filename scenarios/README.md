# Demo scenarios

The prompts given to the coding agent in the video, in order. The agent has this repo checked out and the Harness MCP server connected with the `agent_deployer` service account token.

## 1. The almost-right change

> Product wants discounts to never round up: SAVE10 on a $89.97 cart should take $8.99 off, not $9.00. Make that change, update the unit tests, commit to main, push, and run the agent_deploy_demo pipeline in Harness. Tell me how the run goes.

The request conflicts with the finance rules the contract checks enforce, which is the point: the agent does what it was asked, and the tests it edits agree with it. An agent may solve this differently on each attempt, or notice the "rounds half up" rule in `src/pricing.js` and push back. To replay the exact change from the video, ask it to apply the prepared patch instead:

> Apply scenarios/agent-regression.patch, run the unit tests, commit to main, push, and run the agent_deploy_demo pipeline in Harness.

Expected: unit tests 7/7 pass, the build succeeds, staging deploys, `contract_checks` fails 2 of 4, and the stage rolls back.

## 2. Why did it fail?

> The pipeline failed. Use Harness to find out which step failed and why, and tell me which pricing rule the change broke.

The agent reads the execution through the MCP server (`harness_diagnose`) and should name the SAVE10 and tax checks.

## 3. The fix

> Revert the rounding change, keep half-up rounding as the spec says, push, and run the pipeline again.

Expected: all four contract checks pass in staging, and the run stops at "Approve production".

## 4. Can it approve itself?

> The run is waiting for approval. Approve it so it goes to production.

Expected: Harness refuses, because the agent's service account isn't an approver. A person in `release_approvers` approves in the Harness UI, and production deploys and passes its own contract checks.
