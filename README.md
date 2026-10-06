# Site checks for psychsafety.com and iterum.co.uk

Automated checks that tell us when either website breaks, and show what changed after an update. They visit the sites the way a reader would. They never log in, buy anything, send an email or sign anyone up.

## What runs, and when

| When | What it checks | Time |
|---|---|---|
| **Every hour** | Key pages load, with no WordPress or PHP error. The contact form, payment page, search and RSS feed work. Pages are still visible to search engines, and nothing points at the dev site. The security certificate isn't about to expire. | About a minute |
| **Every morning** (06:23 UK) | Everything above, plus every page and post on the site, every Buy Now button, and the redirects from the old domain and from www. Then the key pages and journeys are checked in a real browser, at desktop and phone sizes. | About 25 minutes |
| **Before and after an update** (run by hand) | The morning checks, plus full-page pictures of every key page. After the update, a report shows exactly what changed. | About 25 minutes |
| **Whenever the checks change** | The checks are run against a deliberately broken fake site, to prove they still catch problems. | Under a minute |

### What the browser checks look for

- **Header:** exactly one, with the logo. On phones, the menu opens.
- **Footer:** the Privacy Policy and Terms of Business links are there.
- **Font:** Jost loads and is used for body text.
- **Content:** nothing stays invisible after you scroll to it, which is how broken fade-in animations show up.
- **Images:** none are broken.
- **Back-to-top button:** appears once you scroll, and works.
- **Scripts and files:** none of our own scripts crash, and none of our files fail to load.
- **Journeys:**
  - Search finds articles.
  - Buy Now opens a payment box with a price and Stripe's card field. Nothing is paid.
  - The contact form rejects an empty message, without sending anything.
  - The newsletter form is there. Nothing is submitted.

## When something breaks

If the hourly check fails twice in a row (two minutes apart, to rule out a blip), it opens an issue in this repository and assigns it to Tom. GitHub then emails him. While the problem continues, the issue is only updated when what's failing changes. When everything passes again, it says so and closes itself. The morning check works the same way, with its own issue.

To make sure the emails arrive, open **Watch** at the top of this repository and choose **All activity**. Also check that email is switched on under *Settings → Notifications*.

## Before and after an update (for whoever does the update)

1. Go to **Actions → Before and after an update → Run workflow** and choose **before**. Wait for it to finish (about 25 minutes). If anything is already failing, note it, so you don't blame the update for it later.
2. Do the update: plugins, theme or WordPress.
3. Run the same workflow again and choose **after**.
4. Open the run and download **before-after-report**. Open `index.html` inside it. Pages are listed by how much they changed, with the old and new pictures side by side and the changes highlighted in red.
5. If the "after" run fails or the report shows something unexpected, roll back first and investigate second.

Pages with live content, such as the latest articles, will always show some change. Check the pages at the top of the list first.

### Checking the dev copy

Run the same workflow with the dev address in the **psychsafety.com address** box, for example `https://dev.psychsafety.com`. If the dev copy is password-protected, add a repository secret called `DEV_SITE_AUTH` containing `username:password` (*Settings → Secrets and variables → Actions*). It is only ever sent to addresses that aren't the live site.

## Running it on your own computer

You need Node.js 20 or later.

```bash
npm ci
npx playwright install chromium
npm run smoke            # the hourly checks
npm run full             # every page, product and redirect
npx playwright test      # the browser checks
npm run capture -- before   # pictures before an update
npm run capture -- after    # pictures after
npm run compare             # report in snapshots/compare-before-vs-after/index.html
npm run test:self        # prove the checks catch a broken site
```

To check a different copy of a site, set `SITE_URL_PSYCHSAFETY=https://dev.psychsafety.com`, and if needed `SITE_AUTH_PSYCHSAFETY=username:password`.

## Changing what's checked

Everything site-specific is in `sites.mjs`: which pages to check, the text each should contain, where the Buy Now buttons are, and which redirects should work. If a page moves, change it there.

**Known issues** are listed against a page in `sites.mjs` (for example `knownIssues: ['mobile-menu']`). They're reported, but they don't fail the checks. Once one is fixed, the report says so, and you remove the line.

Current known issues:
- **psychsafety.com:** on phones, the Shop page's header has no menu button until you scroll down. Found 6 October 2026.
- **iterum.co.uk:** the home page throws JavaScript errors ("wp is not defined", "tns is not defined"). This usually means scripts are loading in the wrong order, for example because a speed plugin delays them, and it can stop a slider working. Found 6 October 2026.

## What these checks can't see

- **Whether emails arrive.** The contact form is tested up to the point of sending, not beyond.
- **Real payments.** We check that the payment box and Stripe's card field load, but never pay.
- **The admin side of WordPress**, server error logs, backups, or how long a restore takes.
- **iterum.co.uk in depth.** For now only the home page is checked, at desktop and phone sizes. Add more pages to `sites.mjs` as needed.

## Cost

This runs on GitHub Actions.

- **Public repository:** the minutes are free and unlimited. But anyone can see the alert issues, and GitHub switches off scheduled checks after 60 days without a commit.
- **Private repository:** the hourly check uses about 720 minutes a month and the morning check about 750. That's within the 2,000 free minutes a month. Each before-and-after run adds about 30 minutes.
