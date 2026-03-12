# X Focus Filter

Chrome extension prototype that hides low-signal posts on `x.com` with simple keyword filtering.

## What it does

- Runs directly on `x.com` and `twitter.com`
- Watches the timeline for loaded tweets
- Hides promoted posts
- Supports two modes:
  - `include`: only keep posts that match your focus keywords
  - `exclude`: hide posts that match your muted keywords

## Load locally

1. Open `chrome://extensions`
2. Enable Developer mode
3. Click `Load unpacked`
4. Select this folder: `/root/workspace/x-focus-extension`

## Notes

- This is a DOM-based prototype, so it depends on X's current HTML structure.
- The `include` mode is the closest approximation to "interest-only timeline", but it is still keyword-based.
- If X changes tweet markup, the selector logic in `content.js` will need updates.
