#!/usr/bin/env bash
# ============================================================================
# simulate-session.sh -- Session Recording Simulator
#
# Simulates a 2-minute live demo session by incrementally writing session
# artifacts (badge, clicks, transcript, ready) to a local directory that
# mirrors the S3 data contract. Designed so the watcher pipeline can process
# events in real-time during a live demo to judges.
#
# Usage:
#   bash scripts/simulate-session.sh [output-dir]
#
# If output-dir is omitted, creates sessions/<generated-id>/ in cwd.
# ============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# Colors
# ---------------------------------------------------------------------------
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
RESET='\033[0m'

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
CLICK_INTERVAL=5          # seconds between click events
SESSION_ID="SIM-$(date +%Y%m%d-%H%M%S)"
BASE_DIR="${1:-sessions}"
SESSION_DIR="${BASE_DIR}/${SESSION_ID}"
SCREENSHOTS_DIR="${SESSION_DIR}/screenshots"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
banner() {
    echo ""
    echo -e "${RED}  ____              _   _        _                  ${RESET}"
    echo -e "${RED} | __ )  ___   ___ | |_| |__    / \\   _ __  _ __   ${RESET}"
    echo -e "${RED} |  _ \\ / _ \\ / _ \\| __| '_ \\  / _ \\ | '_ \\| '_ \\  ${RESET}"
    echo -e "${RED} | |_) | (_) | (_) | |_| | | |/ ___ \\| |_) | |_) | ${RESET}"
    echo -e "${RED} |____/ \\___/ \\___/ \\__|_| |_/_/   \\_\\ .__/| .__/  ${RESET}"
    echo -e "${RED}                                      |_|   |_|    ${RESET}"
    echo ""
    echo -e "${BOLD} Session Recording Simulator${RESET}"
    echo -e "${DIM} Simulating a live 2-minute booth demo capture${RESET}"
    echo ""
}

timestamp() {
    date +%H:%M:%S
}

log_step() {
    local icon="$1" color="$2" msg="$3"
    echo -e "${DIM}[$(timestamp)]${RESET} ${color}${icon}${RESET} ${msg}"
}

log_info()    { log_step "[*]" "$CYAN"   "$1"; }
log_success() { log_step "[+]" "$GREEN"  "$1"; }
log_action()  { log_step "[>]" "$YELLOW" "$1"; }
log_done()    { log_step "[=]" "$GREEN"  "$1"; }

elapsed_ms() {
    # Milliseconds since session start (uses SECONDS builtin)
    echo $(( SECONDS * 1000 ))
}

# ---------------------------------------------------------------------------
# Session data -- realistic booth demo scenario
# ---------------------------------------------------------------------------

VISITOR_NAME="Maria Rodriguez"
VISITOR_TITLE="Director of Security Operations"
VISITOR_COMPANY="Pacific Northwest Health Systems"
VISITOR_EMAIL="mrodriguez@pnwhealth.example.com"

# Click events: url, element clicked, x, y coords
# These simulate an SE navigating the V1 console during a demo
CLICK_URLS=(
    "https://portal.xdr.trendmicro.com/#/app/dashboard"
    "https://portal.xdr.trendmicro.com/#/app/xdr/workbench"
    "https://portal.xdr.trendmicro.com/#/app/xdr/workbench"
    "https://portal.xdr.trendmicro.com/#/app/xdr/search"
    "https://portal.xdr.trendmicro.com/#/app/xdr/search"
    "https://portal.xdr.trendmicro.com/#/app/epp/endpoint-protection"
    "https://portal.xdr.trendmicro.com/#/app/epp/endpoint-protection"
    "https://portal.xdr.trendmicro.com/#/app/endpoint-inventory"
    "https://portal.xdr.trendmicro.com/#/app/zero/endpoints"
    "https://portal.xdr.trendmicro.com/#/app/zero/endpoints"
    "https://portal.xdr.trendmicro.com/#/app/security-posture/attack-surface"
    "https://portal.xdr.trendmicro.com/#/app/security-posture/attack-surface"
    "https://portal.xdr.trendmicro.com/#/app/email-security"
    "https://portal.xdr.trendmicro.com/#/app/email-security"
    "https://portal.xdr.trendmicro.com/#/app/dashboard"
)

