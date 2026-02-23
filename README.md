# Share to Nostr (Chrome Extension)

A Manifest V3 extension for sharing selected text, images, and full pages to Nostr.

## What it supports

- Highlight text on any web page, right click, and use `Share selection to Nostr`.
- Right click images and use `Share image to Nostr`.
- Right click videos and use `Share video to Nostr`.
- Open the extension popup and click `Share This Page`.
- Review and edit everything in a compose/preview screen before publishing.
- Toggle whether text/image/video shares automatically include the source page URL.
- Sign with a NIP-07 browser signer extension (`window.nostr`).
- Publish to one or more relays and see per-relay acceptance status.

## Install locally

1. Open Chrome and go to `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this folder: `sharetonostr`.

## Notes on authentication

- This extension does not ask users to paste an `nsec`.
- Signing uses NIP-07 APIs exposed by a signer extension in a regular website tab.
- If signer check fails, open a normal website tab where your signer extension is enabled, then try again.

## Current limitations

- "Generate a new identity" is not included in this first version to avoid bundling local secp256k1 signing code.
- "External signer via bunker/NIP-46" is not included in this first version.
- Image sharing posts the image URL; it does not upload image binaries to media hosts.
