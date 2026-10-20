# APX: a quick panel guide

Start with **Inbox → Planner → Review**. These three panels cover the main task: read a customer request, propose actions, then decide what to execute.

## Finding your way

Move your cursor near the bottom edge to reveal the panel icons. Click **Panels** to keep them visible. Each workspace has its own panel dock. Use the top navigation to open **Compare**, **Observer**, or **Attack lab**. Long content scrolls inside the active panel.

## Support workspace: the five panels

- **Inbox - choose the task.** Select a customer ticket. Read the request and check its invoice amount, previous refunds, and current state. Click **Plan this request** to continue.
- **Connect - bring your own model.** Select Gemini, OpenAI, Groq, or OpenRouter, enter a model ID, and paste its API key into the password field. **Test & connect** verifies tool calling. Keys are encrypted, account-bound, and expire after one hour. **Use this model in Planner** continues the same protected workflow. **Bring an existing agent** stages external JSON proposals for Review.
- **Planner - prepare a proposal.** Choose a scenario and permission profile. **Deterministic replay** uses fixed test proposals; **Live model** asks your connected model (or the configured demo model) to propose actions. Expand **Task permissions** to inspect the customer, invoice, recipient, refund ceiling, and expiry. Click **Stage plan**. Staging changes no customer records.
- **Review - decide what happens.** Inspect proposed changes and their allow, approval-required, or block labels. **Execute permitted actions** applies the permitted sandbox changes; approve flagged actions first when requested. **Reject plan** applies nothing. **Recover changes** reverses supported changes when the current state allows it. Blocked actions stay blocked. Expand **Tool trace and observer evidence** to inspect the recorded reads, proposals, and observer details.
- **Activity - revisit the records.** **Plans** opens past plans. **Sandbox outbox** shows queued replies. **Audit trail** records what happened, including execution and recovery. Use this after a run to verify the outcome.

## Your first walkthrough

**TinyFish in Planner:** paste a separate TinyFish key under **Bring live web context into the plan**, then fetch a public reference. Use it in a Live plan, or choose **Stage a reference reply · no LLM** for a deterministic quoted reply requiring strict approval. The reference appears in Review and is sealed into the plan receipt; it cannot grant new permissions.

1. In **Inbox**, select a customer request and click **Plan this request**.
2. In **Planner**, choose **Deterministic replay**, the legitimate scenario, and **Standard**. Click **Stage plan**.
3. In **Review**, inspect the actions. Execute the permitted ones, then check **Activity**. Try **Recover changes** if available. Repeat with an attack scenario to see what gets blocked.

**Remember:** refunds are sandbox ledger entries, and replies remain in the sandbox outbox. No real money moves or email is sent. Once comfortable, use **Connect → Planner** with a supported live model. Only this sandbox workflow is protected; an API key cannot automatically secure unrelated tools or provider-held data.

<!-- pagebreak -->

# Extra tools: open when needed

You can complete the support walkthrough without these tools. Open them to investigate a decision, test the observer, or demonstrate the security design.

## Compare: evaluate the approach

- **Decision - why this design was chosen.** Read the selected control combination and the criteria used to choose it. Start here when explaining the project's approach.
- **Results - compare the controls.** Select a strategy to inspect unsafe actions authorized, legitimate work blocked, useful work retained, and approval burden. These are authored test cases, not a general model benchmark.
- **Cases - inspect one example.** Search or filter the cases. Select one to compare its expected outcome with the strategy's actual decisions and reasons.

## Observer: inspect the small security model

- **Scan - check text.** Choose a sample or enter your own text, select a loaded model, then click **Run observation**. This looks for suspicious instructions; it does not execute actions.
- **Results - read the prediction.** Inspect the verdict, score, model identity, timing, and input coverage. **Unknown** means the observer could not provide a reliable verdict. A benign label is not a permission grant.
- **Setup - check the connection.** See whether the separate inference service is available and read the connection instructions. **Refresh connection** checks its status. This panel does not start or download the model.
- **Method - understand the evidence.** Read how to measure missed attacks, false alarms, and review effort. The observer is advisory; it cannot override blocked actions or remove required approval.

## Attack lab: experiment with attacks

- **Simulation - follow one action.** See the execution path and compact decision summary. Click **Run attack**, then **Evidence** to inspect why it was allowed, held, or blocked.
- **Configure - prepare the experiment.** Choose the scenario, protection mode, difficulty, and synthetic user. Edit the prompt, or open the live action inspector to submit exact JSON. Settings remain selected when switching panels.
- **Evidence - understand the outcome.** Read policy findings, the trusted capability scope, and the execution flow. Analyst controls appear for approval-required actions; run the attack first to record a decision.
- **Bench - measure the fixtures.** Run the attack suite and inspect recorded containment, misses, and false positives. These measurements describe sandbox fixtures.
- **History - revisit runs.** The user-wise audit list appears directly in the panel, with prompt counts, flagged counts, analyzed counts, and latest activity. Select an identity to inspect its prompts and receipts. Use Refresh to update the list, or download the full JSON log.

Use the floating bottom dock to switch between these panels. Hover near the bottom to reveal it, click **Panels** to pin it, or use keyboard navigation. Touch devices keep the dock visible.

**Where to go next:** inspect a proposed change in **Review**; investigate **Planner → Task permissions**; revisit an outcome in **Activity**; explore security examples in **Compare → Cases**.
