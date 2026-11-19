# Finance import and bill budgets

This is not a live bank connection. The app does not call Diamond Ops, Chase, Bank of America, or Capital One. A person or a job outside this repo places a JSON file where `scripts/import-finance.mjs` can read it. The screen labels the newest import time and says it is not live.

No account numbers beyond a 4-digit mask, and no passwords, tokens, or credentials, belong in the file or in the browser.

## What the screen does

Fixed bills keep a due date and Mark paid. That includes rent, loans, insurance, payroll, and card minimums. A card minimum stays a bill even when the notes say "estimated minimums" or "enter actual". If the due day is a placeholder, the row says **Estimated due date**. If the amount is an estimate, the row says **Estimate**.

Running expense budgets are monthly plans for fuel, crew supplies, dump fees, and similar operating spend. They show confirmed spend against the budget, remaining, and a month-end pace. Tap a budget for the transactions: purchase date, bank date when it differs, merchant, amount, account, and pending or posted. A budget has no Mark paid button.

**Actual unknown** means no import covers that budget. It is not the same as **$0 actual**, which means an import arrived and nothing confirmed was charged.

Charges that are not confirmed sit under **Needs a decision**. A suggestion can be shown. It does not move the totals until a manager assigns it to a budget, a bill, personal, or a transfer.

## Accounting assumptions

- A card purchase is an expense on the purchase date. It does not leave the checking account on that date.
- A bank payment to a card is a settlement. It is cash leaving the bank and it reduces what is still owed on the card. It is not a second expense.
- A transfer between the company’s own accounts is not income and not an expense. A posted transfer is already inside the bank balances.
- Refunds reduce the expense and reduce what is owed on the card (or come back to the bank).
- Partial bill payments stay open for the remainder. The payment record stores the total paid so far. Several payment rows for the same bill and month are added together. A refund assigned to the bill reduces that total. If the payment row and the transaction share a `sourceId`, they are counted once.
- The cash figure is today’s Chase and Bank of America balances, minus what still has to leave the bank:
  - remaining fixed bills, after partial payments
  - unsettled card charges (purchases minus refunds and payments already sent)
  - the part of a card-funded budget that is not already on the card
  - the part of a bank-funded budget that has not already posted into the balance
  - pending bank withdrawals that are still unmatched
- A card minimum that is tied to the same card with `settlementAccountId` is a floor, not an extra line on top of the card balance.
- The full monthly budget is not added on top of the amount already spent. Posted bank spend already in the balance is subtracted from that budget’s remaining cash need.
- Pending card purchases move from “still expected” into “unsettled charges”. They do not also reduce the checking balance.
- If funding is unknown, or no card is tied to a card budget, that budget is listed and left out of the cash total. The total is marked incomplete.
- Unmatched posted charges that already hit the bank are not subtracted a second time. Until they are assigned, a budget can still reserve its remaining amount, so the forecast may set cash aside twice. That is why they stay visible.
- Personal spending is cash out, not an operating expense.
- Bank effective date and purchase date are separate. Spend for the month uses the purchase date. Whether a posted bank row is already inside the balance uses the effective date compared with that account’s as-of date.
- Only a manual assignment (`confidence: "manual"` and `confirmed: true`) counts as confirmed. `high` and `low` stay suggestions, even if a file sets `confirmed: true` without `manual`.

## Import file

```json
{
  "source": "diamond-ops-finance",
  "importedAt": "2026-11-13T15:04:00.000Z",
  "live": false,
  "accounts": [
    {
      "id": "chase-0714",
      "institution": "Chase",
      "mask": "0714",
      "kind": "bank",
      "name": "Chase checking ···0714",
      "balanceKey": "chase0714",
      "freshness": {
        "source": "diamond-ops-finance",
        "importedAt": "2026-11-13T15:04:00.000Z",
        "throughDate": "2026-11-12"
      }
    }
  ],
  "transactions": [
    {
      "sourceId": "stable-id-from-the-connector",
      "accountId": "chase-0714",
      "amount": 40,
      "direction": "out",
      "kind": "bank_debit",
      "purchaseDate": "2026-11-05",
      "effectiveDate": "2026-11-05",
      "status": "posted",
      "merchant": "Sample Dump",
      "confidence": "manual",
      "confirmed": true,
      "target": "budget",
      "budgetId": "bill_dump",
      "category": "Crew operating"
    }
  ]
}
```

Accounts the connector is expected to cover, by mask only:

| Institution | Mask | Kind |
| --- | --- | --- |
| Chase | 0714 | bank |
| Bank of America | 1003 | bank |
| Capital One | 9618, 2529, 2316, 2352, 0698 | credit |

`kind` is `card_purchase`, `card_payment`, `bank_debit`, `bank_credit`, `transfer`, `refund`, `fee`, or `unknown`.

`direction` is `out` or `in`. A negative amount is accepted and flips the direction.

A card payment should include both legs when the connector has them, with the same `settlementGroup`. The card leg is `direction: "in"` on the credit account. The bank leg is `direction: "out"` on the checking account and may set `counterAccountId` to the card. One leg does not become a second expense.