CLICK_ELEMENTS=(
    "Dashboard Overview tab"
    "XDR Workbench - Alert List"
    "Alert detail: Suspicious PowerShell execution"
    "Search & Investigation"
    "Run query: endpoint activity last 24h"
    "Endpoint Protection sidebar"
    "Policy configuration panel"
    "Endpoint Inventory list"
    "Zero Trust - Endpoint posture"
    "Risk score details expand"
    "Attack Surface Discovery"
    "Internet-facing asset detail"
    "Email Security overview"
    "Quarantined phishing attempt detail"
    "Return to Dashboard summary"
)

CLICK_X=(450 320 680 290 550 180 620 400 310 520 380 600 250 580 450)
CLICK_Y=(280 350 420 310 380 260 340 300 350 420 290 380 320 400 280)

# Narration messages shown to judges as each click happens
CLICK_NARRATION=(
    "SE opens the Vision One dashboard -- showing unified threat overview"
    "Navigating to XDR Workbench to show real-time alerts"
    "Drilling into a suspicious PowerShell alert to demonstrate investigation"
    "Opening Search & Investigation for threat hunting demo"
    "Running a cross-layer search query -- endpoint activity last 24 hours"
    "Switching to Endpoint Protection to show policy management"
    "Showing granular policy configuration for healthcare compliance"
    "Browsing Endpoint Inventory -- all managed devices at a glance"
    "Demonstrating Zero Trust posture assessment for endpoints"
    "Expanding risk score breakdown for a specific device"
    "Opening Attack Surface Discovery -- internet-facing assets"
    "Drilling into an exposed asset detail for remediation"
    "Navigating to Email Security -- phishing protection demo"
    "Showing a quarantined phishing attempt with AI analysis"
    "Returning to Dashboard for a summary wrap-up"
)

