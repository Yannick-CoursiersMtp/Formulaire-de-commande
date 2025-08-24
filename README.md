# Formulaire de commande

## Proxy requirements

When deploying behind a reverse proxy, ensure it reliably sets the `X-Forwarded-For` header with the originating client's IP address. The server uses only the first IP in this header for rate limiting.

## Updating external CSS SRI hashes

When upgrading CDN-hosted CSS libraries such as Leaflet or Font Awesome, update the `integrity` attributes in `index.html`:

1. Download the file and compute its Subresource Integrity hash:
   ```bash
   curl -s <URL> | openssl dgst -sha384 -binary | base64 -w0
   ```
   Replace `-sha384` with `-sha256` if the existing tag uses SHA-256.
2. Prefix the output with the algorithm (`sha384-` or `sha256-`) and place the value in the `integrity` attribute.
3. Ensure `crossorigin="anonymous"` is present on the `<link>` tag.

Run `npm test` to verify the project still builds after any update.
