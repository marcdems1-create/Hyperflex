# Claude Code: Password Reset Flow

Add forgot-password / reset-password to the login page, a standalone reset page, and an admin "Send Reset Link" button.

Files: `server.js`, `public/creator-login.html`, `public/reset-password.html` (new), `public/admin.html`

---

## 1. Migration — add reset token columns

Add to the bottom of `server.js` migrations section, OR run manually in Supabase:

```sql
ALTER TABLE creator_settings
  ADD COLUMN IF NOT EXISTS password_reset_token TEXT,
  ADD COLUMN IF NOT EXISTS password_reset_expires TIMESTAMPTZ;
```

Also add to `users` table for member accounts:
```sql
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS password_reset_token TEXT,
  ADD COLUMN IF NOT EXISTS password_reset_expires TIMESTAMPTZ;
```

---

## 2. Backend — `server.js`

### 2A. POST /api/auth/forgot-password

```js
app.post('/api/auth/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email required' });

    const token = require('crypto').randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    // Check creator_settings first
    const { data: creator } = await supabase
      .from('creator_settings')
      .select('id, email, display_name')
      .eq('email', email.toLowerCase().trim())
      .single();

    if (creator) {
      await supabase.from('creator_settings').update({
        password_reset_token: token,
        password_reset_expires: expires.toISOString()
      }).eq('id', creator.id);

      await sendPasswordResetEmail(email, creator.display_name || 'there', token);
      return res.json({ ok: true });
    }

    // Check users table
    const { data: user } = await supabase
      .from('users')
      .select('id, email, display_name')
      .eq('email', email.toLowerCase().trim())
      .single();

    if (user) {
      await supabase.from('users').update({
        password_reset_token: token,
        password_reset_expires: expires.toISOString()
      }).eq('id', user.id);

      await sendPasswordResetEmail(email, user.display_name || 'there', token);
      return res.json({ ok: true });
    }

    // Always return ok — don't reveal whether email exists
    return res.json({ ok: true });
  } catch (err) {
    console.error('[forgot-password]', err.message);
    res.status(500).json({ error: 'Something went wrong' });
  }
});
```

### 2B. POST /api/auth/reset-password

```js
app.post('/api/auth/reset-password', async (req, res) => {
  try {
    const { token, password } = req.body;
    if (!token || !password) return res.status(400).json({ error: 'Token and password required' });
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });

    const now = new Date().toISOString();

    // Check creator_settings
    const { data: creator } = await supabase
      .from('creator_settings')
      .select('id, email')
      .eq('password_reset_token', token)
      .gt('password_reset_expires', now)
      .single();

    if (creator) {
      const password_hash = await bcrypt.hash(password, 12);
      await supabase.from('creator_settings').update({
        password_hash,
        password_reset_token: null,
        password_reset_expires: null
      }).eq('id', creator.id);
      return res.json({ ok: true });
    }

    // Check users
    const { data: user } = await supabase
      .from('users')
      .select('id, email')
      .eq('password_reset_token', token)
      .gt('password_reset_expires', now)
      .single();

    if (user) {
      const password_hash = await bcrypt.hash(password, 12);
      await supabase.from('users').update({
        password_hash,
        password_reset_token: null,
        password_reset_expires: null
      }).eq('id', user.id);
      return res.json({ ok: true });
    }

    return res.status(400).json({ error: 'Reset link is invalid or has expired' });
  } catch (err) {
    console.error('[reset-password]', err.message);
    res.status(500).json({ error: 'Something went wrong' });
  }
});
```

### 2C. POST /api/admin/reset-password (admin-triggered)

