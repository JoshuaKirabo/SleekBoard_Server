# Billing kill switch

A small Cloud Run function that turns billing off for the SleekBoard Google Cloud project once the month's costs go
past a budget you set. It's Google's own "Disable billing usage with notifications" function
(docs.cloud.google.com/billing/docs/how-to/disable-billing-with-notifications, Node.js sample `stopBilling`), split
into small classes and with a few guards added (see "Where this differs from Google's guide").

It lives here so it's kept with the code, but it's its own package: it isn't in the server's Docker image
(`.dockerignore` leaves out `ops`), and it doesn't add anything to the server's `package.json`.

## Read this first: what it does and what it doesn't

What it does:

- Google's budget sends a message to a Pub/Sub topic several times a day with the month's cost so far. This function
  reads each one. If the cost is past the budget, it unlinks the project from its billing account. That's what
  "turning billing off" is.

What it doesn't do:

- **It isn't a hard cap.** Google says it plainly: there's a delay between costs happening and the budget message
  about them, and the first message after setting up can take several hours. Whatever runs up in that gap is still
  charged. Set the budget well below the money you actually have, not at it.
- **It stops every paid service in the project, all at once.** That's the whole SleekBoard server (Cloud Run, so the
  site and the API go down), the database (Cloud SQL), Secret Manager, the stored images in Artifact Registry, and this
  function itself. Free Tier services stop too. Google warns that some resources might be deleted and not come back.
  Keep a recent copy of the database somewhere outside Google (a `pg_dump` on this Mac) so the worst case is losing a
  few days, not everything.
- **Charges from before it fired are still owed.** It stops new costs, it doesn't cancel old ones.
- **It only watches this one project.** The budget is filtered to it. Other projects on the same billing account
  aren't covered, and neither is anything paid outside Google Cloud (Cloudflare, the domain).
- **It can't do anything if the project is locked to its billing account** (Google's "Secure the link between a
  project and its billing account"). Don't lock it.
- **It only works while the pieces are wired up.** If the budget, the topic or the function is deleted, or `BUDGET_ID`
  doesn't match the budget, nothing happens. That's why step 7 has you check the logs for "Under budget" lines.
- **Turning billing back on is by hand**, and Google says resources can take up to 24 hours to come back, some need
  restarting by hand, and nothing is guaranteed. See "Turning billing back on" below: there's a trap.

## Setup

These are the commands from Google's guide (their example script at the top of the page), adapted to SleekBoard. Run
them in Cloud Shell or any terminal with `gcloud`, signed in as someone who is Owner on the project and Billing Account
Administrator on the billing account. Run them from this folder.

### 1. Fill these in

```
PROJECT_ID="your-sleekboard-project-id"
REGION="the-region-the-server-runs-in"       # e.g. us-central1
TOPIC_ID="billing-kill-switch"
BILLING_ACCOUNT_ID="XXXXXX-XXXXXX-XXXXXX"    # gcloud billing accounts list
BUDGET_AMOUNT="10USD"                         # in the billing account's currency, below what you can afford
FUNCTION="billing-kill-switch"
SWITCH_ACCOUNT="billing-kill-switch@${PROJECT_ID}.iam.gserviceaccount.com"
```

### 2. Turn on the APIs it needs

```
gcloud services enable billingbudgets.googleapis.com \
    cloudbilling.googleapis.com \
    cloudbuild.googleapis.com \
    cloudfunctions.googleapis.com \
    eventarc.googleapis.com \
    run.googleapis.com \
    pubsub.googleapis.com \
    artifactregistry.googleapis.com \
    --project="${PROJECT_ID}"
```

### 3. The Pub/Sub topic the budget writes to

```
gcloud pubsub topics create "${TOPIC_ID}" --project="${PROJECT_ID}"
```

### 4. The budget, for this project only, sending to the topic

