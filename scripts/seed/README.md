# Seed data you import yourself

Nothing in this repo's packages writes to a CRM (hard rule 1 in
`CLAUDE.md`). The files here are for the maintainer to load into their
own Developer Edition org by hand, with the Salesforce CLI (`sf`).

## `contract-pagination.csv`: the child-pagination deal

The live contract tests (`npm run test:live -w @gtm-trust-kernel/adapters`)
include a check on one deal with more Tasks than the adapter's per-deal
cap of 200. It finds that deal by `CONTRACT-PAGINATION` in the Task
Subject and skips if there isn't one. This file holds 250 such Tasks
(`Subject` "CONTRACT-PAGINATION 1" to "CONTRACT-PAGINATION 250",
`Status` "Completed"). Every row's `WhatId` is the placeholder
`REPLACE_WITH_OPPORTUNITY_ID`, so importing the file unedited fails
instead of attaching Tasks to the wrong record.

From the repo root, in Git Bash:

1. Choose one open opportunity and copy its 18-character Id (from its URL
   in Salesforce, for example). All 250 Tasks go on that one deal.

2. Fill in a local copy (`*.local.csv` is git-ignored; the tracked file
   stays a template):

   ```bash
   sed 's/REPLACE_WITH_OPPORTUNITY_ID/<opportunity id>/' scripts/seed/contract-pagination.csv > scripts/seed/contract-pagination.local.csv
   ```

3. Import it (Bulk API 2.0; `<alias>` is your org's `sf` alias):

   ```bash
   sf data import bulk --sobject Task --file scripts/seed/contract-pagination.local.csv --line-ending LF --wait 10 --target-org <alias>
   ```

4. Run the live tests. The pagination check should now run, and it prints
   whether Salesforce split the deal's Tasks across result pages.

### Removing the Tasks afterwards

```bash
sf data query --query "SELECT Id FROM Task WHERE Subject LIKE 'CONTRACT-PAGINATION %'" --result-format csv --target-org <alias> > scripts/seed/contract-pagination-delete.local.csv
sf data delete bulk --sobject Task --file scripts/seed/contract-pagination-delete.local.csv --line-ending LF --wait 10 --target-org <alias>
```

Check that the query file lists 250 Ids before you run the delete.
