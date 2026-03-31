#!/usr/bin/env bash
# demo-session.sh -- Generate a realistic booth visitor session in S3
# Usage: ./scripts/demo-session.sh
#
# Creates a session JSON with random visitor, click events, transcript,
# and metadata, then uploads to the boothapp sessions bucket.

set -euo pipefail

AWS_PROFILE="${AWS_PROFILE:-hackathon}"
AWS_REGION="${AWS_REGION:-us-east-1}"
BUCKET="boothapp-sessions-752266476357"

export AWS_PROFILE AWS_REGION

# -------------------------------------------------------------------
# Helpers
# -------------------------------------------------------------------
rand_between() { echo $(( RANDOM % ($2 - $1 + 1) + $1 )); }

pick_random() {
  local -n arr=$1
  echo "${arr[RANDOM % ${#arr[@]}]}"
}

iso_now() { date -u +"%Y-%m-%dT%H:%M:%SZ"; }

iso_offset() {
  # $1 = base epoch, $2 = offset seconds
  date -u -d "@$(( $1 + $2 ))" +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null \
    || date -u -r "$(( $1 + $2 ))" +"%Y-%m-%dT%H:%M:%SZ"
}

# -------------------------------------------------------------------
# Visitor pool (10 fictional attendees)
# -------------------------------------------------------------------
NAMES=(
  "Alex Rivera"
  "Jordan Patel"
  "Morgan Zhang"
  "Casey Nakamura"
  "Taylor Okonkwo"
  "Avery Lindqvist"
  "Riley Fernandez"
  "Quinn Abernathy"
  "Dakota Johansson"
  "Skyler Marchetti"
)

TITLES=(
  "VP of Information Security"
  "CISO"
  "Director of Cloud Security"
  "SOC Manager"
  "Head of IT Infrastructure"
  "Security Architect"
  "DevSecOps Lead"
  "IT Security Manager"
  "Director of Threat Intelligence"
  "Chief Technology Officer"
)

COMPANIES=(
  "Northwind Financial"
  "Contoso Healthcare"
  "Fabrikam Industries"
  "Woodgrove Bank"
  "Tailspin Toys"
  "Adventure Works"
  "Litware Inc"
  "Proseware Corp"
  "Datum Technologies"
  "Trey Research"
)

# -------------------------------------------------------------------
# V1 page URLs (realistic Vision One console paths)
# -------------------------------------------------------------------
V1_PAGES=(
  "/app/xdr/investigation/workbench"
  "/app/xdr/search"
  "/app/xdr/detection-model-management"
  "/app/epp/workload-protection"
  "/app/epp/endpoint-protection"
  "/app/endpoint-inventory"
  "/app/zero/endpoints"
  "/app/zero/secure-access-rules"
  "/app/email-security/email-overview"
  "/app/network-security/intrusion-prevention"
  "/app/cloud-security/conformity"
  "/app/cloud-security/container-security"
  "/dashboard"
  "/app/risk-insights/overview"
  "/app/attack-surface/internet-facing-assets"
)

PAGE_LABELS=(
  "XDR Workbench"
  "XDR Search"
  "Detection Models"
  "Server & Workload Protection"
  "Standard Endpoint Protection"
  "Endpoint Inventory"
  "Zero Trust Endpoints"
  "Secure Access Rules"
  "Email Security Overview"
  "Network IPS"
  "Cloud Conformity"
  "Container Security"
  "Dashboard"
  "Risk Insights"
  "Attack Surface - Internet Assets"
)

# -------------------------------------------------------------------
# Transcript templates (SE demo conversation)
# -------------------------------------------------------------------
generate_transcript() {
  local visitor_name="$1"
  local first_name="${visitor_name%% *}"

  cat <<TRANSCRIPT
{"role":"se","text":"Welcome to the Trend Micro booth! I'm happy to walk you through our platform. What brings you to the show today?"}
{"role":"visitor","text":"Hi! We're evaluating XDR platforms. Our current SIEM is struggling with alert fatigue and we need better detection."}
{"role":"se","text":"That's a common challenge. Let me show you Vision One -- it correlates telemetry across endpoints, email, network, and cloud into unified incidents."}
{"role":"visitor","text":"How does it handle detection? Is it signature-based or behavioral?"}
{"role":"se","text":"Both, plus AI-driven models. Let me pull up the Detection Model Management page so you can see the analytics layer."}
{"role":"se","text":"Here you can see our detection models -- each one maps to MITRE ATT&CK techniques. The platform auto-correlates low-fidelity signals into high-confidence incidents."}
{"role":"visitor","text":"Interesting. We run a lot of workloads in AWS. Does this cover cloud?"}
{"role":"se","text":"Absolutely. Let me navigate to Cloud Security. We have Cloud Conformity for posture management and container security for runtime protection."}
{"role":"visitor","text":"We're running about 200 EKS clusters. What does runtime protection look like?"}
{"role":"se","text":"Great question. Container Security gives you runtime visibility -- process trees, network connections, file integrity monitoring -- all tied back to the XDR workbench."}
{"role":"visitor","text":"That's exactly what we need. Our DevOps team has been asking for shift-left scanning too."}
{"role":"se","text":"We cover that with artifact scanning in CI/CD pipelines. Let me show you the Endpoint Inventory view -- you'll see how all assets are unified in one console."}
{"role":"visitor","text":"${first_name} here -- one thing I'm curious about is zero trust. We have a hybrid workforce."}
{"role":"se","text":"Perfect timing. Our Zero Trust Secure Access module provides identity-aware access control with native Okta and Azure AD integration."}
{"role":"visitor","text":"Can it integrate with our existing IdP? We use Okta."}
{"role":"visitor","text":"That closed-loop approach is compelling. What about email? We had a BEC incident last quarter."}
{"role":"se","text":"Email Security uses AI to detect BEC, credential phishing, and advanced threats. It sandboxes URLs and attachments before delivery. Let me pull up the threat dashboard."}
{"role":"visitor","text":"This is really comprehensive. What would a POC look like?"}
{"role":"se","text":"We typically do a 30-day proof of value. We'd connect your telemetry sources, run in monitor mode, and show you the detections and risk reduction. I'll have our team reach out to schedule it."}
{"role":"visitor","text":"Sounds great. Can you send me the technical documentation and pricing for the XDR and cloud modules?"}
TRANSCRIPT
}