```js
app.post('/api/admin/reset-password', async (req, res) => {
  const secret = req.headers['x-admin-secret'];
  if (secret !== process.env.ADMIN_SECRET) return res.status(403).json({ error: 'Forbidden' });

  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email required' });

    const token = require('crypto').randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours for admin-triggered

    // Try creator_settings
    const { data: creator } = await supabase
      .from('creator_settings')
      .select('id, display_name')
      .eq('email', email.toLowerCase().trim())
      .single();

    if (creator) {
      await supabase.from('creator_settings').update({
        password_reset_token: token,
        password_reset_expires: expires.toISOString()
      }).eq('id', creator.id);
      await sendPasswordResetEmail(email, creator.display_name || 'there', token);
      return res.json({ ok: true, sent_to: email });
    }

    // Try users
    const { data: user } = await supabase
      .from('users')
      .select('id, display_name')
      .eq('email', email.toLowerCase().trim())
      .single();

    if (user) {
      await supabase.from('users').update({
        password_reset_token: token,
        password_reset_expires: expires.toISOString()
      }).eq('id', user.id);
      await sendPasswordResetEmail(email, user.display_name || 'there', token);
      return res.json({ ok: true, sent_to: email });
    }

    return res.status(404).json({ error: 'No account found with that email' });
  } catch (err) {
    console.error('[admin-reset-password]', err.message);
    res.status(500).json({ error: 'Something went wrong' });
  }
});
```

### 2D. sendPasswordResetEmail helper

Add near other email helpers (like `sendResolutionEmails`):

```js
async function sendPasswordResetEmail(toEmail, name, token) {
  if (!process.env.SMTP_HOST) return; // no-op if email not configured
  const resetUrl = `https://hyperflex.network/reset-password?token=${token}`;
  const html = `
    <div style="background:#0e0e0c;color:#f0ebe3;font-family:sans-serif;max-width:520px;margin:0 auto;padding:32px;border-radius:10px;">
      <div style="font-family:'Syne',sans-serif;font-size:22px;font-weight:800;margin-bottom:8px;">
        <span style="color:#c9920d;">HYPER</span>FLEX
      </div>
      <h2 style="font-size:18px;margin:24px 0 8px;">Reset your password</h2>
      <p style="color:#aaa;font-size:14px;line-height:1.6;margin-bottom:24px;">
        Hey ${name}, click the button below to reset your password. This link expires in 1 hour.
      </p>
      <a href="${resetUrl}" style="display:inline-block;background:#c9920d;color:#0e0e0c;font-weight:700;padding:13px 28px;border-radius:6px;text-decoration:none;font-size:15px;">
        Reset Password →
      </a>
      <p style="color:#555;font-size:12px;margin-top:28px;">
        If you didn't request this, ignore this email — your password won't change.<br/>
        Link: ${resetUrl}
      </p>
    </div>
  `;
  await sendEmail(toEmail, 'Reset your HYPERFLEX password', html);
}
```

(Assumes `sendEmail(to, subject, html)` already exists — adapt to match your existing mailer helper name.)

### 2E. Serve the reset page

```js
app.get('/reset-password', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'reset-password.html'));
});
```

---

## 3. Login page — `public/creator-login.html`

### 3A. Add "Forgot password?" link

Find the password input block and add below it:

```html
<!-- After the password input, before the login button -->
<div style="text-align:right; margin: -8px 0 16px;">
  <a href="#" onclick="showForgotForm(); return false;"
     style="font-family:'Space Mono',monospace; font-size:12px; color:#666;
            text-decoration:none; transition:color .15s;"
     onmouseover="this.style.color='#c9920d'" onmouseout="this.style.color='#666'">
    Forgot password?
  </a>
</div>
```

### 3B. Add forgot-password form (hidden by default)

After the main login form `</form>`, add:

```html
<!-- FORGOT PASSWORD FORM (hidden by default) -->
<div id="forgotForm" style="display:none; margin-top:8px;">
  <p style="font-family:'Space Mono',monospace; font-size:12px; color:#888; margin-bottom:16px; line-height:1.5;">
    Enter your email and we'll send a reset link.
  </p>
  <input type="email" id="forgotEmail" placeholder="Your email"
         style="width:100%; padding:12px 14px; background:#0e0e0c; border:1px solid #2a2a26;
                border-radius:6px; color:#f0ebe3; font-family:'Space Mono',monospace;
                font-size:13px; box-sizing:border-box; margin-bottom:12px;"
         onkeydown="if(event.key==='Enter') sendForgotPassword()"/>
  <button onclick="sendForgotPassword()"
          style="width:100%; padding:13px; background:#c9920d; border:none; border-radius:6px;
                 color:#0e0e0c; font-family:'Syne',sans-serif; font-size:15px;
                 font-weight:700; cursor:pointer;">
    Send Reset Link →
  </button>
  <div style="text-align:center; margin-top:12px;">
    <a href="#" onclick="showLoginForm(); return false;"
       style="font-family:'Space Mono',monospace; font-size:12px; color:#666; text-decoration:none;">
      ← Back to sign in
    </a>
  </div>
  <div id="forgotMsg" style="display:none; margin-top:14px; padding:12px 14px;
       border-radius:6px; font-family:'Space Mono',monospace; font-size:12px;"></div>