# Transcript segments -- a realistic booth conversation
TRANSCRIPT='[
  {"start_ms": 0, "end_ms": 8000, "speaker": "SE", "text": "Welcome to the Trend Micro booth. I am Tom, one of our solution engineers. What brings you to the show today?"},
  {"start_ms": 8000, "end_ms": 18000, "speaker": "Visitor", "text": "Hi Tom. I am Maria Rodriguez, Director of Security Operations at Pacific Northwest Health Systems. We are a regional hospital network and honestly our SOC is drowning in alerts. We have six different security tools that do not talk to each other."},
  {"start_ms": 18000, "end_ms": 28000, "speaker": "SE", "text": "That is a really common challenge in healthcare. Let me show you how Vision One XDR can unify all of that. Here is our dashboard -- you can see every alert source correlated in one place. No more swivel-chair between consoles."},
  {"start_ms": 30000, "end_ms": 42000, "speaker": "SE", "text": "Let me pull up a real alert. This PowerShell execution was flagged across endpoint and network telemetry simultaneously. In your current setup, those would be two separate alerts in two different tools."},
  {"start_ms": 42000, "end_ms": 52000, "speaker": "Visitor", "text": "That is exactly our problem. Our SIEM gets fifty thousand events per day and the analysts spend half their time just triaging. Can Vision One actually reduce that volume?"},
  {"start_ms": 52000, "end_ms": 64000, "speaker": "SE", "text": "Great question. Let me show you the Search and Investigation module. We correlate across endpoint, email, network, and cloud -- so what used to be fifty alerts becomes one incident with full context. Customers like yours typically see a seventy percent reduction in alert volume."},
  {"start_ms": 64000, "end_ms": 72000, "speaker": "Visitor", "text": "What about compliance? We are HIPAA regulated and our auditors want to see endpoint policy enforcement across all fifteen thousand endpoints."},
  {"start_ms": 72000, "end_ms": 82000, "speaker": "SE", "text": "Absolutely. Here is our Endpoint Protection policy panel. You can define compliance baselines and Vision One continuously monitors drift. For example, if an endpoint disables real-time scanning, you get an alert and can auto-remediate."},
  {"start_ms": 84000, "end_ms": 92000, "speaker": "SE", "text": "And here is the Zero Trust posture assessment. Each endpoint gets a risk score based on patch level, configuration, and behavior. You can set access policies -- high-risk devices get restricted until remediated."},
  {"start_ms": 92000, "end_ms": 100000, "speaker": "Visitor", "text": "That is interesting. We have been evaluating zero trust solutions but most of them do not integrate with our existing endpoint security. Is this all one platform?"},
  {"start_ms": 100000, "end_ms": 110000, "speaker": "SE", "text": "That is the key differentiator. Vision One is a single platform -- XDR, endpoint, zero trust, email security, attack surface management. One agent, one console, one data lake. No integration headaches."},
  {"start_ms": 110000, "end_ms": 118000, "speaker": "Visitor", "text": "What about our email? We had a BEC incident last quarter that cost us two hundred thousand dollars. Our current email gateway missed it completely."},
  {"start_ms": 118000, "end_ms": 128000, "speaker": "SE", "text": "Let me show you our Email Security module. We use AI-powered writing style analysis to detect impersonation. Here is a quarantined phishing attempt -- the system flagged it because the writing style did not match the supposed sender, even though the email address looked legitimate."},
  {"start_ms": 128000, "end_ms": 135000, "speaker": "Visitor", "text": "OK I am impressed. What would a proof of concept look like? We have budget approved for this quarter and I would love to get my team evaluating this."},
  {"start_ms": 135000, "end_ms": 145000, "speaker": "SE", "text": "Perfect. We can set up a thirty-day POC with your actual environment. I will have our healthcare specialist reach out to scope it. Can I scan your badge so we can get that started?"},
  {"start_ms": 145000, "end_ms": 150000, "speaker": "Visitor", "text": "Absolutely. Here you go. This has been the best demo I have seen today -- finally someone who understands the healthcare SOC problem."}
]'

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

banner

log_info "Session ID: ${BOLD}${SESSION_ID}${RESET}"
log_info "Output dir: ${BOLD}${SESSION_DIR}${RESET}"
echo ""

# Create directory structure
mkdir -p "$SCREENSHOTS_DIR"
log_success "Created session directory"

# ---------------------------------------------------------------------------
# Phase 1: Badge scan (visitor metadata)
# ---------------------------------------------------------------------------
echo ""
echo -e "${BOLD}--- Phase 1: Badge Scan ---${RESET}"
sleep 2

cat > "${SESSION_DIR}/badge.json" << 'BADGE_EOF'
{
    "name": "Maria Rodriguez",
    "title": "Director of Security Operations",
    "company": "Pacific Northwest Health Systems",
    "email": "mrodriguez@pnwhealth.example.com",
    "industry": "Healthcare",
    "company_size": "10,000 - 25,000 employees",
    "scanned_at": "SESSION_TIMESTAMP"
}
BADGE_EOF

# Patch in actual timestamp
sed -i "s/SESSION_TIMESTAMP/$(date -u +%Y-%m-%dT%H:%M:%SZ)/" "${SESSION_DIR}/badge.json"

log_success "Badge scanned: ${BOLD}${VISITOR_NAME}${RESET} -- ${VISITOR_TITLE}, ${VISITOR_COMPANY}"
sleep 1

# ---------------------------------------------------------------------------
# Phase 2: Click stream (incremental, ~5s intervals)
# ---------------------------------------------------------------------------
echo ""
echo -e "${BOLD}--- Phase 2: Live Click Capture ---${RESET}"
log_info "Recording screen activity... clicks will appear every ${CLICK_INTERVAL}s"
echo ""

SECONDS=0   # reset bash timer for elapsed_ms

# Initialize clicks.json as empty array
echo "[]" > "${SESSION_DIR}/clicks.json"

