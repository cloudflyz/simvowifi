"""E.212 Mobile Country Code (MCC) -> ISO 3166-1 alpha-2 country code.

Used to populate the industry-convention ``country=XX`` parameter on the SIP
``P-Access-Network-Info`` header for VoWiFi IMS registration when the operator
expects a country code and the user has not overridden it explicitly.

Source: ITU-T E.212 Annex to Operational Bulletin (MCC assignments). Shared /
test / reserved ranges that do not map to a single country are omitted so
``mcc_to_iso2`` returns "" rather than a misleading guess.
"""

# Flat MCC (3-digit string) -> ISO 3166-1 alpha-2. Shared MCCs that span multiple
# territories (e.g. 901 / international) are intentionally absent.
MCC_TO_ISO2 = {
    # Europe
    "202": "GR",  # Greece
    "204": "NL",  # Netherlands
    "206": "BE",  # Belgium
    "208": "FR",  # France
    "212": "MC",  # Monaco
    "213": "AD",  # Andorra
    "214": "ES",  # Spain
    "216": "HU",  # Hungary
    "218": "BA",  # Bosnia and Herzegovina
    "219": "HR",  # Croatia
    "220": "RS",  # Serbia
    "221": "XK",  # Kosovo (user-assigned ISO)
    "222": "IT",  # Italy
    "225": "VA",  # Vatican City
    "226": "RO",  # Romania
    "228": "CH",  # Switzerland
    "230": "CZ",  # Czech Republic
    "231": "SK",  # Slovakia
    "232": "AT",  # Austria
    "234": "GB",  # United Kingdom
    "235": "GB",  # United Kingdom
    "238": "DK",  # Denmark
    "240": "SE",  # Sweden
    "242": "NO",  # Norway
    "244": "FI",  # Finland
    "246": "LT",  # Lithuania
    "247": "LV",  # Latvia
    "248": "EE",  # Estonia
    "250": "RU",  # Russian Federation
    "255": "UA",  # Ukraine
    "257": "BY",  # Belarus
    "259": "MD",  # Moldova
    "260": "PL",  # Poland
    "262": "DE",  # Germany
    "266": "GI",  # Gibraltar
    "268": "PT",  # Portugal
    "270": "LU",  # Luxembourg
    "272": "IE",  # Ireland
    "274": "IS",  # Iceland
    "276": "AL",  # Albania
    "278": "MT",  # Malta
    "280": "CY",  # Cyprus
    "282": "GE",  # Georgia
    "283": "AM",  # Armenia
    "284": "BG",  # Bulgaria
    "286": "TR",  # Turkey
    "288": "FO",  # Faroe Islands
    "289": "GE",  # Abkhazia (uses GE numbering in many tables; omit if contested)
    "290": "GL",  # Greenland
    "292": "SM",  # San Marino
    "293": "SI",  # Slovenia
    "294": "MK",  # North Macedonia
    "295": "LI",  # Liechtenstein
    "297": "ME",  # Montenegro
    # Americas
    "302": "CA",  # Canada
    "308": "PM",  # Saint Pierre and Miquelon
    "310": "US",  # United States
    "311": "US",
    "312": "US",
    "313": "US",
    "314": "US",
    "315": "US",
    "316": "US",
    "330": "PR",  # Puerto Rico
    "332": "VI",  # US Virgin Islands
    "334": "MX",  # Mexico
    "338": "JM",  # Jamaica
    "340": "GP",  # Guadeloupe / Martinique / French Antilles
    "342": "BB",  # Barbados
    "344": "AG",  # Antigua and Barbuda
    "346": "KY",  # Cayman Islands
    "348": "VG",  # British Virgin Islands
    "350": "BM",  # Bermuda
    "352": "GD",  # Grenada
    "354": "MS",  # Montserrat
    "356": "KN",  # Saint Kitts and Nevis
    "358": "LC",  # Saint Lucia
    "360": "VC",  # Saint Vincent and the Grenadines
    "362": "CW",  # Curaçao / former Netherlands Antilles
    "363": "AW",  # Aruba
    "364": "BS",  # Bahamas
    "365": "AI",  # Anguilla
    "366": "DM",  # Dominica
    "368": "CU",  # Cuba
    "370": "DO",  # Dominican Republic
    "372": "HT",  # Haiti
    "374": "TT",  # Trinidad and Tobago
    "376": "TC",  # Turks and Caicos Islands
    # Asia / Middle East
    "400": "AZ",  # Azerbaijan
    "401": "KZ",  # Kazakhstan
    "402": "BT",  # Bhutan
    "404": "IN",  # India
    "405": "IN",
    "406": "IN",
    "410": "PK",  # Pakistan
    "412": "AF",  # Afghanistan
    "413": "LK",  # Sri Lanka
    "414": "MM",  # Myanmar
    "415": "LB",  # Lebanon
    "416": "JO",  # Jordan
    "417": "SY",  # Syria
    "418": "IQ",  # Iraq
    "419": "KW",  # Kuwait
    "420": "SA",  # Saudi Arabia
    "421": "YE",  # Yemen
    "422": "OM",  # Oman
    "424": "AE",  # United Arab Emirates
    "425": "IL",  # Israel / Palestinian territories share; IL is conventional for 425
    "426": "BH",  # Bahrain
    "427": "QA",  # Qatar
    "428": "MN",  # Mongolia
    "429": "NP",  # Nepal
    "430": "AE",  # UAE (additional)
    "431": "AE",
    "432": "IR",  # Iran
    "434": "UZ",  # Uzbekistan
    "436": "TJ",  # Tajikistan
    "437": "KG",  # Kyrgyzstan
    "438": "TM",  # Turkmenistan
    "440": "JP",  # Japan
    "441": "JP",
    "450": "KR",  # South Korea
    "452": "VN",  # Viet Nam
    "454": "HK",  # Hong Kong
    "455": "MO",  # Macao
    "456": "KH",  # Cambodia
    "457": "LA",  # Lao PDR
    "460": "CN",  # China
    "461": "CN",
    "466": "TW",  # Taiwan
    "467": "KP",  # North Korea
    "470": "BD",  # Bangladesh
    "472": "MV",  # Maldives
    # Oceania
    "502": "MY",  # Malaysia
    "505": "AU",  # Australia
    "510": "ID",  # Indonesia
    "514": "TL",  # Timor-Leste
    "515": "PH",  # Philippines
    "520": "TH",  # Thailand
    "525": "SG",  # Singapore
    "528": "BN",  # Brunei Darussalam
    "530": "NZ",  # New Zealand
    "536": "NR",  # Nauru
    "537": "PG",  # Papua New Guinea
    "539": "TO",  # Tonga
    "540": "SB",  # Solomon Islands
    "541": "VU",  # Vanuatu
    "542": "FJ",  # Fiji
    "543": "WF",  # Wallis and Futuna
    "544": "AS",  # American Samoa
    "545": "KI",  # Kiribati
    "546": "NC",  # New Caledonia
    "547": "PF",  # French Polynesia
    "548": "CK",  # Cook Islands
    "549": "WS",  # Samoa
    "550": "FM",  # Micronesia
    "551": "MH",  # Marshall Islands
    "552": "PW",  # Palau
    "553": "TV",  # Tuvalu
    "554": "TK",  # Tokelau
    "555": "NU",  # Niue
    # Africa
    "602": "EG",  # Egypt
    "603": "DZ",  # Algeria
    "604": "MA",  # Morocco
    "605": "TN",  # Tunisia
    "606": "LY",  # Libya
    "607": "GM",  # Gambia
    "608": "SN",  # Senegal
    "609": "MR",  # Mauritania
    "610": "ML",  # Mali
    "611": "GN",  # Guinea
    "612": "CI",  # Côte d'Ivoire
    "613": "BF",  # Burkina Faso
    "614": "NE",  # Niger
    "615": "TG",  # Togo
    "616": "BJ",  # Benin
    "617": "MU",  # Mauritius
    "618": "LR",  # Liberia
    "619": "SL",  # Sierra Leone
    "620": "GH",  # Ghana
    "621": "NG",  # Nigeria
    "622": "TD",  # Chad
    "623": "CF",  # Central African Republic
    "624": "CM",  # Cameroon
    "625": "CV",  # Cabo Verde
    "626": "ST",  # Sao Tome and Principe
    "627": "GQ",  # Equatorial Guinea
    "628": "GA",  # Gabon
    "629": "CG",  # Congo
    "630": "CD",  # DR Congo
    "631": "AO",  # Angola
    "632": "GW",  # Guinea-Bissau
    "633": "SC",  # Seychelles
    "634": "SD",  # Sudan
    "635": "RW",  # Rwanda
    "636": "ET",  # Ethiopia
    "637": "SO",  # Somalia
    "638": "DJ",  # Djibouti
    "639": "KE",  # Kenya
    "640": "TZ",  # Tanzania
    "641": "UG",  # Uganda
    "642": "BI",  # Burundi
    "643": "MZ",  # Mozambique
    "645": "ZM",  # Zambia
    "646": "MG",  # Madagascar
    "647": "RE",  # Réunion / Mayotte
    "648": "ZW",  # Zimbabwe
    "649": "NA",  # Namibia
    "650": "MW",  # Malawi
    "651": "LS",  # Lesotho
    "652": "BW",  # Botswana
    "653": "SZ",  # Eswatini
    "654": "KM",  # Comoros
    "655": "ZA",  # South Africa
    "657": "ER",  # Eritrea
    "658": "SH",  # Saint Helena
    "659": "SS",  # South Sudan
    # South America
    "702": "BZ",  # Belize
    "704": "GT",  # Guatemala
    "706": "SV",  # El Salvador
    "708": "HN",  # Honduras
    "710": "NI",  # Nicaragua
    "712": "CR",  # Costa Rica
    "714": "PA",  # Panama
    "716": "PE",  # Peru
    "722": "AR",  # Argentina
    "724": "BR",  # Brazil
    "730": "CL",  # Chile
    "732": "CO",  # Colombia
    "734": "VE",  # Venezuela
    "736": "BO",  # Bolivia
    "738": "GY",  # Guyana
    "740": "EC",  # Ecuador
    "742": "GF",  # French Guiana
    "744": "PY",  # Paraguay
    "746": "SR",  # Suriname
    "748": "UY",  # Uruguay
    "750": "FK",  # Falkland Islands
}


def mcc_to_iso2(mcc) -> str:
    """Return the ISO 3166-1 alpha-2 country for an E.212 MCC, or '' if unknown.

    Accepts int/str; non-digit noise is stripped. MCC is normalized to a 3-digit
    zero-padded string before lookup.
    """
    digits = "".join(ch for ch in str(mcc or "") if ch.isdigit())
    if not digits:
        return ""
    key = digits[:3].zfill(3)
    return MCC_TO_ISO2.get(key, "")
