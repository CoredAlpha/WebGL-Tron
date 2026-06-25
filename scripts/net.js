"use strict";

// -----------------------------------------------------------------------------
// TrenchLine — multiplayer client
//
// Talks to the Socket.IO relay in /server. Handles wallet verification
// (sign-message), the lobby (profile, rooms, leaderboard) and, during a race,
// syncs the local cycle to peers, renders peers as network-driven cycles, and
// runs the round / scoreboard flow (last cycle alive wins).
// -----------------------------------------------------------------------------

var net = {
	socket: null,
	active: false,        // true while a networked race is running
	connected: false,
	authed: false,        // wallet ownership proven via sign-message
	selfId: null,
	myWins: 0,
	room: null,           // { roomId, hostId, players: [...] }
	remotePlayers: {},    // socketId -> remote cycle
	stateInterval: 70,    // ms between local state broadcasts
	_lastSend: 0
};


// selectable cycle "characters" — differ by colour only
var CHARACTERS = [
	{ name: 'Cyan',    color: 0x42ACED },
	{ name: 'Spark',   color: 0x14F195 },
	{ name: 'Ember',   color: 0xff6600 },
	{ name: 'Magenta', color: 0xdd0099 },
	{ name: 'Gold',    color: 0xffdd00 },
	{ name: 'Aqua',    color: 0x00dddd },
	{ name: 'Crimson', color: 0xff3344 },
	{ name: 'Violet',  color: 0x9b5cff },
	{ name: 'Lime',    color: 0x88ff00 },
	{ name: 'Rose',    color: 0xff66cc },
	{ name: 'Frost',   color: 0xbfefff },
	{ name: 'Teal',    color: 0x00ffaa }
];


/* ------------------------------------------------------------------ helpers */

var lobbyEl = function(id) { return document.getElementById(id); };

var hexColor = function(n) { return '#' + ('000000' + (n >>> 0).toString(16)).slice(-6); };

var setNetStatus = function(msg, kind) {
	var el = lobbyEl('netStatus');
	if (!el) return;
	el.innerHTML = msg;
	el.className = 'net-status' + (kind ? ' net-status-' + kind : '');
};

var normalizeAngle = function(a) {
	while (a >  Math.PI) a -= Math.PI * 2;
	while (a < -Math.PI) a += Math.PI * 2;
	return a;
};

var enableRoomActions = function(on) {
	['createRoomBtn', 'joinCodeBtn'].forEach(function (id) {
		var el = lobbyEl(id);
		if (el) el.disabled = !on;
	});
};


/* ------------------------------------------------------------- lobby screen */

// called by web3.js after a wallet connects
var enterLobby = function() {
	var gate = document.getElementById('web3-gate');
	if (gate) {
		gate.style.opacity = 0;
		setTimeout(function () { gate.style.display = 'none'; }, 350);
	}

	var lobby = document.getElementById('lobby');
	if (lobby) { lobby.style.display = 'flex'; }

	var addr = web3.publicKey ? web3.publicKey.toString() : 'guest';
	var short = web3.publicKey ? (addr.slice(0, 4) + '…' + addr.slice(-4)) : 'GUEST';
	lobbyEl('profAddr').innerHTML = short;
	lobbyEl('profAddr').title = addr;

	net.profile = { wallet: addr, name: short, color: CHARACTERS[0].color };
	selectCharacter(net.profile.color, true); // sets dot + picker without emitting
	renderCharPicker();
	enableRoomActions(false);
	connectSocket();
};


/* --------------------------------------------------------- character picker */

var renderCharPicker = function() {
	var box = lobbyEl('charPicker');
	if (!box) return;
	box.innerHTML = '';
	CHARACTERS.forEach(function (ch) {
		var b = document.createElement('button');
		b.className = 'char-swatch' + (ch.color === net.profile.color ? ' selected' : '');
		b.title = ch.name;
		b.style.background = hexColor(ch.color);
		b.style.boxShadow = '0 0 8px ' + hexColor(ch.color);
		b.addEventListener('click', function () { selectCharacter(ch.color); });
		box.appendChild(b);
	});
};

