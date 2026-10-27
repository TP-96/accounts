# Hearth: owner's guide

This guide is for whoever looks after Hearth for the house. You don't need to know how to code. Everything happens in your web browser.

**The short version:** Hearth runs on two free services that look after themselves.

- **Vercel** runs the website. Whenever the code on GitHub changes, Vercel updates the site by itself.
- **Neon** stores the bills and payments, and backs them up automatically.

Most months you won't need to do anything at all.

### Your Hearth
| | |
|---|---|
| **The website** (share this with roommates) | https://accounts-7hb6.vercel.app |
| **Control panel** (Vercel project) | https://vercel.com/tp-96/accounts-7hb6 |
| **Code** (GitHub) | https://github.com/TP-96/accounts |
| **Database** | `hearth-db`, under the **Storage** tab in Vercel |

Setup is already done (October 2026), so you can skip section 1 unless you ever need to set it up again from scratch. When connecting the database, the prefix must be `DATABASE`, so that Vercel creates a setting called `DATABASE_URL`.

---

## 1. One-time setup (about 15 minutes)

You'll need three free accounts: **GitHub** (you already have one), **Vercel** and **Neon**. Sign in to Vercel with your GitHub account. That's the easiest option, and it connects the two.

### Step 1: Put the site on Vercel
1. Go to **vercel.com** and choose **Sign Up**, then **Continue with GitHub**.
2. Click **Add New…**, then **Project**.
3. Find the **accounts** repository (where the Hearth code lives) and click **Import**. If it isn't listed, click **Adjust GitHub App Permissions** and allow access to it.
4. Leave every setting as it is and click **Deploy**.
5. The first deploy finishes in about a minute, but the site will say *"Database not connected yet"*. That's expected; Step 2 fixes it.

### Step 2: Add the database
1. In your new Vercel project, open the **Storage** tab.
2. Click **Create Database**, choose **Neon** (Serverless Postgres), and click **Continue**.
3. Accept the free plan. For **Region**, pick **Washington, D.C., USA (East)**, which is closest to the Vercel servers. Click **Create**.
4. When it asks which environments to connect, keep all of them ticked and click **Connect**.
5. Open the **Deployments** tab. Click the **⋯** menu on the newest deployment, then **Redeploy**.

### Step 3: Open it and set up your house
1. Your site's address is shown at the top of the Vercel project, for example `hearth-abc123.vercel.app`. Open it.
2. Create your account, then choose **Start your house**.
3. In **Settings**, click **Copy invite link** and send it to your roommates.

That's it. Bookmark the Vercel project page; it's your control panel.

### Optional: a nicer web address
In Vercel, go to **Settings**, then **Domains**, to use an address you own, for example `hearth.yourname.ca` (domains cost about $15/year from any registrar). Vercel walks you through it.

### Email (sign-in codes and notifications)
Once email is set up, everyone signs in and creates accounts with a **6-digit code emailed to them**. Passwords become optional, and forgotten passwords are reset by email. The same email account also sends the bill, payment and reminder emails. Without it, Hearth falls back to plain email and password sign-in, and notifications appear only inside the app (the bell).

1. In the Google account Hearth will send from, turn on 2-Step Verification. Then go to **myaccount.google.com/apppasswords** and create an app password called "Hearth".
2. In Vercel, go to **Settings**, then **Environment Variables**, and add each name and value below:

   | Name | Value |
   |---|---|
   | `SMTP_HOST` | `smtp.gmail.com` |
   | `SMTP_PORT` | `587` |
   | `SMTP_USER` | the Gmail address |
   | `SMTP_PASS` | the 16-letter app password (mark it **Secret**) |
   | `MAIL_FROM` | `Hearth <the Gmail address>` |

3. Redeploy (open **Deployments**, click **⋯**, then **Redeploy**). Vercel may ask for an emailed code to confirm it's you.

**Check it works:** open the site in a private window, choose **Sign in**, enter your email and click **Email me a code**. The email usually arrives within seconds (check spam the first time).

**Good to know:** codes work for 10 minutes and once only, wrong guesses are limited, and one address can ask for at most 6 codes an hour. Gmail lets an ordinary account send about 500 emails a day, which is far more than a house needs.

---

## 2. Everyday tasks

