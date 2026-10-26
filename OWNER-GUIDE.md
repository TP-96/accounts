# Hearth: owner's guide

This guide is for whoever looks after Hearth for the house. You don't need to know how to code. Everything happens in your web browser.

**The short version:** Hearth runs on two free services that look after themselves.

- **Vercel** runs the website. Whenever the code on GitHub changes, Vercel updates the site by itself.
- **Neon** stores the bills and payments, and backs them up automatically.

Most months you won't need to do anything at all.

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

### Optional: email notifications
Without this, notifications still appear inside Hearth (the bell). To also send emails:

1. In your Google account, turn on 2-Step Verification. Then search for **App passwords** and create one called "Hearth".
2. In Vercel, go to **Settings**, then **Environment Variables**, and add each name and value below:

   | Name | Value |
   |---|---|
   | `SMTP_HOST` | `smtp.gmail.com` |
   | `SMTP_PORT` | `587` |
   | `SMTP_USER` | your Gmail address |
   | `SMTP_PASS` | the 16-letter app password |
   | `MAIL_FROM` | `Hearth <your Gmail address>` |

3. Redeploy (open **Deployments**, click **⋯**, then **Redeploy**).

---

## 2. Everyday tasks

| Situation | What to do |
|---|---|
| **A new roommate moves in** | **Settings → Copy invite link**, then send it to them. |
| **Someone forgot their password** | Anyone in the house: **Settings → Roommates → Reset password** next to their name, then send them the link. It works once and expires after 3 days. |
| **Someone moves out** | Make sure they're all square first (their balances show "—" on the home page). Then go to **Settings → Roommates → Remove** (or **Move out** for yourself). Their old bills stay in the history. |
| **A bill was entered wrong** | Open it from **Bills**, then click **Edit** or **Delete**. Everyone on it is told. |
| **A payment was entered wrong** | **Settle up → Payments so far**, then the bin icon next to it. |
| **Rent or internet repeats every month** | Choose **Repeats: every month** when adding it. To stop it: **Bills → Repeating bills → Stop**. |
| **You want a copy of everything** | **Settings → Download Excel file.** Doing this every few months is a nice extra backup. |
| **Someone's invite link leaked** | **Settings → Make a new code.** The old link stops working. |

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
| Emails stopped arriving | The Gmail app password was probably revoked. Make a new one and update `SMTP_PASS` in Vercel, then redeploy. |
| Everyone in the house is locked out | Rare. Ask the person (or Claude) who maintains the code to make a reset link from the database. |

**Getting help:** in Vercel, the **Logs** tab shows recent errors. Copying the red lines into a message to Claude is usually enough to get a fix.

### Backups
Neon keeps automatic restore points, and the free plan covers roughly the last day. To roll the data back, open the Neon dashboard and go to **Branches** (or **Restore**). For a long-term copy, use **Settings → Download Excel file** in Hearth now and then.

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
- **Share reset links anywhere except with the person they're for.**
- **Rename or delete the GitHub repository** without reconnecting it in Vercel afterwards.