var selectCharacter = function(color, quiet) {
	net.profile.color = color;
	var dot = lobbyEl('profColor');
	if (dot) { dot.style.background = hexColor(color); dot.style.boxShadow = '0 0 10px ' + hexColor(color); }
	renderCharPicker();
	if (!quiet && net.connected) net.socket.emit('setCharacter', { color: color });
};


var connectSocket = function() {
	if (typeof io === 'undefined') {
		setNetStatus('server library not loaded — run the Node server', 'error');
		return;
	}

	setNetStatus('connecting…', 'pending');
	net.socket = io(window.TRON_SERVER || undefined, { transports: ['websocket', 'polling'] });

	net.socket.on('connect', function () {
		net.connected = true;
		net.selfId = net.socket.id;
		net.socket.emit('hello', net.profile);
		authenticate();
	});

	net.socket.on('disconnect', function () {
		net.connected = false;
		net.authed = false;
		enableRoomActions(false);
		setNetStatus('disconnected', 'error');
	});

	net.socket.on('connect_error', function () {
		setNetStatus('cannot reach server — start it with: node server/server.js', 'error');
	});

	net.socket.on('roomUpdate', onRoomUpdate);
	net.socket.on('started', onStarted);
	net.socket.on('roundStart', onRoundStart);
	net.socket.on('roundOver', onRoundOver);
	net.socket.on('peerState', onPeerState);
	net.socket.on('peerTurn', onPeerTurn);
	net.socket.on('peerCrash', onPeerCrash);
	net.socket.on('peerLeft', onPeerLeft);
};


// prove wallet ownership by signing a server nonce
var authenticate = function() {
	setNetStatus('verify wallet — check the popup…', 'pending');

	if (!web3.provider || typeof web3.provider.signMessage !== 'function') {
		setNetStatus('this wallet cannot sign messages', 'error');
		return;
	}

	net.socket.emit('requestNonce', function (nonce) {
		var message = 'TrenchLine login\nProve you own this wallet.\nnonce: ' + nonce;
		var encoded = new TextEncoder().encode(message);

		web3.provider.signMessage(encoded, 'utf8').then(function (res) {
			var sig = res && res.signature ? res.signature : res;
			net.socket.emit('auth', {
				wallet: net.profile.wallet,
				name: net.profile.name,
				signature: Array.from(sig)
			}, function (r) {
				if (r && r.verified) {
					net.authed = true;
					net.myWins = r.wins || 0;
					updateProfileWins(net.myWins);
					setNetStatus('verified ✔', 'ok');
					enableRoomActions(true);
					refreshRooms();
					loadLeaderboard();
				} else {
					setNetStatus('verification failed', 'error');
					enableRoomActions(false);
				}
			});
		}).catch(function () {
			setNetStatus('signature rejected — reload to verify', 'error');
			enableRoomActions(false);
		});
	});
};

var updateProfileWins = function(wins) {
	var el = lobbyEl('profWins');
	if (el) el.innerHTML = wins + (wins === 1 ? ' win' : ' wins');
};

var loadLeaderboard = function() {
	if (!net.connected) return;
	net.socket.emit('leaderboard', function (list) {
		var box = lobbyEl('leaderboard');
		if (!box) return;
		if (!list || !list.length) { box.innerHTML = '<div class="lb-empty">no wins recorded yet</div>'; return; }
		box.innerHTML = '';
		list.forEach(function (e, i) {
			var short = e.wallet.slice(0, 4) + '…' + e.wallet.slice(-4);
			var row = document.createElement('div');
			row.className = 'lb-row';
			row.innerHTML =
				'<span class="lb-rank">' + (i + 1) + '</span>' +
				'<span class="lb-name">' + (e.name || short) + '</span>' +
				'<span class="lb-wins">' + e.wins + '</span>';
			box.appendChild(row);
		});
	});
};