`source` plus `sourceId` is the stable id (`tx_` + those values, with punctuation removed). Importing the same id again updates the row. A later pending copy does not replace a posted copy. A posted row can set `supersedes` to the pending `sourceId` it replaces so the pending copy is dropped.

`confidence` is `none`, `low`, `high`, or `manual`. Anything other than a manual confirmation is stored as a suggestion and left unmatched.

The sample file is `data/finance-import.sample.json`. Round fixture numbers only.

```bash
node scripts/import-finance.mjs
node scripts/import-finance.mjs data/finance-import.sample.json
```

That prints counts, duplicate collapses, superseded pending rows, and totals for expenses, refunds, settlements, transfers, and unmatched. It writes nothing.

```bash
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node scripts/import-finance.mjs --write data/finance-import.sample.json
```

`--write` talks only to a loopback emulator. It refuses a missing host and any host that looks like production. It upserts `financeAccounts` and `financeTransactions`. The emulator is not production, and this does not publish security rules.

## Classifying existing bills

Clear running budgets:

- Notes say **monthly estimate** and **enter actual**, and the category is Fuel, Crew operating, or Vehicles & equipment, and the name is not a fixed obligation.
- Notes say **owner estimate**, **enter actual**, and **paid off weekly**.
- Notes give a **historical average** (including a May–Sep average) and **enter actual**, in those same categories.

Not enough on their own:

- "Enter actual"
- "Estimated minimums"
- "Seeded from Must-Pays v23"

Card minimums and Affirm stay bills. Ambiguous rows stay bills and are listed for review: purpose unconfirmed, a fee that depends on the balance, a placeholder due day on something that is not a card minimum, or "estimated minimums" on a category that is not card minimums.

The dry-run fixture is `data/bills-migration.sample.json`.

```bash
node scripts/migrate-bill-budgets.mjs
node scripts/migrate-bill-budgets.mjs data/bills-migration.sample.json
```

A reclassify keeps the original document under `classification.original` (name, amount, due day, notes, id). It does not delete payment history. Review rows are not written.

```bash
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node scripts/migrate-bill-budgets.mjs --write data/bills-migration.sample.json
```

Same emulator-only guard as the importer. Do not point it at `diamond-landscapes-f676b`.

The screen also classifies from notes when `kind` is not stored yet, so the list can separate budgets from bills before any migration write.

## Rules the owner still has to authorize

`firestore.bills.rules` was not changed. Reads of the existing bill collections stay manager-only. These writes will be rejected until the owner pastes new matches into the live ruleset and publishes them. Do not deploy the fragment below until that review.

New optional bill fields: `kind` (`bill` or `budget`), `funding` (`card`, `bank`, or `unknown`), `fundingAccountId`, `settlementAccountId`, and `classification` (map with `action`, `at`, `signal`, `reason`, and `original`). `billTemplateOk` currently uses `keys().hasOnly`, so a document with those keys fails.

New collections, manager read and write only, no crew access:

- `financeAccounts/{id}` — institution, 4-digit mask, `bank` or `credit`, display name, optional `balanceKey`, freshness (`source`, `importedAt`, `throughDate`). Reject credential-like keys.
- `financeTransactions/{id}` — the transaction shape above, including assignment and suggestion. Reject credential-like keys. Amounts are non-negative numbers. Dates are `YYYY-MM-DD`.

`billPayments` can stay as they are. `status` remains the string `paid` on the payment row; the screen decides partial versus paid from the amounts. An optional `sourceId` would make payment-to-transaction dedupe durable. Without it, dedupe works only when that field is already on the document.

Until those rules exist, the app keeps transactions in manager memory for the fixture and does not put them in the phone cache. A failed transaction save does not mark the rest of Bills unreadable.

## Still to do before daily numbers are real

1. Export the live bill templates and run `node scripts/migrate-bill-budgets.mjs that-file.json`. Read every REVIEW row. Do not write production from this script.
2. Review and publish the rules above. This pull request does not publish them.
3. Have Diamond Ops write the JSON file on a schedule. This repo cannot see that connector.
4. Run the importer somewhere the owner controls. `--write` in this repo is emulator-only on purpose. A production load needs a separate approval and a writer that uses the published rules. Do not put connector credentials in the app.
5. Link each card budget to a card account (`fundingAccountId`) and each card minimum that belongs to that card (`settlementAccountId`). Until then the cash total leaves the untied budget out and says so.
6. Assign the unmatched queue. Suggestions do not count until then.
7. The balance boxes stay manual snapshots and stay labeled unverified until a real balance feed exists. Transaction freshness is separate and is the "Latest actual import" line.

## Tests

`node --test scripts/bills-model.test.mjs` covers the fixed-bill month math, partial payments and refunds, duplicate source ids, pending-to-posted replacement, unknown versus zero, budget pace, card purchases not leaving the bank twice, settlements and transfers not counted as expenses, the migration dry-run fixture, and the import dry-run. Both writers refuse a production host.
