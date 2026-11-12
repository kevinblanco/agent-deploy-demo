# agent-deploy-demo

A coding agent can start this Harness pipeline. It can't edit the pipeline, can't see the cluster credentials, and can't approve its own release to production.

This repo is the build behind the video "Your Agent Can Deploy Now. Should It?" The app is deliberately small; the pipeline is the subject.

## What runs

`cart-pricing` is a Node.js API that prices a shopping cart: subtotal, discount code, tax, all in integer cents. The pipeline has four stages:

```
agent (Harness MCP server) ──▶ 1. Build          unit tests, image to Docker Hub (Harness Cloud)
                               2. Staging        rolling deploy ──▶ contract checks ──fail──▶ automatic rollback
                               3. Approval       a person in release_approvers, never the run's executor
                               4. Production     the build staging verified ──▶ contract checks ──fail──▶ rollback
```

Each rule below is enforced by Harness, so it holds even when the agent is confident:

| Rule | How Harness enforces it |
|---|---|
| The agent acts through the pipeline, with a token that can run it and nothing else. | A service account with the built-in **Pipeline Executor** role. The cluster credentials stay on the delegate inside the cluster; the agent never holds a kubeconfig. |
| Behaviour is checked against rules the agent didn't write. | The `contract_checks` step runs live HTTP checks against each deployment. A failure fails the stage, and the stage's failure strategy rolls it back. The script is inline in the pipeline, so editing a file in this repo doesn't change the gate. |
| Production waits for a person. | The approval accepts only the `release_approvers` user group. A service account can approve only when an approval step lists it under `serviceAccounts` ([docs](https://developer.harness.io/harness-platform/use-harness-platform/approvals/adding-harness-approval-stages)); this one lists none. `disallowPipelineExecutor` also blocks whoever started a manual run. |

## The failure it catches

`scenarios/agent-regression.patch` is a scripted version of a common agent mistake, kept here so the demo replays the same way every time. Asked to stop discounts rounding up, the agent switches the shared rounding helper from half-up to truncation and edits the unit tests to agree with the new numbers.

| | Original | After the agent's change |
|---|---|---|
| Unit tests | 7 / 7 pass | 7 / 7 pass |
| Contract checks | 4 / 4 pass | 2 / 4 fail |
| SAVE10 on $89.97 | $9.00 off | $8.99 off |
| Total with 8.25% tax | $87.65 | $87.66 |

The change was meant to save money and it raised the customer's total by a cent. The unit tests agreed with it because the agent rewrote them. In Harness the staging stage fails at `contract_checks` and rolls back to the last good release, and production is never reached.

## Run it locally

Needs Node.js 22 or later, bash and curl.

```bash
npm test                               # unit tests
npm start                              # API on :8080
npm run contract                       # contract checks against :8080, in a second terminal
git apply scenarios/agent-regression.patch && npm test   # still green
# restart the server, run the contract again: 2 checks fail
git apply -R scenarios/agent-regression.patch
```

`contract/contract-check.sh` is the same script the pipeline runs. Set `EXPECTED_VERSION` to make it wait until that build is the one answering.

## Set it up in Harness

The YAML in `.harness/` is v0 ("classic") Harness YAML for the `default` org and `default_project`. Secrets and connectors are referenced by ID only; no values are stored here.

1. **Fork, then put in your names.** The YAML uses `kevinblanco` for both the GitHub and the Docker Hub account. Replace it in `.harness/` and `.github/` (`connectors/github.yaml` and `CODEOWNERS` take your GitHub name; `connectors/dockerhub.yaml`, `service.yaml` and `pipeline.yaml` take your Docker Hub name).
2. **Secrets** (Project Setup → Secrets → Text): `github_pat` (classic PAT with `repo`, `user`, `admin:repo_hook`) and `dockerhub_pat` (Docker Hub access token, read and write).
3. **Cluster and delegate.** A local cluster (`k3d cluster create harness-demo`), namespaces `staging` and `production`, and a Helm delegate named `k3d-delegate` (Project Setup → Delegates → New Delegate → Helm; Harness generates the install command).
4. **Entities**, pasted into each create dialog's YAML view, in this order: `connectors/github.yaml`, `connectors/dockerhub.yaml`, `connectors/k3d-cluster.yaml`, `service.yaml`, `env-staging.yaml`, `env-production.yaml`, `infra-staging.yaml`, `infra-production.yaml`, `pipeline.yaml`, then optionally `trigger-push-main.yaml`.
5. **People and tokens.** A user group `release_approvers` with the humans who sign off production. A service account `agent_deployer` with the **Pipeline Executor** role, and an API token for it. That token goes to the agent; it is the only Harness credential the agent gets.
6. **The agent.** Add the [Harness MCP server](https://github.com/harness/mcp-server) to your coding agent with the service account token as `HARNESS_API_KEY`, `HARNESS_ORG=default` and `HARNESS_PROJECT=default_project`.

The first run must deploy a good build, so a later rollback has a release to return to.

The push trigger ships disabled. In the demo the agent starts each run itself, and an enabled trigger would start a second run for the same commit.

## Files

| Path | What it is |
|---|---|
| `src/pricing.js`, `src/server.js` | The API: `GET /healthz`, `GET /version`, `POST /quote` |
| `test/` | Unit tests. Anyone can edit these, agents included. |
| `contract/contract-check.sh` | The finance rules as live HTTP checks; the pipeline carries its own copy |
| `deploy/` | Kubernetes manifests (Go templates) and `values.yaml` with Harness expressions |
| `.harness/` | Pipeline, service, environments, infrastructure, connectors and trigger |
| `scenarios/agent-regression.patch` | The bad change used in the demo |
| `.github/CODEOWNERS` | Human owners for `contract/`, `.harness/` and `.github/` when changes go through pull requests |

## Known limits

- Policy as code (OPA) isn't on the Harness Free plan, so the gates here are pipeline steps and access control.
- Harness applies `disallowPipelineExecutor` to manual runs, not to webhook triggers. On trigger runs, membership of `release_approvers` is the control.
- The contract lives in two places: the pipeline (the gate) and `contract/` (for local runs). A person changes both together.
- The build targets Arm64 because the demo cluster runs on an Apple Silicon Mac. Set `arch: Amd64` in `pipeline.yaml` for an x86 cluster.
- Written for the Harness Free plan as of November 2026.
