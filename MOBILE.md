# Hearth on phones: your options

There are three ways roommates can use Hearth on a phone. They're listed from least to most upkeep.

## Option A: home-screen web app (recommended, zero upkeep)
Open the site, then tap **Add to Home Screen** (iPhone: Safari Share menu; Android: Chrome ⋮ menu → **Install app**).

It gets its own icon, opens full-screen, and scans receipts with the camera. It's always up to date because it *is* the website: there are no store fees, no reviews and no yearly updates. For a house of roommates, this is all you need.

## Option B: Android app (moderate upkeep)
The `client/android` folder is a ready-made Android project.

**Try it without installing anything:**
1. On GitHub, open the repository, then **Settings → Secrets and variables → Actions → Variables → New repository variable**.
   - Name: `HEARTH_API_URL`
   - Value: your Vercel address, e.g. `https://hearth-abc123.vercel.app`
2. Open the **Actions** tab, then **Android test build**, then **Run workflow**.
3. When it finishes (about 5 minutes), download **hearth-android-debug** from the run page and unzip it. Copy `app-debug.apk` to an Android phone and open it. Android will ask you to allow installing from that app; say yes.

**Publishing on Google Play** costs **US$25 once**. You also need:

- a signed release build, made in Android Studio with **Build → Generate Signed App Bundle**
- a privacy policy page
- a short questionnaire about data and content

Upkeep: about once a year, Google requires apps to target a newer Android version. If you skip it, the listing is hidden from new users. Expect to spend an hour a year on this, or to ask a developer.

## Option C: iPhone App Store (most upkeep)
The `client/ios` folder is a ready-made iPhone project, but building it **requires a Mac with Xcode**. Publishing also requires an **Apple Developer account at US$99 per year**.

Steps on a Mac:

1. Install Xcode from the Mac App Store, and Node.js 22 from nodejs.org.
2. Put your Vercel address in `client/.env.mobile` (copy it from `client/.env.mobile.example`).
3. In Terminal, inside the project folder, run:
   ```
   npm run setup
   npm run build:mobile
   npm --prefix client run ios
   ```
4. In Xcode, choose your team under **Signing & Capabilities**, then **Product → Archive**, then **Distribute App**.

Things to know:
- **Apple might reject it.** Apple sometimes turns down apps that mostly show a website (review guideline 4.2). On-device receipt scanning and a native feel help, but it can still happen.
- **Ongoing costs:** the $99 fee renews every year, and Xcode updates occasionally require rebuilding.

## Changing the app's ID before you publish
Both store apps use the ID `io.github.tp96.hearth`, set in `client/capacitor.config.json`. Once an app is published, its ID can never change, so if you want a different one (for example `ca.yourname.hearth`), change it before the first upload.

## When you change the website
Store apps load the website's look and code from inside the app. After changing the design or features, rebuild them with `npm run build:mobile`, or re-run the Android workflow, and upload new versions. The home-screen web app (Option A) updates by itself.