var refreshRooms = function() {
	if (!net.connected || !net.authed) return;
	net.socket.emit('listRooms', function (list) {
		var box = lobbyEl('roomList');
		box.innerHTML = '';
		if (!list.length) { box.innerHTML = '<div class="room-empty">no open rooms — create one</div>'; return; }
		list.forEach(function (r) {
			var row = document.createElement('div');
			row.className = 'room-item';
			row.innerHTML =
				'<span class="room-item-name">' + r.name + '</span>' +
				'<span class="room-item-meta">' + r.count + '/' + r.max + ' · <b>' + r.id + '</b></span>';
			row.addEventListener('click', function () { joinRoom(r.id); });
			box.appendChild(row);
		});
	});
};

var createRoom = function() {
	if (!net.authed) return;
	var name = (lobbyEl('roomNameInput').value || '').trim();
	net.socket.emit('createRoom', { name: name }, function (res) {
		if (res && res.ok) showRoomView(res);
		else setNetStatus((res && res.error) || 'could not create', 'error');
	});
};

var joinRoom = function(roomId) {
	if (!net.authed) return;
	net.socket.emit('joinRoom', { roomId: roomId }, function (res) {
		if (res && res.ok) showRoomView(res);
		else setNetStatus((res && res.error) || 'could not join', 'error');
	});
};

var joinByCode = function() {
	var code = (lobbyEl('joinCodeInput').value || '').trim().toUpperCase();
	if (code) joinRoom(code);
};

var leaveRoom = function() {
	if (net.connected) net.socket.emit('leaveRoom');
	net.room = null;
	lobbyEl('roomView').classList.add('hidden');
	lobbyEl('lobbyMain').classList.remove('hidden');
	refreshRooms();
};

var showRoomView = function(res) {
	net.room = res;
	lobbyEl('lobbyMain').classList.add('hidden');
	lobbyEl('roomView').classList.remove('hidden');
	lobbyEl('roomCode').innerHTML = res.roomId;
	renderRoomPlayers(res.players, res.hostId);
};

var onRoomUpdate = function(data) {
	if (!net.room || data.id !== net.room.roomId) return;
	net.room.hostId = data.hostId;
	net.room.players = data.players;
	renderRoomPlayers(data.players, data.hostId);
};

var renderRoomPlayers = function(players, hostId) {
	var box = lobbyEl('roomPlayers');
	box.innerHTML = '';
	players.forEach(function (p) {
		var col = (typeof p.color === 'number') ? hexColor(p.color) : '#888';
		var dot = '<span class="seat-dot" style="background:' + col + ';box-shadow:0 0 8px ' + col + '"></span>';
		var host = (p.id === hostId) ? ' <span class="host-tag">HOST</span>' : '';
		var you = (p.id === net.selfId) ? ' <span class="you-tag">YOU</span>' : '';
		var wins = '<span class="rp-wins">' + (p.wins || 0) + 'W</span>';
		var row = document.createElement('div');
		row.className = 'rp-row';
		row.innerHTML = dot + '<span class="rp-name">' + p.name + '</span>' + host + you + wins;
		box.appendChild(row);
	});
	var isHost = (hostId === net.selfId);
	lobbyEl('startGameBtn').style.display = isHost ? '' : 'none';
	lobbyEl('waitHost').style.display = isHost ? 'none' : '';
};

var startRace = function() {
	if (net.connected) net.socket.emit('start');
};


/* --------------------------------------------------------- race + rounds */

var onStarted = function(data) {
	var lobby = document.getElementById('lobby');
	if (lobby) lobby.style.display = 'none';

	createGrid();
	THREEx.FullScreen.bindKey();
	document.addEventListener('keydown', handleKeyDown, false);
	document.addEventListener('keyup', handleKeyUp, false);

	net.active = true;
	spawnRace(data.players);
	hideScoreboard();
	paused = false;
	pauseMsg.style.visibility = 'hidden';
};

var onRoundStart = function(data) {
	hideScoreboard();
	clearArena();
	spawnRace(data.players);
	paused = false;
	pauseMsg.style.visibility = 'hidden';
};

var onRoundOver = function(data) {
	paused = true;
	showScoreboard(data);
};


