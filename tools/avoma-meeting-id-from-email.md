# avoma-meeting-id-from-email

Extract Avoma meeting UUIDs from Avoma notification emails, including forwarded Gmail/AgentMail JSON and `click.avoma.com` redirect-wrapped links.

## Usage

```bash
# From a saved email / AgentMail JSON
./tools/avoma-meeting-id-from-email email.json

# From stdin
cat email.txt | ./tools/avoma-meeting-id-from-email --first

# Then fetch transcript
uuid=$(./tools/avoma-meeting-id-from-email --first email.json)
node ./tools/avoma-cli.js transcription "$uuid"
```

Options:

- `--first`: print only the first meeting UUID, exits non-zero if none found
- `--json`: output `{ "meeting_uuids": [...] }`

The extractor prefers URLs matching `app.avoma.com/meetings/<uuid>` after HTML unescape and URL decoding. As fallback, it accepts bare UUIDs only when the surrounding text mentions Avoma.