NUM_CLICKS=${#CLICK_URLS[@]}

for (( i=0; i<NUM_CLICKS; i++ )); do
    ms=$(elapsed_ms)
    click_num=$(printf "%03d" $((i + 1)))

    # Build the click JSON object
    click_json=$(cat <<CLICK_EOF
{
    "timestamp": ${ms},
    "url": "${CLICK_URLS[$i]}",
    "element": "${CLICK_ELEMENTS[$i]}",
    "x": ${CLICK_X[$i]},
    "y": ${CLICK_Y[$i]}
}
CLICK_EOF
)

    # Append to clicks.json array
    # Read current array, strip trailing ], append new entry, close ]
    if [ "$i" -eq 0 ]; then
        echo "[${click_json}]" > "${SESSION_DIR}/clicks.json"
    else
        # Remove trailing ] and newline, append comma + new entry + ]
        sed -i '$ s/]$//' "${SESSION_DIR}/clicks.json"
        echo ",${click_json}]" >> "${SESSION_DIR}/clicks.json"
    fi

    # Create a placeholder screenshot
    echo "JPEG placeholder -- click-${click_num} at ${ms}ms" > "${SCREENSHOTS_DIR}/click-${click_num}.jpg"

    # Print narration
    log_action "Click ${click_num}/${NUM_CLICKS}: ${CLICK_NARRATION[$i]}"

    # Wait for next click (skip wait after last)
    if [ "$i" -lt $((NUM_CLICKS - 1)) ]; then
        sleep "$CLICK_INTERVAL"
    fi
done

echo ""
log_success "Click capture complete: ${NUM_CLICKS} events recorded"

# ---------------------------------------------------------------------------
# Phase 3: Transcript generation (simulates audio processing)
# ---------------------------------------------------------------------------
echo ""
echo -e "${BOLD}--- Phase 3: Transcript Processing ---${RESET}"
log_info "Processing audio recording..."
sleep 3

echo "$TRANSCRIPT" > "${SESSION_DIR}/transcript.json"

log_success "Transcript generated: 16 segments, 2m 30s of conversation"
sleep 1

# Also write a combined audio placeholder
echo "WEBM audio placeholder -- 150 seconds of booth conversation" > "${SESSION_DIR}/audio.webm"
log_info "Audio file saved (placeholder)"

# ---------------------------------------------------------------------------
# Phase 4: Ready trigger
# ---------------------------------------------------------------------------
echo ""
echo -e "${BOLD}--- Phase 4: Session Complete ---${RESET}"
sleep 2

touch "${SESSION_DIR}/ready"

log_done "Trigger file written -- session is ready for analysis"

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo ""
echo -e "${BOLD}============================================================${RESET}"
echo -e "${GREEN}${BOLD}  SESSION CAPTURE COMPLETE${RESET}"
echo -e "${BOLD}============================================================${RESET}"
echo ""
echo -e "  Session ID:   ${BOLD}${SESSION_ID}${RESET}"
echo -e "  Visitor:      ${VISITOR_NAME} (${VISITOR_COMPANY})"
echo -e "  Duration:     ${SECONDS} seconds"
echo -e "  Clicks:       ${NUM_CLICKS} events"
echo -e "  Transcript:   16 segments"
echo -e "  Directory:    ${SESSION_DIR}/"
echo ""
echo -e "  ${DIM}Files:${RESET}"
echo -e "  ${DIM}  badge.json        -- visitor metadata${RESET}"
echo -e "  ${DIM}  clicks.json       -- ${NUM_CLICKS} timestamped click events${RESET}"
echo -e "  ${DIM}  screenshots/      -- ${NUM_CLICKS} frame captures${RESET}"
echo -e "  ${DIM}  transcript.json   -- conversation transcript${RESET}"
echo -e "  ${DIM}  audio.webm        -- audio recording (placeholder)${RESET}"
echo -e "  ${DIM}  ready             -- pipeline trigger${RESET}"
echo ""
echo -e "  ${CYAN}The watcher pipeline can now pick up this session.${RESET}"
echo -e "  ${CYAN}Run: npm run watcher  (in another terminal)${RESET}"
echo ""
