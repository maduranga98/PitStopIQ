#!/bin/bash
# Bulk delete stale Firebase Hosting preview channels.
# Keeps "live" and the most recent KEEP channels; deletes the rest.

PROJECT="pitstopiq"
SITE="pitstopiq"
KEEP=10   # <-- adjust: how many most-recent PR channels to keep

# All channel IDs, most recent first (from `firebase hosting:channel:list`)
CHANNELS=(
  pr141-claude-low-stock-ale
  pr140-claude-distributor-p
  pr139-claude-admin-navbar-
  pr138-claude-admin-navbar-
  pr137-claude-vehicle-logs-
  pr136-claude-vigilant-dijk
  pr135-claude-outlet-pos-in
  pr134-claude-current-featu
  pr133-claude-job-card-tech
  pr132-claude-inventory-ser
  pr131-claude-inventory-ser
  pr130-claude-inventory-sup
  pr129-claude-inventory-sup
  pr128-claude-inventory-cat
  pr127-claude-inventory-cat
  pr126-claude-loading-perce
  pr125-claude-technician-pr
  pr124-claude-login-issue-r
  pr123-claude-sms-quota-acc
  pr122-claude-vehicle-detai
  pr121-claude-vehicle-detai
  pr120-claude-payments-acco
  pr119-claude-basic-plan-pr
  pr118-claude-service-cente
  pr117-claude-service-prici
  pr116-claude-module-script
  pr115-claude-module-script
  pr114-claude-service-ui-pr
  pr113-claude-service-ui-pr
  pr112-claude-service-ui-pr
  pr111-claude-sms-segmentat
  pr110-claude-reminder-sms-
  pr109-claude-reminder-sms-
  pr108-claude-sms-body-stru
  pr107-claude-mobile-login-
  pr106-claude-firestore-per
  pr105-claude-mobile-login-
  pr104-claude-mobile-login-
  pr103-claude-sms-body-stru
  pr102-claude-sms-body-stru
  pr101-claude-customer-pack
  pr100-claude-customer-pack
  pr99-claude-vehicle-secti
  pr98-claude-super-admin-s
  pr97-claude-service-cente
  pr96-claude-pitstopiq-log
  pr95-claude-pitstopiq-log
  pr94-claude-session-krwey
  pr93-claude-session-krwey
  pr92-claude-app-pitstopiq
)

TOTAL=${#CHANNELS[@]}
DELETE_FROM=$KEEP

echo "Total channels: $TOTAL"
echo "Keeping newest $KEEP, deleting $((TOTAL - KEEP))"
echo ""

for ((i=DELETE_FROM; i<TOTAL; i++)); do
  CH="${CHANNELS[$i]}"
  echo "Deleting: $CH"
  firebase hosting:channel:delete "$CH" \
    --project "$PROJECT" \
    --site "$SITE" \
    --force
done

echo "Done."