```
gcloud billing budgets create \
    --billing-account="${BILLING_ACCOUNT_ID}" \
    --display-name="SleekBoard kill switch" \
    --budget-amount="${BUDGET_AMOUNT}" \
    --filter-projects="projects/${PROJECT_ID}" \
    --threshold-rule=percent=0.5 \
    --threshold-rule=percent=0.9 \
    --threshold-rule=percent=1.0 \
    --notifications-rule-pubsub-topic="projects/${PROJECT_ID}/topics/${TOPIC_ID}"

BUDGET_ID=$(gcloud billing budgets list --billing-account="${BILLING_ACCOUNT_ID}" \
    --filter="displayName='SleekBoard kill switch'" --format="value(name.basename())")
echo "${BUDGET_ID}"
```

The thresholds only decide when Google emails the billing admins (at 50%, 90% and 100%; `percent` counts 1.0 as
100%). The Pub/Sub messages come several times a day whatever the thresholds are, and the function compares the
amounts itself.

`BUDGET_ID` has to print one id. If it prints nothing or two, find the right one with
`gcloud billing budgets list --billing-account="${BILLING_ACCOUNT_ID}"` and set it by hand (the part after `budgets/`).

### 5. Its own service account

Google's guide lets the function run as the project's default Compute Engine account, then makes that account a
Billing Account Administrator. The SleekBoard server on Cloud Run runs as that same default account (deploy.yml doesn't
pick another), so the server would end up able to manage billing too. A separate account keeps that power with the function only.

```
gcloud iam service-accounts create billing-kill-switch \
    --display-name="Billing kill switch" \
    --project="${PROJECT_ID}"
```

### 6. Deploy the function, pretending first

`SIMULATE_DEACTIVATION=true` makes it log what it would do without turning anything off. Leave it on until step 7
passes.

```
gcloud functions deploy "${FUNCTION}" \
    --gen2 \
    --runtime=nodejs24 \
    --region="${REGION}" \
    --source=. \
    --entry-point=stopBilling \
    --trigger-topic="${TOPIC_ID}" \
    --service-account="${SWITCH_ACCOUNT}" \
    --trigger-service-account="${SWITCH_ACCOUNT}" \
    --no-allow-unauthenticated \
    --set-env-vars="GOOGLE_CLOUD_PROJECT=${PROJECT_ID},BUDGET_ID=${BUDGET_ID},SIMULATE_DEACTIVATION=true" \
    --project="${PROJECT_ID}"
```

