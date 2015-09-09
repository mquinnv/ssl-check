# ssl-check
Utility to monitor SSL renewal dates for UptimeRobot checks

Setup:
===
in the var directory, make a file named api:
```javascript
module.exports = 'uxxxx-xxxxxxxxxxxx';
```
then put a file named slack:
```javascript
module.exports = {
  hook: 'https://hook.slack.com/services/XXXX",
  channel: '#ssl (defaults to #general)'
};
```

Usage: ssl-check [command]
===
Commands:
---
update      check every site and update local db with cert expiry
insert      get the list of checks from UptimeRobot and insert any missing ones into local db
recheck     recheck each expired or expiring cert and notify slack on renewal
notify      notify slack channel about any expring or expired certs
help [cmd]  display help for [cmd]

Options:
---
-h, --help     output usage information
-V, --version  output the version number