var spawnRace = function(players) {
	net.remotePlayers = {};
	players.forEach(function (info) {
		if (info.id === net.selfId) {
			player1.name = info.name;
			player1.color = info.color;
			player1.engineType = info.engineType;
			player1 = spawnCycle(player1, info.x, info.z, info.dir, false);
			player1.isLocal = true;
			changeViewTargetTo(0);
		} else {
			createRemoteCycle(info);
		}
	});
};


// remove every cycle / wall / label / explosion from the arena
var clearArena = function() {
	activePlayers.slice().forEach(function (c) {
		scene.remove(c);
		if (c.walls) scene.remove(c.walls);
		if (c.textLabel && c.textLabel.parentNode) c.textLabel.parentNode.removeChild(c.textLabel);
		if (c.engineSound) try { c.engineSound.stop(); } catch (e) {}
		if (c.riseSound) try { c.riseSound.stop(); } catch (e) {}
	});
	activePlayers.length = 0;
	explosions.slice().forEach(function (e) { scene.remove(e.object); });
	explosions.length = 0;
	net.remotePlayers = {};
	pressZ.style.visibility = 'hidden';
	pressX.style.visibility = 'hidden';
};


var createRemoteCycle = function(info) {
	var cycle = createLightcycle({
		x: info.x, z: info.z, dir: info.dir,
		colorCode: info.color, engineType: info.engineType,
		ai: false, playerID: 100 + (info.seat || 0), name: info.name
	});
	scene.add(cycle);
	cycle.textLabel = createLabel(info.name);
	cycle.respawnAvailable = false;
	cycle.remote = true;
	cycle.netId = info.id;
	cycle.netSpeed = regularSpeed;
	cycle.netPos = { x: info.x, z: info.z };
	cycle.renderList.push(animateCycle(cycle));
	cycle.renderList.push(fadeInLabel(cycle));
	addWall(cycle);
	cycle.engineSound = playSound(bufferLoader.bufferList[info.engineType], 0.5, 1, true, cycle.audio);
	cycle.audio.gain.setTargetAtTime(4, ctx.currentTime, 1.0);
	activePlayers.push(cycle);
	net.remotePlayers[info.id] = cycle;
	return cycle;
};


var updateRemoteCycle = function(cycle) {
	if (!cycle.alive) return;
	var v = (cycle.netSpeed || regularSpeed) * frameTime;
	cycle.translateX(v);
	if (cycle.currentWall) {
		cycle.currentWall.scale.x += v;
		cycle.currentWall.children[0].material.map.repeat.x = cycle.currentWall.scale.x / wallTextureProportion;
	}
	if (cycle.netPos) {
		cycle.position.x += (cycle.netPos.x - cycle.position.x) * 0.18;
		cycle.position.z += (cycle.netPos.z - cycle.position.z) * 0.18;
	}
	audioMixing(cycle);
	updateLabel(cycle);
};


/* ------------------------------------------------------------- peer handlers */

var onPeerState = function(d) {
	var c = net.remotePlayers[d.id];
	if (!c || !c.alive) return;
	c.netSpeed = d.s;
	c.netPos = { x: d.p[0], z: d.p[1] };
	if (Math.abs(normalizeAngle(d.r - c.rotation.y)) > 0.1) {
		c.position.x = d.p[0]; c.position.z = d.p[1];
		c.rotation.y = d.r;
		addWall(c);
	} else {
		c.rotation.y = d.r;
	}
};

var onPeerTurn = function(d) {
	var c = net.remotePlayers[d.id];
	if (!c || !c.alive) return;
	c.position.x = d.p[0]; c.position.z = d.p[1];
	c.rotation.y = d.r;
	c.netPos = { x: d.p[0], z: d.p[1] };
	addWall(c);
};

var onPeerCrash = function(d) {
	var c = net.remotePlayers[d.id];
	if (!c || !c.alive) return;
	if (d.p) { c.position.x = d.p[0]; c.position.z = d.p[1]; }
	crash(c);
};

var onPeerLeft = function(d) {
	var c = net.remotePlayers[d.id];
	if (c && c.alive) crash(c);
	delete net.remotePlayers[d.id];
};


