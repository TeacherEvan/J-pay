# Production Data Wipe — 2026-11-13 (Console Revamp)

- **Target project:** `dlwlbvhyrvyftpjruqdq`
- **Preserved account:** `ewiebotha@gmail.com` (`role='moderator'`, `isActive=true`, `passwordChangedAt` set)
- **Backup location:** `~/jpay-backups/2026-11-13/` (`chmod 600` JSON snapshots for all public tables + `auth.users`)

## Before / After Row Counts

| Table | Before | After |
|---|---:|---:|
| `shiftOverrides` | 0 | 0 |
| `reviewResolutions` | 0 | 0 |
| `travelSegments` | 0 | 0 |
| `logs` | 4 | 0 |
| `shifts` | 4 | 0 |
| `punches` | 0 | 0 |
| `messages` | 4 | 0 |
| `pushSubscriptions` | 0 | 0 |
| `purgeAudit` | 0 | 0 |
| `systemEvents` | 0 | 0 |
| `jpay_rate_limits` | 2 | 0 |
| `managerSites` | 2 | 0 |
| `userSites` | 11 | 0 |
| `sites` | 3 | 0 |
| `organisations` | 1 | 0 |
| `public.users` | 20 | 1 |
| `auth.users` | 20 | 1 |

All post-wipe assertions passed (`1` user in `public.users` and `auth.users`, `0` rows in all other tables).
