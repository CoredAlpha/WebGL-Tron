"use strict";

// -----------------------------------------------------------------------------
// Web3 gate — connect a Solana wallet (Phantom / Backpack / Solflare) before
// playing, or jump straight into a free demo. Runs entirely client-side using
// the wallet's injected provider + @solana/web3.js (loaded from CDN).
// -----------------------------------------------------------------------------

var web3 = {
	connection: null,
	publicKey: null,   // solanaWeb3.PublicKey of the connected wallet
	demo: false,
	network: "devnet"
};


// Find an injected Solana provider (Phantom exposes window.solana / window.phantom.solana).
var getSolanaProvider = function() {
	if (window.phantom && window.phantom.solana && window.phantom.solana.isPhantom) {
		return window.phantom.solana;
	}
	if (window.solana) {
		return window.solana;
	}
	return null;
};


var shortAddress = function(pubkey) {
	var s = pubkey.toString();
	return s.slice(0, 4) + "…" + s.slice(-4);
};


var setGateStatus = function(msg, kind) {
	var el = document.getElementById('web3-status');
	if (!el) return;
	el.innerHTML = msg;
	el.className = 'web3-status' + (kind ? ' web3-status-' + kind : '');
};


// Try to read the wallet balance on the chosen network (best-effort, never fatal).
var showWalletBalance = function(publicKey) {
	var infoEl = document.getElementById('walletInfo');
	if (!infoEl) return;

	infoEl.innerHTML =
		'<div class="wallet-addr">' + shortAddress(publicKey) + '</div>' +
		'<div class="wallet-bal">balance: …</div>';

	if (typeof solanaWeb3 === 'undefined') return;

	try {
		web3.connection = new solanaWeb3.Connection(
			solanaWeb3.clusterApiUrl(web3.network), 'confirmed'
		);
		web3.connection.getBalance(publicKey).then(function (lamports) {
			var sol = lamports / solanaWeb3.LAMPORTS_PER_SOL;
			infoEl.innerHTML =
				'<div class="wallet-addr">' + shortAddress(publicKey) + '</div>' +
				'<div class="wallet-bal">' + sol.toFixed(4) + ' SOL <span class="wallet-net">(' + web3.network + ')</span></div>';
		}).catch(function () {
			infoEl.innerHTML =
				'<div class="wallet-addr">' + shortAddress(publicKey) + '</div>' +
				'<div class="wallet-bal">balance unavailable</div>';
		});
	} catch (err) {
		// ignore — connection / RPC not available
	}
};


// Reveal the small in-game wallet badge (top-right corner).
var showWalletBadge = function(text, demo) {
	var badge = document.getElementById('wallet-badge');
	if (!badge) return;
	badge.innerHTML = (demo ? '◇ DEMO' : '◆ ' + text);
	badge.className = 'wallet-badge visible' + (demo ? ' demo' : '');
};


// Hide the gate overlay and hand off to the existing welcome / username screen.
var leaveGate = function(suggestedName) {
	var gate = document.getElementById('web3-gate');
	if (gate) {
		gate.style.opacity = 0;
		setTimeout(function () { gate.style.display = 'none'; }, 350);
	}
	enterWelcome(suggestedName);
};


var connectWallet = function() {
	var provider = getSolanaProvider();

	if (!provider) {
		setGateStatus(
			'No Solana wallet found. Install ' +
			'<a href="https://phantom.app/" target="_blank">Phantom</a> ' +
			'or use Play Demo.', 'error');
		return;
	}

	setGateStatus('approve the connection in your wallet…', 'pending');

	provider.connect().then(function (resp) {
		web3.provider = provider; // kept for the sign-message handshake in net.js
		var pkString = resp && resp.publicKey ? resp.publicKey.toString() : provider.publicKey.toString();

		try {
			web3.publicKey = (typeof solanaWeb3 !== 'undefined')
				? new solanaWeb3.PublicKey(pkString)
				: { toString: function () { return pkString; } };
		} catch (e) {
			web3.publicKey = { toString: function () { return pkString; } };
		}

		web3.demo = false;
		setGateStatus('wallet connected ✔', 'ok');
		showWalletBalance(web3.publicKey);
		showWalletBadge(shortAddress(web3.publicKey), false);

		// disconnect handling — bounce back to the gate if the user disconnects
		if (provider.on) {
			provider.on('disconnect', function () {
				location.reload();
			});
		}

		setTimeout(function () {
			// wallet connected -> go to the multiplayer lobby
			enterLobby();
		}, 700);

	}).catch(function (err) {
		setGateStatus('connection rejected — try again or use Play Demo.', 'error');
	});
};


var playDemo = function() {
	web3.demo = true;
	web3.publicKey = null;
	showWalletBadge('', true);
	leaveGate('DEMO');
};


// Wire up the gate buttons once the DOM is ready.
var initWeb3Gate = function() {
	var connectBtn = document.getElementById('connectWalletBtn');
	var demoBtn = document.getElementById('playDemoBtn');

	if (connectBtn) connectBtn.addEventListener('click', connectWallet);
	if (demoBtn) demoBtn.addEventListener('click', playDemo);

	// "copy CA" buttons (gate + lobby)
	var copyCA = function(btn) {
		var ca = btn.getAttribute('data-ca');
		var done = function () {
			btn.classList.add('copied');
			var hint = btn.querySelector('.ca-hint');
			var prev = hint ? hint.innerHTML : null;
			if (hint) hint.innerHTML = 'copied ✔';
			setTimeout(function () {
				btn.classList.remove('copied');
				if (hint && prev !== null) hint.innerHTML = prev;
			}, 1500);
		};
		if (navigator.clipboard && navigator.clipboard.writeText) {
			navigator.clipboard.writeText(ca).then(done).catch(function () { fallbackCopy(ca); done(); });
		} else {
			fallbackCopy(ca); done();
		}
	};
	var fallbackCopy = function(text) {
		var t = document.createElement('textarea');
		t.value = text; t.style.position = 'fixed'; t.style.opacity = '0';
		document.body.appendChild(t); t.focus(); t.select();
		try { document.execCommand('copy'); } catch (e) {}
		document.body.removeChild(t);
	};
	var caButtons = document.querySelectorAll('.ca-copy');
	for (var i = 0; i < caButtons.length; i++) {
		(function (b) { b.addEventListener('click', function () { copyCA(b); }); })(caButtons[i]);
	}
};

if (document.readyState === 'loading') {
	document.addEventListener('DOMContentLoaded', initWeb3Gate);
} else {
	initWeb3Gate();
}