/* -------------------------------------------------------------- local sends */

net.tick = function() {
	if (!net.active || !net.connected || !player1 || !player1.alive) return;
	var now = (typeof performance !== 'undefined') ? performance.now() : Date.now();
	if (now - net._lastSend < net.stateInterval) return;
	net._lastSend = now;
	net.socket.emit('state', { p: [player1.position.x, player1.position.z], r: player1.rotation.y, s: player1.speed });
};

net.sendTurn = function(cycle) {
	if (!net.active || !net.connected) return;
	net.socket.emit('turn', { p: [cycle.position.x, cycle.position.z], r: cycle.rotation.y });
};

net.sendCrash = function(cycle) {
	if (!net.active || !net.connected) return;
	net.socket.emit('crash', { p: [cycle.position.x, cycle.position.z] });
};


/* ----------------------------------------------------------------- scoreboard */

var showScoreboard = function(data) {
	var el = document.getElementById('scoreboard');
	if (!el) return;

	var title = data.winner
		? '<div class="sb-winner">🏆 ' + data.winner.name + ' wins round ' + data.round + '</div>'
		: '<div class="sb-winner sb-draw">round ' + data.round + ' — draw</div>';

	var rows = data.scores.map(function (s, i) {
		var me = (s.id === net.selfId) ? ' sb-me' : '';
		var col = (typeof s.color === 'number') ? hexColor(s.color) : '#888';
		return '<div class="sb-row' + me + '">' +
			'<span class="seat-dot" style="background:' + col + ';box-shadow:0 0 8px ' + col + '"></span>' +
			'<span class="sb-name">' + s.name + '</span>' +
			'<span class="sb-sw">' + s.sessionWins + '</span>' +
			'<span class="sb-tw">' + s.wins + ' total</span>' +
			'</div>';
	}).join('');

	el.innerHTML =
		'<div class="sb-box">' +
			title +
			'<div class="sb-head"><span></span><span>NAME</span><span>RND</span><span>WINS</span></div>' +
			rows +
			'<div class="sb-next">next round in <span id="sbCountdown">' +
				Math.ceil((data.nextIn || 5000) / 1000) + '</span>s</div>' +
		'</div>';
	el.style.display = 'flex';

	var left = Math.ceil((data.nextIn || 5000) / 1000);
	clearInterval(net._sbTimer);
	net._sbTimer = setInterval(function () {
		left -= 1;
		var c = document.getElementById('sbCountdown');
		if (c) c.innerHTML = Math.max(0, left);
		if (left <= 0) clearInterval(net._sbTimer);
	}, 1000);

	// refresh own win total shown in (hidden) lobby for later
	if (data.winner && data.winner.id === net.selfId) {
		net.myWins = data.winner.wins;
		updateProfileWins(net.myWins);
	}
};

var hideScoreboard = function() {
	var el = document.getElementById('scoreboard');
	if (el) el.style.display = 'none';
	clearInterval(net._sbTimer);
};


/* ----------------------------------------------------------------- UI wiring */

var initLobbyUI = function() {
	var on = function(id, fn) { var el = lobbyEl(id); if (el) el.addEventListener('click', fn); };
	on('createRoomBtn', createRoom);
	on('joinCodeBtn', joinByCode);
	on('refreshRoomsBtn', function () { refreshRooms(); loadLeaderboard(); });
	on('lobbyBackBtn', function () { location.reload(); });
	on('startGameBtn', startRace);
	on('leaveRoomBtn', leaveRoom);

	var codeInput = lobbyEl('joinCodeInput');
	if (codeInput) {
		codeInput.addEventListener('input', function () { this.value = this.value.toUpperCase(); });
		codeInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') joinByCode(); });
	}
	var nameInput = lobbyEl('roomNameInput');
	if (nameInput) {
		nameInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') createRoom(); });
	}
};

if (document.readyState === 'loading') {
	document.addEventListener('DOMContentLoaded', initLobbyUI);
} else {
	initLobbyUI();
}
