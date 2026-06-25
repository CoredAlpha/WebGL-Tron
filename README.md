## TrenchLine

A WebGL light-cycle arena with a Solana wallet gate and online rooms. Connect a
wallet (your address is your profile) to create or join a race room, or jump
straight into a free single-player demo.



##### run online multiplayer (recommended):

    cd TrenchLine/server
    npm install
    npm start            # serves the game + realtime rooms
    open http://localhost:3000

The Node server (Express + Socket.IO) hosts both the static game and the room
relay, so everything runs on one origin. Deploy it anywhere that runs Node
(Render, Railway, Fly, a VPS…) to play across the internet.

##### run the offline demo only:

    python -m http.server 1337
    open http://localhost:1337

(Multiplayer needs the Node server; the static server only serves the demo.)


#### Flow

1. **Connect Wallet** — an injected Solana provider (Phantom / Backpack /
   Solflare) via `@solana/web3.js`. Your wallet address **is your profile**.
2. **Verify** — the server issues a nonce and the wallet **signs a message**
   (sign-in); the signature is checked server-side (ed25519 via `tweetnacl`)
   before you can create or join rooms. No transaction, no gas.
3. **Lobby** — create a room (get a 4-char code) or join an open room / paste a
   code. Up to 6 racers per room. A **leaderboard** shows the top racers.
4. **Race + rounds** — each client simulates its own cycle and broadcasts
   position / turns / trail / crashes; peers render as live cycles you can
   crash into. **Last cycle alive wins the round**; a scoreboard shows the
   result and the next round auto-starts.
5. **Stats** — each win is **persisted per wallet** in `server/stats.json`.

Controls: **A** / **←** turn left, **D** / **→** turn right, `space` brake,
`c` change view, `p` pause.

Or pick **Play Demo** for a free, wallet-free single-player game vs AI.


#### Notes / config

- Wallet network defaults to `devnet` — change `web3.network` in
  `scripts/web3.js`.
- To point the client at a remote server, set `window.TRON_SERVER` before
  `scripts/net.js` loads.
- Netcode is *client-authoritative* (each player owns their own cycle's life);
  it favours simplicity over anti-cheat.


#### Deployment — frontend on Vercel, backend on your PC

Vercel serves only the static game; the realtime backend keeps running on your
PC. Because the Vercel page is HTTPS, the browser can only reach the backend
over **HTTPS/WSS**, so the PC server must be exposed through a tunnel.

This project is wired for: **frontend at `trenchline.fun` (Vercel)**, **backend
on the PC** exposed at **`api.trenchline.fun`** via a Cloudflare named tunnel.
`scripts/server-config.js` already points production at `https://api.trenchline.fun`,
so the deployed site connects with no manual input.

**1. Deploy the frontend (Vercel)**
- Import the GitHub repo at [vercel.com/new](https://vercel.com/new).
- No build step (it's static); `vercel.json` + `.vercelignore` keep `server/`
  out of the deploy.
- Add the custom domain `trenchline.fun` in Vercel → Settings → Domains, and add
  the DNS records it shows in Cloudflare.

**2. Run the backend on your PC**

    cd server
    npm install
    npm start            # http://localhost:3000

**3. Cloudflare named tunnel (stable `api.trenchline.fun`)**
- Add `trenchline.fun` to Cloudflare (Free plan) and switch the registrar's
  nameservers to Cloudflare's; wait until the zone is **Active**.
- Zero Trust → **Networks → Tunnels → Create tunnel** → *Cloudflared* → name it
  `trenchline`. Copy the install command and run it on the PC (auto-starts as a
  Windows service):

      cloudflared service install <TOKEN>

- In the tunnel, add a **Public Hostname**: `api` . `trenchline.fun` →
  service `HTTP` → `localhost:3000`.

Now `https://api.trenchline.fun` proxies to the backend, and the Vercel site
connects automatically.

> The server sends `cors: "*"`. Keep the PC backend (`npm start`) running while
> people play — the tunnel only bridges to it. Demo mode works without it.


#### Layout

| path | role |
|------|------|
| `server/` | Express + Socket.IO server: auth, rooms, rounds, stats (**runs on your PC**) |
| `server/stats.json` | persisted per-wallet win counts (auto-created) |
| `scripts/server-config.js` | picks the backend URL (local vs tunnel) |
| `scripts/web3.js` | Solana wallet gate + profile |
| `scripts/net.js` | sign-message auth, lobby, rounds, multiplayer sync |
| `css/start-menu.css` | gate / lobby / scoreboard / welcome styling |
| `vercel.json`, `.vercelignore` | static frontend deploy config |


--

### Credits

Forked from [dpren/WebGL-Tron](https://github.com/dpren/WebGL-Tron).