| Situation | What to do |
|---|---|
| **A new roommate moves in** | **Settings → House → Copy invite link**, then send it to them. |
| **Someone forgot their password** | They don't need a password at all: **Sign in → Email me a code**. To choose a new one, use **Use a password instead → Forgot password?**, which emails a code. Nobody can reset another person's password, not even the owner. Everything goes through the email on that account. |
| **Someone moves out** | Make sure they're all square first (their balances show "—" on the home page). Then an admin goes to **Settings → House → Remove** (anyone can tap **Move out** for themselves). Their old bills stay in the history. |
| **A bill was entered wrong** | Open it from **Bills**, then click **Edit** or **Delete**. Only the person who added a bill, or a house admin, can change, delete or restore it; anyone else can leave a comment on it asking for a fix. Everyone on it is told about changes. |
| **Signing out** | Tap your initials in the top-right corner, then **Sign out**. The same menu has shortcuts to your profile, appearance and all settings. |
| **Who runs the house (admins)** | Whoever creates a house is its admin. Admins can fix anyone's bills, remove roommates, rename the house, change its colour and make a new invite code. In **Settings → House**, an admin can tap **Make admin** next to someone (or **Step down**). If the last admin moves out, the roommate who has been there longest becomes admin automatically. Everyone can always move themselves out. |
| **You want different colours** | **Settings → Appearance → Theme** (a dropdown): Ledger green, Harbour blue, Plum, Ember or Graphite. Each works in light and dark mode and is saved per device. |
| **A bill was deleted by mistake** | **Bills**, scroll to **Recently deleted**, then **Restore**. Works for 90 days. |
| **You live in more than one house or group** | Tap the house name at the top, then **Add or join another house**. Each house has its own colour (change it in **Settings**), shown as a stripe across the top, so you always know which one you're in. Bills, balances and alerts stay separate per house, and the switcher shows unread alerts for the other houses. |
| **You want to see where the money goes** | The **Stats** page. **Overview** shows spending by month, by category and who's been paying up front. **Month** lets you pick any month and see its bills, categories and who paid. |
| **Roommates keep asking where to send money** | Each person adds their e-Transfer email or phone in **Settings → Profile → Where to send you money**. It then shows up whenever someone pays them back. |
| **A payment was entered wrong** | **Settle up → Payments so far**, then the bin icon next to it. |
| **Rent or internet repeats every month** | Choose **Repeats: every month** when adding it. To stop it: **Bills → Repeating bills → Stop**. |
| **You want a copy of everything** | **Settings → Your data → Download.** Doing this every few months is a nice extra backup. |
| **Someone's invite link leaked** | **Settings → House → New code.** The old link stops working. |

### Putting Hearth on your phone's home screen
It then opens full-screen like a normal app, with no app store needed.

- **iPhone:** open the site in **Safari**, tap the **Share** button, then **Add to Home Screen**.
- **Android:** open the site in **Chrome**, tap the **⋮** menu, then **Install app** (or **Add to Home screen**).

---

## 3. If something goes wrong

**Rule one: you can always undo a bad update.** In Vercel, open **Deployments**, find the last one that worked (they're listed by date), click **⋯**, then **Promote to Production** (also called *Instant Rollback*). The site goes back to that version in seconds, and no data is lost.

| What you see | What it means / what to do |
|---|---|
| *"Database not connected yet"* | Neon isn't linked. Repeat **Step 2** above, then redeploy. |
| *"Can't reach the database right now"* | Neon is briefly unavailable or waking up. Wait a minute and refresh. If it lasts more than an hour, check **neon.tech/status**. |
| *"Can't reach Hearth"* (in the app) | The phone has no internet, or Vercel is down. Check **vercel-status.com**. |
| The site is blank or broken after a change | Roll back (see Rule one), then ask whoever made the change to fix it. |
| Repeating bills didn't appear | They're created each morning, and also whenever someone opens the home page. Give it a day. If it still hasn't happened, check the bill under **Bills → Repeating bills**: if it's missing, it was paused because someone on it moved out, so add it again. |
| Emails (and sign-in codes) stopped arriving | The Gmail app password was probably revoked. Make a new one and update `SMTP_PASS` in Vercel, then redeploy. Until then, anyone who added a password in **Settings** can sign in with it (**Use a password instead**). |
| Everyone in the house is locked out | Rare. Fix the email settings (see the row above). Passwords can't be reset by anyone else, so the sign-in emails are the way back in. |

**Getting help:** in Vercel, the **Logs** tab shows recent errors. Copying the red lines into a message to Claude is usually enough to get a fix.

### Backups
Neon keeps automatic restore points, and the free plan covers roughly the last day. To roll the data back, open the Neon dashboard and go to **Branches** (or **Restore**). For a long-term copy, use **Settings → Your data → Download** in Hearth now and then.

---

## 4. What it costs

For one house, it's **$0**:

- **Vercel Hobby:** free for personal, non-commercial use.
- **Neon Free:** 0.5 GB of storage. A house adding 50 bills a month would take decades to fill it.
- **Optional costs:**
  - a custom domain, about $15/year
  - App Store and Google Play listings (see `MOBILE.md`)

## 5. Making changes

Ask Claude for the change, for example "add a category for pets". The code gets pushed to GitHub, and Vercel deploys it in about a minute. Every change is also checked by the automatic tests on GitHub, and you'll get an email if they fail. If an update ever misbehaves, roll back (see Rule one).

## 6. Please don't…
- **Delete the Neon database or the Vercel Storage connection.** That deletes the house's records.
- **Share sign-in codes with anyone.** A code is the key to that person's account.
- **Rename or delete the GitHub repository** without reconnecting it in Vercel afterwards.
