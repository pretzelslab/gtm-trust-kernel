# Seed data you import yourself

Nothing in this repo's packages writes to a CRM (hard rule 1 in
`CLAUDE.md`). The files here are for the maintainer to load into their
own Developer Edition org by hand, with the Salesforce CLI (`sf`).

## `contract-pagination.csv`: the child-pagination deal

The live contract tests (`npm run test:live -w @gtm-trust-kernel/adapters`)
include a check on one deal with more Tasks than the adapter's per-deal
cap of 200. The check signs in as the connected app's **Run As user**,
in the org named by `SF_INSTANCE_URL` in `.env`. It finds the deal by
`CONTRACT-PAGINATION` in the Task Subject and skips if it sees none. When
it skips, it prints the org host and Run As username it checked.

This file holds 250 Tasks (`Subject` "CONTRACT-PAGINATION 1" to
"CONTRACT-PAGINATION 250", `Status` "Completed") with two placeholders in
every row:

- `WhatId` = `REPLACE_WITH_OPPORTUNITY_ID`: the deal the Tasks go on.
- `OwnerId` = `REPLACE_WITH_RUN_AS_USER_ID`: the Run As user, so the
  Tasks are visible to it. An `sf` import otherwise makes you the owner,
  and the Run As user may not see your Tasks.

**Replace both placeholders before you import.** Left in place, they make
the import fail instead of creating Tasks on the wrong record or owner.

From the repo root, in Git Bash (`<alias>` is your org's `sf` alias):

1. **Use the org in `.env`.** Check that the alias points to it:

   ```bash
   sf org display --target-org <alias>
   ```

   Its Instance Url must match `SF_INSTANCE_URL` in `.env`.

2. **Remove any earlier `CONTRACT-PAGINATION` Tasks first** (see
   "Removing the Tasks" below), so only one set exists, on one deal and
   owner.

3. **Find the Run As user's Id.** In Setup, open App Manager, find the
   connected app the adapter uses, choose View (or Manage), and read the
   username under Client Credentials Flow, "Run As". Then:

   ```bash
   sf data query --query "SELECT Id FROM User WHERE Username = '<run as username>'" --target-org <alias>
   ```

4. **Choose the deal.** Copy one open opportunity's 18-character Id (from
   its URL in Salesforce, for example).

5. **Fill in a local copy** (`*.local.csv` is git-ignored; the tracked file
   stays a template):

   ```bash
   sed -e 's/REPLACE_WITH_OPPORTUNITY_ID/<opportunity id>/' -e 's/REPLACE_WITH_RUN_AS_USER_ID/<run as user id>/' scripts/seed/contract-pagination.csv > scripts/seed/contract-pagination.local.csv
   grep -c REPLACE_WITH scripts/seed/contract-pagination.local.csv   # must print 0
   ```

6. **Import it** (Bulk API 2.0):

   ```bash
   sf data import bulk --sobject Task --file scripts/seed/contract-pagination.local.csv --line-ending LF --wait 10 --target-org <alias>
   ```

7. **Check the result.** This should print 250:

   ```bash
   sf data query --query "SELECT COUNT() FROM Task WHERE Subject LIKE 'CONTRACT-PAGINATION %' AND WhatId = '<opportunity id>' AND OwnerId = '<run as user id>'" --target-org <alias>
   ```

8. Run the live tests. The pagination check should now run. It prints
   each child page's row count, whether Salesforce returned a
   `nextRecordsUrl` on the child rows, and the calls it used.

### Removing the Tasks

```bash
sf data query --query "SELECT Id FROM Task WHERE Subject LIKE 'CONTRACT-PAGINATION %'" --result-format csv --target-org <alias> > scripts/seed/contract-pagination-delete.local.csv
sf data delete bulk --sobject Task --file scripts/seed/contract-pagination-delete.local.csv --line-ending LF --wait 10 --target-org <alias>
```

Check the Ids in the query file before you run the delete (250 per
earlier import).