# -------------------------------------------------------------------
# Build session JSON
# -------------------------------------------------------------------
SESSION_ID="sess-$(date +%Y%m%d%H%M%S)-$(printf '%04x' $RANDOM)"
BASE_EPOCH=$(date +%s)
START_OFFSET=$(rand_between 300 1800)
START_EPOCH=$(( BASE_EPOCH - START_OFFSET ))

# Pick visitor
IDX=$(( RANDOM % ${#NAMES[@]} ))
VISITOR_NAME="${NAMES[$IDX]}"
VISITOR_TITLE="${TITLES[$IDX]}"
VISITOR_COMPANY="${COMPANIES[$IDX]}"

echo "==> Generating session: ${SESSION_ID}"
echo "    Visitor: ${VISITOR_NAME}, ${VISITOR_TITLE} at ${VISITOR_COMPANY}"

# Build click events (5-8)
NUM_CLICKS=$(rand_between 5 8)
CLICKS="["
for (( i=0; i<NUM_CLICKS; i++ )); do
  PAGE_IDX=$(( RANDOM % ${#V1_PAGES[@]} ))
  OFFSET=$(( (i + 1) * $(rand_between 30 120) ))
  TS=$(iso_offset "$START_EPOCH" "$OFFSET")
  [ "$i" -gt 0 ] && CLICKS+=","
  CLICKS+=$(cat <<EOF

    {
      "timestamp": "${TS}",
      "page": "${V1_PAGES[$PAGE_IDX]}",
      "label": "${PAGE_LABELS[$PAGE_IDX]}",
      "dwell_seconds": $(rand_between 15 180)
    }
EOF
  )
done
CLICKS+=$'\n  ]'

# Build transcript
TRANSCRIPT_LINES=$(generate_transcript "$VISITOR_NAME")
TRANSCRIPT="["
FIRST=true
LINE_NUM=0
while IFS= read -r line || [ -n "$line" ]; do
  OFFSET=$(( (LINE_NUM + 1) * $(rand_between 15 45) ))
  TS=$(iso_offset "$START_EPOCH" "$OFFSET")
  ROLE=$(echo "$line" | sed 's/.*"role":"\([^"]*\)".*/\1/')
  TEXT=$(echo "$line" | sed 's/.*"text":"\(.*\)"}/\1/')

  [ "$FIRST" = true ] && FIRST=false || TRANSCRIPT+=","
  TRANSCRIPT+=$(cat <<EOF

    {
      "timestamp": "${TS}",
      "speaker": "${ROLE}",
      "text": "${TEXT}"
    }
EOF
  )
  LINE_NUM=$(( LINE_NUM + 1 ))
done <<< "$TRANSCRIPT_LINES"
TRANSCRIPT+=$'\n  ]'

END_EPOCH=$(( START_EPOCH + START_OFFSET ))
SESSION_START=$(iso_offset "$START_EPOCH" 0)
SESSION_END=$(iso_offset "$END_EPOCH" 0)

# Assemble full session JSON
SESSION_JSON=$(cat <<EOF
{
  "session_id": "${SESSION_ID}",
  "metadata": {
    "status": "ended",
    "created_at": "${SESSION_START}",
    "ended_at": "${SESSION_END}",
    "duration_seconds": ${START_OFFSET},
    "booth": "Trend Micro - RSA 2026",
    "se_name": "Demo SE"
  },
  "visitor": {
    "name": "${VISITOR_NAME}",
    "title": "${VISITOR_TITLE}",
    "company": "${VISITOR_COMPANY}"
  },
  "clicks": ${CLICKS},
  "transcript": ${TRANSCRIPT}
}
EOF
)

# -------------------------------------------------------------------
# Upload to S3
# -------------------------------------------------------------------
TMPFILE=$(mktemp /tmp/demo-session-XXXXXX.json)
echo "$SESSION_JSON" > "$TMPFILE"

echo "    Clicks: ${NUM_CLICKS} events"
echo "    Transcript: ${LINE_NUM} entries"
echo "    Uploading to s3://${BUCKET}/${SESSION_ID}.json ..."

aws s3 cp "$TMPFILE" "s3://${BUCKET}/${SESSION_ID}.json" \
  --region "$AWS_REGION" \
  --content-type "application/json" \
  --quiet

rm -f "$TMPFILE"

echo "==> Done! Session uploaded: s3://${BUCKET}/${SESSION_ID}.json"
echo ""
echo "    Verify with:"
echo "    aws s3 cp s3://${BUCKET}/${SESSION_ID}.json - --region ${AWS_REGION} --profile ${AWS_PROFILE} | python3 -m json.tool"
