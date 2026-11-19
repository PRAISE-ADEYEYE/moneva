# Moneva

**Pay and get paid in the language you think in.**

Moneva is a multilingual payments app for local traders and small businesses in Nigeria. People send, receive and track payments in Simple Nigerian English, Yoruba, Nigerian Pidgin or French, through WhatsApp or an installable web app. Both channels use the same account, language setting and transaction records.

Built for the CU Next Gen Hackathon, Track 2: Inclusive Payments and Financial Access. It uses the Interledger Open Payments API on the Interledger test network. No real money moves.

**Team:** [REPLACE: team name and members]
**Live prototype:** [REPLACE: Vercel address]
**Demo video:** [REPLACE: video link]

## The problem

Many underserved Nigerians, especially local traders and small businesses, find digital payments hard. Most payment apps speak one language, show unfamiliar financial terms, hide fees until late, and assume the user is confident with technology. A market trader who is more comfortable in Yoruba or Pidgin should not have to guess what a button means before moving money.

## Who it is for

Local traders and small business owners in Nigeria with limited digital confidence, including people who prefer Yoruba or Nigerian Pidgin, and traders who deal with French speaking neighbours.

## What Moneva does

* The whole interface, errors, notifications and transaction updates switch between four languages at once. The choice is saved on the device and on the Firebase profile.
* A trader can use the web app or WhatsApp. They can link both to one account and move between them.
* Before any payment the user sees what they pay, what the other person receives and the fee, in plain words.
* Nothing moves until the user approves on their own wallet provider page. Moneva never sees wallet passwords.
* Transaction status is shown honestly: waiting for approval, pending, done, failed or cancelled.

## How Moneva uses Interledger Open Payments

The Cloudflare Worker (worker.js) implements the Open Payments flow directly, with no SDK, using Ed25519 HTTP message signatures and GNAP grants. For one send it does this:

1. Reads the receiver wallet address document and the sender wallet address document to discover the authorization server and resource server.
2. Requests a non interactive grant from the receiver authorization server and creates an incoming payment for the amount.
3. Requests a quote grant from the sender authorization server and creates a quote against that incoming payment.
4. Requests an interactive outgoing payment grant limited to the quoted amounts. The user is redirected to their wallet provider to approve.
5. On return, continues the grant with the interact_ref, verifies the callback hash, and creates the outgoing payment from the quote.
6. Reads the outgoing payment to confirm the real status before marking it completed.

Receiving creates an incoming payment on the user wallet and returns the payment request link.

Every request to an Open Payments server is signed with the Moneva client key registered on the test wallet. The private key is stored only as a Cloudflare secret.

## Architecture

```
Browser (PWA on Vercel)  <--->  Cloudflare Worker  <--->  Interledger test wallets
WhatsApp user  <---> Meta Cloud API  <--->  Cloudflare Worker
                                   |
                    Firebase Auth and Firestore (shared by both channels)
```

* Frontend: vanilla HTML, CSS and JavaScript, each page standalone with inline style and script.
* Backend: one Cloudflare Worker (worker.js).
* Auth and data: Firebase Authentication and Firestore with security rules. The Worker verifies Firebase ID tokens and writes payment records with a service account.
* PWA: manifest.json, sw.js, offline page, install popup and update prompt.

## Status of each feature

| Feature | Status |
| --- | --- |
| Landing page, signup, login, dashboard | Implemented |
| Four languages with persistence and Firebase sync | Implemented |
| PWA install, offline shell, update prompt | Implemented |
| Idle logout after 240 seconds, synced across tabs | Implemented |
| Open Payments send flow with user approval | Implemented. Verified against mocked servers. Live test wallet result: [REPLACE after your live test] |
| Payment requests (incoming payments) | Implemented |
| WhatsApp bot: link, menu, send, receive, history, language | Implemented. Verified against a mocked Meta API. Live result: [REPLACE after your live test] |
| Wallet balance | Not available. Open Payments does not expose balances, so the app shows payment activity |
| Real money | Not used. Test network only |
| Simulated payments | None. Nothing is faked |

Planned, not built: native speaker review of Yoruba and Pidgin, WhatsApp message templates for alerts outside the 24 hour window, rate limiting, a permanent WhatsApp business number, user testing with real traders.

## Security

* Private keys and the service account are Worker secrets, never in the repository.
* The Worker verifies every Firebase ID token, restricts CORS to the app origin and only talks to Interledger test environment wallets.
* WhatsApp webhooks are verified with the Meta signature. Repeated messages are ignored. Link codes are single use and expire in 10 minutes.
* Firestore rules let users read only their own data. Users cannot write transactions or their WhatsApp link.
* Payments need explicit approval on the wallet provider page. Duplicate confirmations are blocked.

## Repository structure

```
index.html            landing page
auth/login            login page
auth/signup           signup page
dashboard             main app
manifest.json, sw.js, offline.html, icons, favicon.ico   PWA
worker.js             Cloudflare Worker (Open Payments, WhatsApp, token checks)
firestore.rules       Firestore security rules
vercel.json           routing and headers
tests                 automated checks
DEPLOYMENT.md         full setup guide
```

## Setup and reproduction

Follow DEPLOYMENT.md. In short: create a Firebase project, deploy worker.js to Cloudflare with the variables and secrets listed there, put the Worker address in dashboard/index.html, and deploy the folder to Vercel.

Environment names used by the Worker (values are never committed): FIREBASE_PROJECT_ID, FIREBASE_SA, OP_WALLET_ADDRESS, OP_KEY_ID, OP_PRIVATE_KEY, ALLOWED_ORIGINS, FRONTEND_URL, and for WhatsApp WA_PHONE_ID, WA_DISPLAY_NUMBER, WA_VERIFY_TOKEN, WA_TOKEN, WA_APP_SECRET.

**Safe test instructions for judges:** open the live link, create an account, add a test wallet address in Settings, and send to a second test wallet. Use only Interledger test wallets and test funds.

## Testing

```
cd tests
npm install
npm test
```

The tests run the Worker against mocked Open Payments, Google, Firestore and Meta servers. They verify that every outbound signature is valid, that tokens are checked, that the send, approval and status flow works, that the WhatsApp bot behaves correctly, and that the service worker and install UI behave correctly. They do not replace a live test on the real test wallet.

## Disclosures

* **AI assistance:** The code, translations drafts and documents were produced with substantial help from Claude by Anthropic. The team reviewed and is responsible for the work.
* **Prior work:** [REPLACE: state that all code was written during the build window, or list any earlier code]
* **Dependencies and licenses:** Firebase JS SDK 10.12.2 from the Google CDN (Apache 2.0). Plus Jakarta Sans from Google Fonts (SIL Open Font License). jsdom for tests only (MIT). Services used on free plans: Firebase, Cloudflare Workers, Vercel, Meta WhatsApp Cloud API test number, Interledger test wallet.
* **License of this repository:** [REPLACE: your chosen license]

## Limitations

The Meta test number reaches up to 5 approved phone numbers. Free text WhatsApp replies only work within 24 hours of the user last writing. Yoruba and Pidgin translations still need review by native speakers. The inclusion benefits described here are assumptions to validate with real traders, not measured results.

## Next steps

Interview and test with traders in a real market, review translations with native speakers, add WhatsApp message templates and rate limiting, and explore merchant payment links and recurring payments on Open Payments.
