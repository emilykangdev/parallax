# Apple Shortcut — "Parallax render"

Build this on the iPad against your stable engine URL (Tailscale hostname or public URL).

**Input:** image (Freeform → Share button passes the page as PNG)

## Steps

1. **Ask for Input**
   - Prompt: `Caption (optional)`
   - Input type: Text · Allow blank: yes
   - → variable `caption`
2. **URL Encode** `caption` → variable `capEnc`
3. **Get Contents of URL**
   - URL: `https://<host>:3111/api/render?caption=[capEnc]`
   - Method: `POST`
   - Headers: `Authorization` = `Bearer <PARALLAX_TOKEN>`
   - Request Body: **File** → `Shortcut Input`
     (sends the raw PNG bytes as `application/octet-stream`)
4. **Quick Look** (the response **is** the polished `image/png` — it renders inline)
5. **Save to Photo Album** (default album)

## Notes

- The endpoint returns image bytes directly, so there is no base64 step and no second fetch.
- On error, step 3 surfaces the HTTP message. `401 unauthorized` → check the bearer token;
  `400 image required` → the body wasn't sent as a File.
- If iOS won't send a raw file body cleanly, switch the Request Body to **Form** with an
  `image` File field. The server reads the bytes identically via `req.request_body.readAll()`.
- `<host>` is your Tailscale hostname (e.g. `emily-laptop.tail-XXXX.ts.net`) when the engine
  runs on a laptop, or your public host when deployed. Port `3111` is the iii-http listener.
