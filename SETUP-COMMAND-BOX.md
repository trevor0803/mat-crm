# Command Box — Setup, Step by Step

Every command below is **PowerShell**. Open it with `Win` → type `powershell` → Enter.

Do the steps in order. Don't skip step 2 — the local files get their values
*from* Vercel, so Vercel has to know the key first.

---

## Step 0 — Get into the project folder

```powershell
cd "$HOME\Desktop\Projects\mat-crm"
```

Check you're in the right place — this should print `package.json`:

```powershell
Get-ChildItem package.json
```

---

## Step 1 — Get an Anthropic API key

This is **not** the same as a Claude subscription. It's a separate developer key.

1. Go to <https://console.anthropic.com>
2. Sign in (or sign up — same email is fine)
3. Left sidebar → **API Keys**
4. Click **Create Key**
5. Name it `mat-crm`
6. Click **Copy** — it starts with `sk-ant-`

> **Copy it now.** The console will never show it again. Paste it somewhere
> temporary (Notepad) while you do step 2.

7. While you're there: **Settings → Billing** → add a payment method and put
   **$5** on it. Each command costs about a third of a cent. $5 lasts months.

---

## Step 2 — Put the key in Vercel

1. Go to <https://vercel.com/dashboard>
2. Click the **mat-crm** project
3. Top nav → **Settings**
4. Left sidebar → **Environment Variables**
5. Fill in the form:
   - **Key:** `ANTHROPIC_API_KEY`
   - **Value:** paste your `sk-ant-...` key
   - **Environments:** tick **all three** — Production, Preview, Development
6. Click **Save**

You should now see `ANTHROPIC_API_KEY` in the list with all three environments.

---

## Step 3 — Pull the key down to your PC

Vercel has the key. Now copy it to your computer so `npm run dev` can see it.

```powershell
vercel env pull .env.development.local
```

If that errors with "vercel is not recognized", install it once and re-run:

```powershell
npm install -g vercel
vercel login
vercel link
vercel env pull .env.development.local
```

Then copy it to the second file the project reads:

```powershell
Copy-Item .env.development.local .env.local -Force
```

**Check it worked:**

```powershell
if (Select-String -Path .env.local -Pattern "ANTHROPIC_API_KEY" -Quiet) {
  Write-Host "Key is there - good to go" -ForegroundColor Green
} else {
  Write-Host "Key is MISSING - redo step 2, then step 3" -ForegroundColor Red
}
```

---

## Step 4 — Quick sanity check (no key needed)

```powershell
npm run test:command
```

Expect `24 passed, 0 failed`. If you get that, the logic is intact.

---

## Step 5 — Run it on your PC

```powershell
npm run dev
```

Leave that window open. Open <http://localhost:3000> in **Chrome**.

You'll see a gold-flecked bar under the nav, with a microphone on the right.

### Test it by typing

Click the box, type this, press **Enter**:

```
add a task for McGrath Plumbing to check the landing page due tomorrow for Trevor
```

A card appears with the client, assignee, due date and priority — all editable.
Press **Save**.

### Test it by talking

1. Click the **microphone**
2. Chrome asks for mic permission the first time → **Allow**
3. Say the same sentence
4. Stop talking — it runs by itself after about a second
5. Check the card, press **Save**

To stop the dev server: click the PowerShell window and press `Ctrl + C`.

---

## Step 6 — Push it live

```powershell
git add -A
git commit -m "Add natural-language command box"
git push
```

Pushing to `main` triggers a Vercel deploy automatically. Watch it at
<https://vercel.com/dashboard> → mat-crm → **Deployments**. Takes about a minute.

When it says **Ready**, open your live CRM URL and the box will be there too.

---

## If something goes wrong

| What you see | What to do |
| --- | --- |
| "ANTHROPIC_API_KEY is not set" | Step 2 wasn't saved, or step 3 wasn't run. Redo both, then restart `npm run dev`. |
| "The Anthropic API key was rejected" | The key is wrong or was deleted. Make a new one in the console and redo steps 2–3. |
| "Your credit balance is too low" | Add funds: console.anthropic.com → Settings → Billing. |
| The model "…" isn't available | Add `COMMAND_MODEL` in Vercel with a model your key can use, then redo step 3. |
| No microphone button | You're not in Chrome or Edge. Safari doesn't support it — typing still works. |
| Mic button does nothing | Click the padlock in Chrome's address bar → Site settings → Microphone → Allow. |
| Works locally, not on the live site | The key wasn't ticked for **Production** in step 2. Fix it, then redeploy from the Deployments tab (⋯ → Redeploy). |
| It picked the wrong client | Change it on the preview card before saving. That's what the card is for. |

---

## Optional settings

Add these in Vercel the same way as step 2, then re-run step 3.

| Key | Default | What it does |
| --- | --- | --- |
| `COMMAND_DEFAULT_ASSIGNEE` | `Trevor` | Who gets a task when you don't say a name. |
| `COMMAND_MODEL` | `claude-sonnet-4-6` | Swap the AI model. |

---

## Cheat sheet

| Keys | Does |
| --- | --- |
| `Ctrl + K` | Jump to the box from any page |
| `Enter` | Run it |
| `Shift + Enter` | New line instead of running |
| `Esc` | Throw away the preview |

**Things you can say:**

- add a task for McGrath Plumbing to check the landing page due tomorrow for Trevor
- mark the McGrath landing page task done
- move the Palm Beach Roofing task to next Friday and give it to Mike
- note on McGrath: they want to pause ads in September
- add a new client Sunrise Dental, 3000 a month, bills on the 15th, PayPal
- block 10am tomorrow for deep work on the McGrath rebuild
- what's due today?
- how much does McGrath pay us?

You can chain them: *"mark the McGrath task done and add a task to send them the
report on Friday"* creates two cards, one Save button.