Then give its account what it needs: permission for the trigger to call it, Billing Account Administrator on the
billing account (the role Google's guide uses; unlinking needs an owner of the project or of the billing account), and
Project Browser on the project, so it can check whether billing is already off (Google's billing API wants
`resourcemanager.projects.get` for that; the default account in Google's guide already has it as an Editor).

```
gcloud functions add-invoker-policy-binding "${FUNCTION}" \
    --region="${REGION}" \
    --member="serviceAccount:${SWITCH_ACCOUNT}" \
    --project="${PROJECT_ID}"

gcloud billing accounts add-iam-policy-binding "${BILLING_ACCOUNT_ID}" \
    --member="serviceAccount:${SWITCH_ACCOUNT}" \
    --role="roles/billing.admin"

gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
    --member="serviceAccount:${SWITCH_ACCOUNT}" \
    --role="roles/browser"
```

If `GOOGLE_CLOUD_PROJECT` or `BUDGET_ID` is missing or mistyped, the function won't start and the deploy fails. That's
on purpose.

### 7. Test it, while it's still pretending

Send it a fake over-budget message:

```
gcloud pubsub topics publish "${TOPIC_ID}" --project="${PROJECT_ID}" \
    --message='{"costAmount": 99, "budgetAmount": 1}' \
    --attribute="budgetId=${BUDGET_ID}"

gcloud functions logs read "${FUNCTION}" --gen2 --region="${REGION}" --project="${PROJECT_ID}" --limit=20
```

The logs should show `Would have turned billing off for projects/<your project> (SIMULATE_DEACTIVATION=true)`.
Give it a minute if it's not there yet. What else you might see:

- Nothing at all after a few minutes: the trigger isn't reaching the function. Check the invoker binding in step 6.
- `Skipped a message from budget ...`: `BUDGET_ID` is wrong.
- `Couldn't tell if billing is on ...`: the Project Browser role from step 6 hasn't landed yet (it can take a few
  minutes) or went to the wrong account. Live, it would still go ahead and try to turn billing off, but fix it so the
  "already off" check works.

Never send that fake message once the switch is live: it would turn billing off for real.

### 8. Make it live

Deploy again without `SIMULATE_DEACTIVATION` (`--set-env-vars` replaces the whole list, so leaving it out turns it off):

```
gcloud functions deploy "${FUNCTION}" \
    --gen2 \
    --runtime=nodejs24 \
    --region="${REGION}" \
    --source=. \
    --entry-point=stopBilling \
    --trigger-topic="${TOPIC_ID}" \
    --service-account="${SWITCH_ACCOUNT}" \
    --trigger-service-account="${SWITCH_ACCOUNT}" \
    --no-allow-unauthenticated \
    --set-env-vars="GOOGLE_CLOUD_PROJECT=${PROJECT_ID},BUDGET_ID=${BUDGET_ID}" \
    --project="${PROJECT_ID}"
```

Over the next several hours the budget's own messages should show up in the logs as
`Under budget (<cost> of <budget>), billing stays on`. That line is the proof the whole chain works with the real
budget. Look for it again now and then; if it stops showing up, the switch isn't watching anymore.

## Turning billing back on

```
gcloud billing projects link "${PROJECT_ID}" --billing-account="${BILLING_ACCOUNT_ID}"
```

The trap: the month's cost is still past the budget, so the next budget message, a few hours later, turns billing off
again. Before linking, either raise the budget (`gcloud billing budgets update`) or redeploy with
`SIMULATE_DEACTIVATION=true` for the rest of the month, then put it back.

## Where this differs from Google's guide

- **Its own service account** instead of the default Compute Engine one (step 5), so the server doesn't share billing
  admin. Means two more flags on deploy, the invoker binding and Project Browser.
- **`--filter-projects`** on the budget. Google's guide says to use a budget scoped to a single project, but its
  example command leaves the filter out, which would count the whole billing account.
- **Thresholds 0.5 / 0.9 / 1.0** instead of the guide's `percent=100`. gcloud and the Budget API count `percent` with
  1.0 as 100%, so 100 would mean 10,000% of the budget. It only changes the emails, not the switch.
- **`BUDGET_ID` check.** A message from any other budget does nothing, so a second budget pointed at the same topic
  can't turn this project off.
- **`GOOGLE_CLOUD_PROJECT` is required and checked at start.** Google's guide warns that, left to itself, the function
  acts on whatever project it runs in. Here a missing or odd-looking id fails the deploy.
- **A message it can't read does nothing.** In Google's sample a message without `costAmount` and `budgetAmount`
  compares false both ways and goes on to turn billing off.
- **`SIMULATE_DEACTIVATION`** comes from Google's Python version, but off by default here, so forgetting it can't leave
  the switch doing nothing. Step 6 turns it on for the test.
- **Registered as a CloudEvent function** (`functions.cloudEvent`), reading the message at `data.message` the way
  Google's 2nd gen Pub/Sub samples and their Python version do. Google's Node sample uses the older background
  function shape, with the message's data straight on the event.
- **`projectBillingInfo`** instead of the sample's `resource` when unlinking: `resource` isn't a field in the current
  `@google-cloud/billing` client's request.
- **`--no-allow-unauthenticated`**, so nobody on the internet can send the function a fake over-budget event.
- Only the billing and functions-framework packages. Google's sample `package.json` also lists Compute, Slack and
  other packages for its other examples.

## Tests

```
nvm use 22
npm test
```

The tests use a stand-in for Google's billing client, so they never talk to Google. The server's own `npm test` only
looks under `test/`, so it doesn't run these.
