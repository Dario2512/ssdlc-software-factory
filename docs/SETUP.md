# Setting up the factory

Everything that can be code is in `scripts/setup-repo.sh`. The steps below need a browser
or a secret, so the owner does them by hand once. None of them is one of the three human
decisions; they are building the harness.

## 1. Repository and settings

```bash
gh repo create Dario2512/ssdlc-software-factory --public --source . --push
scripts/setup-repo.sh Dario2512/ssdlc-software-factory Dario2512
```

## 2. The factory's GitHub App (the agents' identity)

1. Open this link. It pre-fills a private app with only the permissions the factory needs
   (contents, pull requests, issues: read and write; no workflows, no administration;
   webhook off):
   <https://github.com/settings/apps/new?name=dario-ssdlc-factory&url=https%3A%2F%2Fgithub.com%2FDario2512%2Fssdlc-software-factory&public=false&webhook_active=false&contents=write&pull_requests=write&issues=write>
2. **Create GitHub App**. Copy the **Client ID**, then:
   `gh variable set FACTORY_APP_CLIENT_ID --repo Dario2512/ssdlc-software-factory --body <client-id>`
3. **Generate a private key** on the app's key page
   (<https://github.com/settings/apps/dario-ssdlc-factory/key_pairs>; a `.pem` downloads),
   then store it and delete the file:
   ```bash
   gh secret set FACTORY_APP_PRIVATE_KEY --repo Dario2512/ssdlc-software-factory < ~/Downloads/dario-ssdlc-factory.*.pem
   rm ~/Downloads/dario-ssdlc-factory.*.pem
   ```
4. **Install App**, choose **Only select repositories**, and pick `ssdlc-software-factory`.
5. `gh variable set FACTORY_BOT_LOGIN --repo Dario2512/ssdlc-software-factory --body "dario-ssdlc-factory[bot]"`

## 3. The Claude token (Claude Pro subscription, no API bill)

```bash
claude setup-token          # sign in; it prints a long-lived OAuth token
gh secret set CLAUDE_CODE_OAUTH_TOKEN --repo Dario2512/ssdlc-software-factory   # paste at the prompt
```

`gh secret set` reads the token from the prompt, so it never lands in shell history or a file.

## 4. Account hygiene

- Two-factor authentication on GitHub (Settings → Password and authentication).
- `git config core.hooksPath .githooks` and `brew install gitleaks` for the local scan.

## 5. Check

Run `scripts/setup-repo.sh Dario2512/ssdlc-software-factory` again. All boxes at the end
should be ticked.
