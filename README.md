# agent-deploy-demo

A coding agent can start this Harness pipeline. It can't edit the pipeline, can't change what gets deployed, can't reach the cluster, and can't approve its own release to production.

This repo is the build behind the video "Your Agent Can Deploy Now. Should It?" The app is deliberately small; the pipeline is the subject.

## What runs

`cart-pricing` is a Node.js API that prices a shopping cart: subtotal, discount code, tax, all in integer cents. The pipeline has four stages:

```
agent (Harness MCP server) ──▶ 1. Build          unit tests, image to Docker Hub (Harness Cloud)
                               2. Staging        rolling deploy ──▶ contract checks ──fail──▶ automatic rollback
                               3. Approval       a person in release_approvers, never the run's executor
                               4. Production     the build staging verified ──▶ contract checks ──fail──▶ rollback
```

Each rule below is enforced by Harness or Kubernetes, so it holds even when the agent is confident:

| Rule | How it's enforced |
|---|---|
| The agent acts through the pipeline, with a token that can run it and nothing else. | A service account with the built-in **Pipeline Executor** role. It can view, run and abort pipelines. Harness refuses its edits to the pipeline, the service, connectors and File Store files (`403 Missing permission core_pipeline_edit`, `core_service_edit`, `core_connector_edit`, `core_file_edit`). |
| The agent changes the code that gets built, not what gets deployed. | The Kubernetes manifests and values live in the Harness **File Store**, not in Git. A push only changes the app image, so the agent can't add objects to the cluster or put a `<+secrets...>` expression in a values file. |
| The stage without a human gate can't touch production. | One classic delegate per environment, each in its own namespace, bound to the `edit` role in exactly one app namespace. No delegate has cluster-wide rights, and the agent never holds a kubeconfig. |
| Pods run locked down. | Both app namespaces enforce Pod Security `restricted`. The Deployment runs as UID 1000 with no privilege escalation, no capabilities, a read-only filesystem and no service-account token. |
| Behaviour is checked against rules the agent didn't write. | The `contract_checks` step runs live HTTP checks against each deployment. A failure fails the stage, and the stage's failure strategy rolls it back. The script is inline in the pipeline, so editing a file in this repo doesn't change the gate. |
| Production waits for a person. | The approval accepts only the `release_approvers` user group. A service account can approve only when an approval step lists it under `serviceAccounts` ([docs](https://developer.harness.io/harness-platform/use-harness-platform/approvals/adding-harness-approval-stages)); this one lists none. `disallowPipelineExecutor` also blocks whoever started a manual run, and Harness counts the agent's API runs as manual. |

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

1. **Fork, then put in your names.** The YAML uses `kevinblanco` for both the GitHub and the Docker Hub account. `connectors/github.yaml` and `CODEOWNERS` take your GitHub name; `connectors/dockerhub.yaml`, `service.yaml` and `pipeline.yaml` take your Docker Hub name.
2. **Secrets** (Project Settings → Secrets → Text):
   - `github_pat`: a fine-grained GitHub token for this one repository with **Contents: read-only**. It's only used to clone. Add Webhooks read and write if you turn on the push trigger.
   - `dockerhub_pat`: a Docker Hub access token with read and write.
3. **Cluster, namespaces and Pod Security.** Each app namespace enforces `restricted` and gives its own delegate the `edit` role there:
   ```bash
   k3d cluster create harness-demo
   for env in staging production; do
     kubectl create namespace $env
     kubectl label namespace $env pod-security.kubernetes.io/enforce=restricted pod-security.kubernetes.io/warn=restricted
     kubectl -n $env create rolebinding harness-$env-delegate-edit --clusterrole=edit --serviceaccount=harness-$env:k3d-$env-delegate
   done
   ```
4. **Two classic delegates**, one per environment. New accounts are offered Delegate 3.x, which in November 2026 rejects the classic deploy tasks this pipeline uses (`DOCKER_ARTIFACT_TASK_NG Task type not supported by delegate(s)`), so install the classic one with the official Helm chart. `NAMESPACE_ADMIN` keeps the chart from creating its default cluster-admin binding. Use a delegate token from Project Settings → Delegates; your account ID is in any Harness URL:
   ```bash
   helm repo add harness-delegate https://app.harness.io/storage/harness-download/delegate-helm-chart/
   printf 'Delegate token: '; read -s DT; echo
   for env in staging production; do
     helm upgrade -i k3d-$env-delegate harness-delegate/harness-delegate-ng \
       --namespace harness-$env --create-namespace \
       --set delegateName=k3d-$env-delegate --set accountId=<your-account-id> \
       --set delegateToken="$DT" --set managerEndpoint=https://app.harness.io \
       --set delegateDockerImage=harness/delegate:26.11.90409 \
       --set replicas=1 --set upgrader.enabled=false \
       --set k8sPermissionsType=NAMESPACE_ADMIN --set cpu=0.5
   done
   unset DT
   ```
   The image is multi-arch (amd64 and arm64).
5. **Manifests into the File Store** (Project Settings → File Store): `deploy/templates/deployment.yaml` and `deploy/templates/service.yaml` go in `/cart-pricing/templates`, and `deploy/values.yaml` goes in `/cart-pricing`.
6. **Entities**, pasted into each create dialog's YAML view, in this order: `connectors/github.yaml`, `connectors/dockerhub.yaml`, `connectors/k3d-staging.yaml`, `connectors/k3d-production.yaml`, `service.yaml`, `env-staging.yaml`, `env-production.yaml`, `infra-staging.yaml`, `infra-production.yaml`, `pipeline.yaml`, then optionally `trigger-push-main.yaml`.
7. **People and tokens.** A user group `release_approvers` with the humans who sign off production. A service account `agent_deployer` with the **Pipeline Executor** role on all project resources, and an API token for it. That token goes to the agent; it is the only Harness credential the agent gets.
8. **The agent.** Add the [Harness MCP server](https://github.com/harness/mcp-server) to your coding agent with the service account token as `HARNESS_API_KEY`, plus `HARNESS_ORG=default` and `HARNESS_PROJECT=default_project`. Keep the token in a file only you can read, and deny the agent `kubectl`, `helm` and `docker`, since on a laptop the cluster is local.

The first run must deploy a good build, so a later rollback has a release to return to.

The push trigger ships disabled. In the demo the agent starts each run itself, and an enabled trigger would start a second run for the same commit.

## Files

| Path | What it is |
|---|---|
| `src/pricing.js`, `src/server.js` | The API: `GET /healthz`, `GET /version`, `POST /quote` |
| `test/` | Unit tests. Anyone can edit these, agents included. |
| `contract/contract-check.sh` | The finance rules as live HTTP checks; the pipeline carries its own copy |
| `deploy/` | Source copy of the manifests and values in the Harness File Store. Editing it here changes nothing until a person uploads it |
| `.harness/` | Pipeline, service, environments, infrastructure, connectors and trigger |
| `scenarios/` | The prompts and the scripted bad change used in the demo |
| `.github/CODEOWNERS` | Human owners for `contract/`, `deploy/`, `.harness/` and `.github/` when changes go through pull requests |

## Known limits

- The agent still writes the app code, which runs in the CI build and in the pods. Neither gets a secret, and the pods run under Pod Security `restricted`.
- The contract and the manifests each live in two places: the copy that gates releases (the pipeline, the File Store) and the copy in this repo. A person changes both together.
- Docker Hub personal access tokens can't be limited to one repository, so `dockerhub_pat` can push to any repository in the account. Only the CI build step uses it.
- The image is deployed by tag (the run number), not by digest.
- Policy as code (OPA) isn't on the Harness Free plan, so the gates here are pipeline steps, access control and Pod Security.
- Harness applies `disallowPipelineExecutor` to manual and API runs, not to webhook triggers. On trigger runs, membership of `release_approvers` is the control.
- The build targets Arm64 because the demo cluster runs on an Apple Silicon Mac. Set `arch: Amd64` in `pipeline.yaml` for an x86 cluster.
- Written for the Harness Free plan as of November 2026.
