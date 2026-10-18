# <Project> roadmap

| | |
|---|---|
| **Date** | <YYYY-MM-DD, the day this version was written> |
| **Owner** | <role that owns the roadmap, for example Project Lead> |
| **Covers** | <the apps, services and repos this roadmap is about> |
| **Review** | <when it is reviewed: monthly, and whenever a gate closes> |

## Where it stands

<Three to six lines: what is live, for whom, and how ready it is. Name the readiness verdict if there is one,
for example "Ready for a supervised pilot" or "Hold, not ready for public beta".>

## Now · <dates, for example October to November 2026> · <goal, for example pilot ready (Gate A)>

| ID | Item | Why it matters | Depends on | Owner | Due | Status |
|---|---|---|---|---|---|---|
| R-01 | <one deliverable, small enough to finish in this horizon> | <the outcome it unlocks> | <item, decision or account> | <role> | <date> | Planned |
| R-02 | | | | | | In progress |

## Next · <dates> · <goal>

| ID | Item | Why it matters | Depends on | Owner | Due | Status |
|---|---|---|---|---|---|---|
| R-10 | | | | | | Planned |

## Later · <dates> · <goal>

| ID | Item | Why it matters | Depends on | Owner | Due | Status |
|---|---|---|---|---|---|---|
| R-20 | | | | | | Planned |

## Decisions needed

| ID | Decision | Needed by | Owner | Status |
|---|---|---|---|---|
| D-01 | | | | Needs decision |

## Recently done

| ID | Item | Done |
|---|---|---|
| R-00 | | Done <YYYY-MM-DD> |

<!--
How the Soul Engine reads this file (keep the shape and it tracks every change):
- Each "##" heading is a horizon. Headings starting with Now, Next, Later, Future or Recently done are recognised;
  a date range and a goal or gate after "·" are read too.
- Each table row with an ID is an item. IDs never change and are never reused: the change history follows them.
- Status words: Planned, In progress, Blocked or Needs decision, Done (add the date). Move a finished item to
  "Recently done" or mark it Done; move items between horizons by moving the row.
- Commit the file whenever it changes. The commit message says why ("Moved R-04 to Next: client delayed data").
-->
