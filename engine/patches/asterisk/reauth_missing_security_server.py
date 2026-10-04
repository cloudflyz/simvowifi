"""Answer any 401 challenge that arrives without a Security-Server header.

Derived from mdd-sim-gateway's reauth_missing_security_server.py (GPLv3), adapted for
carriers whose P-CSCF NEVER offers sec-agree — not only on mid-session re-challenges:

  * 3HK (Three Hong Kong) sends the INITIAL registration 401 without a Security-Server
    header (a TS 33.203 violation) and never establishes IMS-layer IPsec SAs at all —
    media protection comes from the ePDG tunnel's own ESP.  The sysmocom VoLTE code
    treats every 401 as an SA negotiation, so volte_get_security_server() failed the
    exchange before any credential was ever sent: Asterisk logged
    "'401' fatal response received ... retrying in '30' seconds" forever.
  * T-Mobile US re-challenges a mid-session re-REGISTER with a 401 that carries no
    Security-Server either: the network keeps the ESTABLISHED sec-agree SAs and expects
    the authenticated REGISTER over them (mdd's original case).

Fix (mdd's patch minus the volte.registered condition, per the 3HK finding): when the
header is genuinely ABSENT — regardless of registration state — skip the SA negotiation
path entirely and go straight to VOLTE_STATE_RESPONSE, so
ast_sip_create_request_with_auth() answers the challenge directly; old_request already
carries the current Security-Verify and P-Access-Network-Info headers when they exist.
A present-but-unparsable header stays fatal (a corrupt offer must not be ignored).
"""

import os
import sys
from pathlib import Path


SOURCE = Path(os.environ.get("AST_SRC", "/home/asterisk-build/asterisk")) \
    / "res/res_pjsip_outbound_registration.c"

MARKER = "PATCH reauth_missing_security_server"

ANCHOR = (
    '\t/* Get and select best candidate from "Security-Server" header. */\n'
    "\tif (volte_get_security_server(transport_state, response->rdata, &sec)) {\n"
)

FALLBACK = (
    "\t/* " + MARKER + ": a 401 challenge without a Security-Server header means the network\n"
    "\t * is NOT (re)negotiating sec-agree SAs.  T-Mobile US does this on mid-session\n"
    "\t * re-REGISTER (keeps the ESTABLISHED SAs); 3HK does it from the very first 401\n"
    "\t * and never establishes IMS-layer IPsec at all (media ride the ePDG tunnel's own\n"
    "\t * ESP).  Either way: skip the SA-negotiation path and answer the challenge\n"
    "\t * directly over the existing transport — old_request already carries the current\n"
    "\t * Security-Verify / P-Access-Network-Info headers when they exist.  A\n"
    "\t * present-but-unparsable header stays fatal. */\n"
    "\t{\n"
    '\t\tstatic const pj_str_t str_security_server = { "Security-Server", 15 };\n'
    "\n"
    "\t\tif (!pjsip_msg_find_hdr_by_name(response->rdata->msg_info.msg, &str_security_server, NULL)) {\n"
    '\t\t\tast_log(LOG_NOTICE, "401 challenge without \'Security-Server\'; skipping sec-agree "\n'
    '\t\t\t\t"and answering directly\\n");\n'
    "\t\t\tvolte_set_state(response->client_state, VOLTE_STATE_RESPONSE);\n"
    "\t\t\tret = 0;\n"
    "\t\t\tgoto out;\n"
    "\t\t}\n"
    "\t}\n"
    "\n"
)


def patch(source: str) -> str:
    if MARKER in source:
        return source

    fn_start = source.find("static int handle_volte_unauthorized(")
    if fn_start < 0:
        raise ValueError("handle_volte_unauthorized not found")

    anchor_at = source.find(ANCHOR, fn_start)
    if anchor_at < 0:
        raise ValueError("Security-Server anchor not found in handle_volte_unauthorized")
    if source.find(ANCHOR, anchor_at + 1) >= 0:
        raise ValueError("Security-Server anchor is not unique")

    return source[:anchor_at] + FALLBACK + source[anchor_at:]


try:
    original = SOURCE.read_text()
    updated = patch(original)
except (OSError, ValueError) as exc:
    print(f"reauth missing-Security-Server patch failed: {exc}", file=sys.stderr)
    raise SystemExit(1) from exc

if updated == original:
    print("re-auth without Security-Server already patched")
else:
    SOURCE.write_text(updated)
    print("patched handle_volte_unauthorized to skip sec-agree on ANY 401 "
          "without a Security-Server header (3HK / T-Mobile US)")
