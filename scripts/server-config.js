"use strict";

// -----------------------------------------------------------------------------
// Where the multiplayer backend (Socket.IO) lives.
//
//  • Local dev: open http://localhost:3000 (served by the Node server in
//    /server). Same origin is used automatically — nothing to configure.
//
//  • Production: this site is hosted on Vercel (HTTPS) but the backend runs on
//    your PC. The browser may only reach it over HTTPS/WSS, so expose the Node
//    server with a tunnel (Cloudflare Tunnel or ngrok) and use that https URL.
//
// Set the backend URL in any of these ways (highest priority first):
//   1. ?server=https://your-tunnel-url      (remembered in localStorage)
//   2. localStorage "TRON_SERVER"
//   3. the DEFAULT_BACKEND constant below    (edit + redeploy)
// -----------------------------------------------------------------------------

(function () {

	// Temporary backend behind a quick Cloudflare tunnel (runs on the PC).
	var DEFAULT_BACKEND = "https://daughter-lately-pittsburgh-mason.trycloudflare.com";

	if (window.TRON_SERVER) return; // explicit override wins

	var qs = new URLSearchParams(location.search);
	var fromQuery = qs.get("server");
	if (fromQuery) { try { localStorage.setItem("TRON_SERVER", fromQuery); } catch (e) {} }

	var stored = null;
	try { stored = localStorage.getItem("TRON_SERVER"); } catch (e) {}

	var host = location.hostname;
	var isLocal = (host === "localhost" || host === "127.0.0.1" || host === "" || host === "0.0.0.0");

	if (isLocal) {
		// served by the Node backend itself -> same-origin connection
		if (fromQuery || stored) window.TRON_SERVER = fromQuery || stored;
		return;
	}

	// hosted frontend (Vercel) -> must point at the public backend
	window.TRON_SERVER = fromQuery || stored || DEFAULT_BACKEND;
})();
