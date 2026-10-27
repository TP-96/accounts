# Hearth

Bill splitting for roommates, a less janky Splitwise: unlimited bills, no ads, no paywall. It runs as a website, an installable home-screen app, and (optionally) iPhone and Android apps.

- **Looking after the house's copy?** Read **[OWNER-GUIDE.md](OWNER-GUIDE.md)**. It's plain English, with no coding.
- **Thinking about the app stores?** Read **[MOBILE.md](MOBILE.md)**.

## What it does
- **Accounts:**
  - one account per roommate, and you join a house with an invite link
  - sign in and sign up with a 6-digit code emailed to you (no password needed), so every address is verified
  - a password is optional and secondary; forgotten passwords are reset by an emailed code
  - without email set up it falls back to email and password
  - nobody can reset another person's password
  - settled-up roommates can move out
- **Bills:**
  - each bill has a name, description, category, date and who paid
  - split equally, by amount, by percentage, or by shares (e.g. 2 shares for a couple), always exact to the cent
  - comments on any bill (everyone on it is notified)
  - deleted bills can be restored for 90 days
  - bills can repeat weekly or monthly
- **Receipt scanning:**
  - snap or upload a receipt, and it fills in the amount, name, date, category and items
  - text recognition (OCR) runs **on the device**, so the photo is never uploaded
  - anything filled in automatically is highlighted for checking
- **Notifications:**
  - in-app for every bill, payment, edit and reminder
  - also by email if SMTP is set up (the same email setup sends the sign-in codes)
- **Payments:**
  - "I paid" on a bill, or record any payment
  - balances update instantly
  - "simplify debts" shows the fewest payments that settle the whole house
- **Balances:** a statement showing what you owe each roommate and what each owes you, with the total underlined.
- **Stats:**
  - spending per month (your share versus everyone else's), by category, and who has been paying up front
  - your monthly average, the biggest bills, and what repeating bills cost
- **e-Transfer details:** each person can save where they like to be paid, shown to roommates when they pay them back.
- **Ledger:** every transaction from any roommate's point of view, overall or with one person, with a running balance.
- **Excel export:** transactions, bill splits, balances, and a ledger sheet per roommate.
- **Light and dark mode.**

## Running it on your computer
Requires Node.js 22. No database to install: locally it uses an embedded Postgres (PGlite).

```bash
npm run setup        # install everything
npm run build        # build the website
npm start            # http://localhost:3001
npm run seed         # optional: 3 demo roommates (maya/jon/sam@demo.test, password demo1234)
npm test             # all tests
```

For development with live reload, run `npm run dev:server` and `npm run dev:client` in two terminals, then open http://localhost:5173.

There's also a command-line receipt scanner: `npm run scan -- receipt.jpg` prints the fields Hearth would fill in.

## How it's deployed
- **Vercel:** `vercel.json` builds `client/` into a static site. All `/api/*` requests go to one serverless function, `api/index.js`, which wraps the Express app. A daily cron creates any repeating bills that are due.
- **Neon Postgres:** connected through Vercel's Storage tab, which sets `DATABASE_URL` automatically.
- **Updates:** every push to `main` deploys automatically, and GitHub Actions runs the tests (`.github/workflows/tests.yml`).

## Project layout
```
api/index.js           Vercel entry point (re-exports the Express app)
server/src/
  app.js               Express app: CORS, auth, routes, export, cron endpoint
  db.js                Postgres layer (Neon in production, PGlite locally/tests), schema + numbered migrations
  routes/extras.js     stats, comments, restoring deleted bills
  money.js             split maths in integer cents
  balances.js          pairwise balances, debt simplification, ledger
  routes/codes.js      emailed sign-in / sign-up / password-reset codes
  bills.js recurring.js export.js notify.js auth.js routes/
client/src/
  pages/ components/   React UI
  lib/receipt/         on-device OCR (scan.js) + receipt parser (parse.js)
  lib/platform.js      web vs. native-app differences (API URL, token storage)
  styles.css           the whole design system ("house account book")
client/android, client/ios   Capacitor native projects
```

## Design
"The house account book":
- ledger-paper greens, with red ink for what you owe and green ink for what you're owed
- a highlighter mark on anything filled in automatically
- one typeface, Schibsted Grotesk, bundled with the app
- rules carry meaning: a single rule separates entries, and a double rule marks a total

All colours are tokens at the top of `client/src/styles.css`.
