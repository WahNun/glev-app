=== BEGIN ===

Create a professional HTML email signature for Glev founder Lucas Wahnon.

## Task

Build `public/email-signature.html` — a standalone HTML file that renders correctly in all major email clients (Gmail, Outlook, Apple Mail) and can be screenshotted as a PNG.

---

## File to create

**`public/email-signature.html`**

---

## Content

- **Name:** Lucas Wahnon
- **Title:** Glev Founder
- **E-Mail:** hallo@glev.app
- **Website:** glev.app
- **Phone / WhatsApp:** +351 963 004 998

---

## Brand Guidelines

| Token | Value |
|---|---|
| Primary / Accent | `#4F6EF7` |
| Background | `#FAFBFF` |
| Text (dark) | `#1a1a2e` |
| Text (dimmed) | `rgba(26,26,46,0.5)` |
| Font stack | `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif` |

Style: **clean, modern, clinical** — no warm yellow, no beige, no decorative rounded elements.

---

## Layout spec

```
┌─────────────────────────────────────────────────────────── 600px ──┐
│ ▌ [Photo 80×80, round] │ Lucas Wahnon (bold, 18px)        [glev]  │
│ ▌                       │ Glev Founder (dimmed, 13px)              │
│ ▌                       │ ─────────────────────────────            │
│ ▌                       │ hallo@glev.app · glev.app                │
│ ▌                       │ +351 963 004 998 (WhatsApp)              │
├────────────────────────────────────── separator (1px, #4F6EF7 30%) ┤
│ Disclaimer (10px, #888)                                            │
└────────────────────────────────────────────────────────────────────┘
```

- **Left accent line:** 4px solid `#4F6EF7`, full height of the main row
- **Photo:** 80×80px, border-radius 50%, border 2px solid `#4F6EF7`
  - Source: `/public/founder.jpg` (if the file exists)
  - Fallback: inline SVG circle (fill `#4F6EF7`) with centred white initials "LW", 28px bold — no `<img>` tag needed for the fallback
- **Name:** 18px, font-weight 700, color `#1a1a2e`
- **Title:** 13px, color `rgba(26,26,46,0.5)`
- **Contact line:** 13px — email as `<a href="mailto:…">`, website as `<a href="https://glev.app">`, phone as `<a href="tel:…">`; link color `#4F6EF7`, no underline
- **"glev" wordmark:** top-right cell, 22px, font-weight 800, color `#4F6EF7`, letter-spacing -0.5px
- **Separator:** `<tr>` with a single `<td>` containing a 1px-tall `<div>` background `rgba(79,110,247,0.3)`
- **Disclaimer row:** padding 10px 16px, font-size 10px, color `#888`, line-height 1.5

---

## Disclaimer text (both languages)

```
DE: Diese E-Mail und ihre Anhänge können vertrauliche und rechtlich geschützte Informationen enthalten.
Falls Sie nicht der beabsichtigte Empfänger sind, informieren Sie bitte umgehend den Absender
und löschen Sie diese Nachricht. Jede unbefugte Weitergabe, Vervielfältigung oder Nutzung ist untersagt.

EN: This email and any attachments may contain confidential and legally privileged information.
If you are not the intended recipient, please notify the sender immediately and delete this message.
Any unauthorised disclosure, copying or use is strictly prohibited.
```

---

## Technical requirements

1. **Table-based layout only** — use `<table>`, `<tr>`, `<td>`. No Flexbox, no CSS Grid, no `<div>` layout wrappers. Email clients strip those.
2. **100% inline styles** — no `<style>` block, no external CSS file. Every element carries its own `style=""`.
3. **No JavaScript.**
4. Total width: `600px` (set via `table width="600"`).
5. Background color on the outermost table: `#FAFBFF`.
6. The file must be self-contained — opening it in a browser should render the full signature without any server.
7. Use `cellpadding="0"` and `cellspacing="0"` on all tables; use `border="0"`.

---

## Skeleton (follow this structure)

```html
<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Glev Email Signature – Lucas Wahnon</title>
</head>
<body style="margin:0;padding:24px;background:#f0f2f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">

  <!-- Outer wrapper -->
  <table width="600" cellpadding="0" cellspacing="0" border="0"
         style="background:#FAFBFF;border-radius:8px;overflow:hidden;">

    <!-- MAIN ROW -->
    <tr>
      <!-- Accent line -->
      <td width="4" style="background:#4F6EF7;">&nbsp;</td>
      <!-- Gap -->
      <td width="16">&nbsp;</td>
      <!-- Photo -->
      <td width="80" valign="middle" style="padding:20px 0;">
        <!-- If founder.jpg exists use <img>, otherwise inline SVG fallback -->
      </td>
      <!-- Gap -->
      <td width="20">&nbsp;</td>
      <!-- Text block -->
      <td valign="middle" style="padding:20px 0;">
        <!-- Name, Title, Contact -->
      </td>
      <!-- Gap -->
      <td width="20">&nbsp;</td>
      <!-- Wordmark -->
      <td width="60" valign="top" style="padding:20px 16px 0 0;text-align:right;">
        <!-- glev -->
      </td>
    </tr>

    <!-- SEPARATOR ROW -->
    <tr>
      <td colspan="7" style="padding:0 16px;">
        <div style="height:1px;background:rgba(79,110,247,0.3);"></div>
      </td>
    </tr>

    <!-- DISCLAIMER ROW -->
    <tr>
      <td colspan="7" style="padding:10px 16px;font-size:10px;color:#888;line-height:1.5;">
        <!-- DE + EN disclaimer -->
      </td>
    </tr>

  </table>

</body>
</html>
```

Fill in every placeholder with the real content described above. Do **not** leave any `<!-- … -->` comments in the final file.

---

## Verification steps

After generating the file, run these checks **in order**:

1. **Open in browser** — run a quick HTTP server (`python3 -m http.server 3000`) and open `http://localhost:3000/public/email-signature.html`. Confirm:
   - Background is `#FAFBFF` (very light blue-grey), not white
   - Left blue accent line is visible
   - Photo is round with blue border (or "LW" circle fallback if no image)
   - Name is bold and dark, title is dimmed
   - "glev" wordmark appears top-right in `#4F6EF7`
   - Separator line and grey disclaimer are present

2. **Screenshot** — use the browser's built-in screenshot or a headless tool (e.g. `node -e "require('puppeteer')..."`) to produce `public/email-signature.png` at 2× resolution (1200px wide). Verify the PNG looks identical to step 1.

3. **Commit & push:**
   ```bash
   git add -A
   git commit -m "feat: add glev email signature html"
   git push origin main
   ```

=== END ===
