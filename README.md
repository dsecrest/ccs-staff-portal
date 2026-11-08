# Christian Center School — Staff Portal

A small website for incoming staff:

| Section | Who uses it | What happens |
|---|---|---|
| **Apply** | Anyone | Application + resume (and optional cover letter) → a **printable PDF of the application** is saved in their folder and emailed |
| **Recommendation Letters** | Applicants or their references | Letters filed with the applicant's folder |
| **New Hire Documents** | New hires (access code) | Transcripts, certificates, clearances, etc. |
| **Employee Handbook** | New hires (access code) | Read the handbook, check "I agree", draw a signature → signed PDF saved |

**How it fits together**

```
GitHub Pages (free)            Google Apps Script (free, school Google account)
index.html / app.js  ──POST──▶  Code.gs ──▶ Google Drive: CCS Staff Portal/
  (embedded in Squarespace)               │     Applicants/Last, First (email)/…
                                          │     Staff/Last, First (email)/…
                                          ├─▶ Google Sheet: one tab per form
                                          └─▶ Email notification
```

Nobody needs a Google account to submit. Files go only into the school's Drive; the website itself stores nothing, and the access code lives only in the Google script (not in the public website code).

---

## 1. Set up the Google side (≈10 minutes)

Do this **signed in to the Google account that should own the files** (ideally a school account, not a personal one).

1. Go to <https://script.google.com> → **New project**. Name it "CCS Staff Portal".
2. Delete the sample code and paste in everything from `apps-script/Code.gs`.
3. At the top, edit `SETTINGS`:
   - `notifyEmail` — who gets an email for each submission
   - `newHireCode` — the code you'll give new hires (change it each year)
4. Click 💾 Save. In the toolbar function dropdown choose **setup** → **Run**. Approve the permissions (you may see "Google hasn't verified this app" → *Advanced* → *Go to CCS Staff Portal* — this is normal for your own scripts).
   The log shows links to the new **CCS Staff Portal** Drive folder and the **Submissions** spreadsheet.
5. **Deploy → New deployment** → gear icon → **Web app**
   - Execute as: **Me**
   - Who has access: **Anyone**
   - **Deploy**, then copy the **Web app URL** (ends in `/exec`).
6. Paste that URL into `config.js` as `scriptUrl`.

> **Changing Code.gs later:** Deploy → *Manage deployments* → ✏️ → Version: *New version* → Deploy. The URL stays the same. (Changing only `SETTINGS` also needs this step.)

## 2. Add the employee handbook

Upload the handbook PDF to Google Drive → **Share** → *Anyone with the link* → *Viewer*. Copy its link, which looks like
`https://drive.google.com/file/d/FILE_ID/view`, change `/view…` to `/preview`, and paste it into `config.js` as `handbookUrl`. Update `handbookVersion` too.

To publish a new edition later, use **Manage versions → Upload new version** on the same Drive file, so the link doesn't change, and bump `handbookVersion`.

## 3. Publish on GitHub Pages

```sh
cd ccs-staff-portal
git init && git add . && git commit -m "Staff portal"
gh repo create ccs-staff-portal --public --source . --push
```

Then on GitHub: **Settings → Pages → Build and deployment → Deploy from a branch → `main` / root**. After a minute the site is live at
`https://dsecrest.github.io/ccs-staff-portal/`.

(GitHub Pages on a free account needs a public repo. That's fine: the code holds no secrets. The access code and all submissions stay in Google.)

## 4. Embed in Squarespace

On the Squarespace page, add a **Code** block, paste the contents of `squarespace-embed.html`. The frame resizes itself to fit the form.

- To put a single section on its own page, add `&only=apply` (or `recommend`, `documents`, `handbook`) to the iframe `src`.
- If your Squarespace plan doesn't allow scripts in Code blocks, use just the `<iframe …>` line in an **Embed** block. It will have a fixed height (adjust `height:1400px`).
- You can also link people straight to the GitHub URL. It works as a standalone page with its own header.

## Testing locally

```sh
python3 -m http.server 8000
# http://localhost:8000/                 – the portal
# http://localhost:8000/test/embed-test.html – simulated Squarespace embed at phone width
```

Submissions from localhost go to the real Google script once `scriptUrl` is set. Delete the test rows and folders afterward.

## Editing the forms

The application fields are plain HTML in `index.html`. Add, remove or rename an `<input name="…">` and the spreadsheet adds a matching column automatically. Keep `First name`, `Last name` and `Email` on every form, because they're used to file documents into each person's folder.

## Good to know

- **Limits:** 10 MB per file and 30 MB per submission (set in `config.js`). Google's hard limit is about 50 MB.
- **Privacy:** Keep the Drive folder shared only with the people who review applications. The new-hire page tells staff not to upload tax forms or anything with a Social Security number. Collect I-9/W-4 paperwork in person or through payroll.
- **Application PDFs:** Every application is saved as a formatted PDF (`Application - Last, First - date.pdf`) in the applicant's Drive folder, linked in the *Application PDF* column of the sheet, and attached to the notification email, ready to print for the physical file. Its sections and labels come from the form itself, so edits to `index.html` show up in the PDF automatically.
- **Signatures:** Each handbook signature is saved as a PDF with the statement, name, email, edition, timestamp and drawn signature, plus a row in the *Handbook Signatures* tab. That's the standard way to record handbook acknowledgments. Use a dedicated e-signature service if you ever need audit-trail-grade signing.
- **Spam:** Each form has a hidden "honeypot" field that silently drops bot submissions.