</div>
```

### 3C. JS functions

Add in the `<script>` block:

```js
function showForgotForm() {
  document.getElementById('loginForm').style.display = 'none'; // hide the login form
  document.getElementById('forgotForm').style.display = 'block';
  document.getElementById('forgotEmail').focus();
}

function showLoginForm() {
  document.getElementById('forgotForm').style.display = 'none';
  document.getElementById('loginForm').style.display = 'block'; // show login form
}

async function sendForgotPassword() {
  const email = document.getElementById('forgotEmail').value.trim();
  const msg = document.getElementById('forgotMsg');
  if (!email) { showForgotMsg('Please enter your email.', false); return; }

  try {
    await fetch('/api/auth/forgot-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });
    // Always show success — don't reveal if email exists
    showForgotMsg('If that email has an account, a reset link is on its way. Check your inbox.', true);
  } catch (e) {
    showForgotMsg('Something went wrong. Please try again.', false);
  }
}

function showForgotMsg(text, success) {
  const el = document.getElementById('forgotMsg');
  el.style.display = 'block';
  el.style.background = success ? 'rgba(0,200,100,0.1)' : 'rgba(200,50,50,0.1)';
  el.style.color = success ? '#00c864' : '#e05252';
  el.style.border = `1px solid ${success ? 'rgba(0,200,100,0.2)' : 'rgba(200,50,50,0.2)'}`;
  el.textContent = text;
}
```

Note: The login form wrapper `<form>` or `<div>` needs an `id="loginForm"` — add that attribute if it doesn't already exist.

---

## 4. New page — `public/reset-password.html`

Create this file from scratch:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Reset Password — HYPERFLEX</title>
  <link href="https://fonts.googleapis.com/css2?family=Syne:wght@400;700;800&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet"/>
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body { background:#0e0e0c; color:#f0ebe3; font-family:'Space Mono',monospace;
           min-height:100vh; display:flex; align-items:center; justify-content:center; padding:20px; }
    .card { background:#141412; border:1px solid #222; border-radius:12px;
            padding:40px 36px; width:100%; max-width:420px; }
    .logo { font-family:'Syne',sans-serif; font-size:22px; font-weight:800; margin-bottom:28px; }
    .logo span { color:#c9920d; }
    h1 { font-family:'Syne',sans-serif; font-size:20px; font-weight:700; margin-bottom:8px; }
    p { color:#888; font-size:13px; line-height:1.6; margin-bottom:24px; }
    input { width:100%; padding:12px 14px; background:#0e0e0c; border:1px solid #2a2a26;
            border-radius:6px; color:#f0ebe3; font-family:'Space Mono',monospace;
            font-size:13px; margin-bottom:12px; outline:none; transition:border-color .15s; }
    input:focus { border-color:#c9920d; }
    button { width:100%; padding:13px; background:#c9920d; border:none; border-radius:6px;
             color:#0e0e0c; font-family:'Syne',sans-serif; font-size:15px;
             font-weight:700; cursor:pointer; transition:background .15s; }
    button:hover { background:#d9a01d; }
    button:disabled { opacity:0.5; cursor:not-allowed; }
    .msg { display:none; margin-top:14px; padding:12px 14px; border-radius:6px; font-size:12px; }
    .msg.success { background:rgba(0,200,100,.1); color:#00c864; border:1px solid rgba(0,200,100,.2); }
    .msg.error   { background:rgba(200,50,50,.1);  color:#e05252; border:1px solid rgba(200,50,50,.2); }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo"><span>HYPER</span>FLEX</div>
    <h1>Set new password</h1>
    <p>Enter your new password below.</p>

    <div id="formArea">
      <input type="password" id="pw1" placeholder="New password (min 8 chars)" autocomplete="new-password"/>
      <input type="password" id="pw2" placeholder="Confirm new password" autocomplete="new-password"
             onkeydown="if(event.key==='Enter') submitReset()"/>
      <button onclick="submitReset()" id="submitBtn">Set New Password →</button>
    </div>

    <div id="msg" class="msg"></div>
    <div id="loginLink" style="display:none; margin-top:20px; text-align:center;">
      <a href="/creator/login" style="color:#c9920d; font-size:13px; text-decoration:none;">
        Sign in with your new password →
      </a>
    </div>
    <div id="expiredMsg" style="display:none; text-align:center; margin-top:16px;">
      <p style="color:#e05252; font-size:13px; margin-bottom:12px;">This reset link has expired.</p>
      <a href="/creator/login" style="color:#c9920d; font-size:13px; text-decoration:none;">
        Request a new one →
      </a>
    </div>
  </div>

  <script>
    const token = new URLSearchParams(window.location.search).get('token');
    if (!token) {
      document.getElementById('formArea').style.display = 'none';
      document.getElementById('expiredMsg').style.display = 'block';
    }

    async function submitReset() {
      const pw1 = document.getElementById('pw1').value;
      const pw2 = document.getElementById('pw2').value;
      const msg = document.getElementById('msg');
      const btn = document.getElementById('submitBtn');

      if (!pw1 || pw1.length < 8) { showMsg('Password must be at least 8 characters.', false); return; }
      if (pw1 !== pw2) { showMsg('Passwords don\'t match.', false); return; }

      btn.disabled = true;
      btn.textContent = 'Saving…';

      try {
        const r = await fetch('/api/auth/reset-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token, password: pw1 })
        });
        const data = await r.json();
        if (data.ok) {
          document.getElementById('formArea').style.display = 'none';
          showMsg('Password updated! You can now sign in.', true);
          document.getElementById('loginLink').style.display = 'block';
        } else {
          showMsg(data.error || 'Something went wrong.', false);
          btn.disabled = false;
          btn.textContent = 'Set New Password →';
        }
      } catch (e) {
        showMsg('Network error. Please try again.', false);
        btn.disabled = false;
        btn.textContent = 'Set New Password →';
      }
    }

    function showMsg(text, success) {
      const el = document.getElementById('msg');
      el.style.display = 'block';
      el.className = 'msg ' + (success ? 'success' : 'error');
      el.textContent = text;
    }
  </script>
</body>
</html>
```

---

## 5. Admin dashboard — `public/admin.html`

### 5A. Add "Send Reset Link" button to the creators table

Find where creator rows are rendered (the `renderCreators()` or similar function that builds table rows). In the actions column, add a reset button next to the existing plan/delete buttons:

```js
// In the creator row actions, add:
<button onclick="adminSendReset('${esc(c.email)}')"
        style="background:transparent; border:1px solid #444; color:#888; padding:4px 10px;
               border-radius:4px; font-size:11px; font-family:'Space Mono',monospace;
               cursor:pointer; transition:all .15s;"
        onmouseover="this.style.borderColor='#c9920d';this.style.color='#c9920d'"
        onmouseout="this.style.borderColor='#444';this.style.color='#888'"
        title="Send password reset email">
  🔑 Reset
</button>
```

### 5B. Add the JS function

```js
async function adminSendReset(email) {
  if (!confirm(`Send password reset email to ${email}?`)) return;
  try {
    const r = await fetch('/api/admin/reset-password', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-secret': ADMIN_SECRET  // use whatever your admin secret var is called
      },
      body: JSON.stringify({ email })
    });
    const data = await r.json();
    if (data.ok) {
      showToast(`✅ Reset link sent to ${email}`);
    } else {
      showToast(`❌ ${data.error}`, true);
    }
  } catch (e) {
    showToast('❌ Network error', true);
  }
}
```

---

## 6. Commit

```bash
git add server.js public/creator-login.html public/reset-password.html public/admin.html
git commit -m "feat: password reset — forgot password on login page, reset-password page, admin send-reset button"
git push origin main
```

---

## Notes

- Reset tokens expire in **1 hour** (self-service) / **24 hours** (admin-triggered)
- Email is no-op if SMTP is not configured — same pattern as rest of email system
- Always returns `{ ok: true }` on forgot-password regardless of whether email exists (security best practice — no account enumeration)
- The `/reset-password` page reads the token from `?token=` URL param — works as a standard email link
- DB columns use `IF NOT EXISTS` — safe to run without a formal migration file, but add to Supabase manually if needed
