"use strict";

// -----------------------------------------------------------------------------
// TrenchLine — realtime room / relay server
//
//  - rooms identified by a short code; players identified by Solana wallet
//  - wallet ownership is proven on connect via a signed nonce (sign-message)
//  - rounds: last cycle alive wins; win counts are persisted per wallet
//
// Client-authoritative simulation: each browser runs its own cycle physics and
// reports position / turns / crashes; the server relays those and arbitrates
// round outcomes from the crash reports.
// -----------------------------------------------------------------------------

const path = require("path");
const http = require("http");
const fs = require("fs");
const express = require("express");
const { Server } = require("socket.io");
const nacl = require("tweetnacl");
const bs58 = require("bs58").default || require("bs58");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const PORT = process.env.PORT || 3000;
const MAX_PLAYERS = 6;
const ROUND_INTERMISSION = 5000; // ms between rounds

app.use(express.static(path.join(__dirname, "..")));

// spawn slots + colors handed out per room seat (left side races right side)
const SLOTS = [
	{ x: -330, z:   0, dir: 1, color: 0x42ACED, engineType: 0 },
	{ x:  330, z:   0, dir: 3, color: 0xff6600, engineType: 1 },
	{ x: -330, z:  64, dir: 1, color: 0x14F195, engineType: 2 },
	{ x:  330, z:  64, dir: 3, color: 0x00dddd, engineType: 3 },
	{ x: -330, z: -64, dir: 1, color: 0xdd0099, engineType: 4 },
	{ x:  330, z: -64, dir: 3, color: 0xffdd00, engineType: 0 }
];


/* ------------------------------------------------------------- win stats */

const STATS_FILE = path.join(__dirname, "stats.json");
let stats = {};            // wallet -> { name, wins }
let saveTimer = null;

try {
	stats = JSON.parse(fs.readFileSync(STATS_FILE, "utf8"));
} catch (e) {
	stats = {};
}

function saveStats() {
	clearTimeout(saveTimer);
	saveTimer = setTimeout(function () {
		fs.writeFile(STATS_FILE, JSON.stringify(stats, null, 2), function () {});
	}, 500);
}

function addWin(wallet, name) {
	if (!wallet) return 0;
	if (!stats[wallet]) stats[wallet] = { name: name, wins: 0 };
	stats[wallet].name = name || stats[wallet].name;
	stats[wallet].wins += 1;
	saveStats();
	return stats[wallet].wins;
}

function walletWins(wallet) {
	return (stats[wallet] && stats[wallet].wins) || 0;
}

function leaderboard(limit) {
	return Object.keys(stats)
		.map(function (w) { return { wallet: w, name: stats[w].name, wins: stats[w].wins }; })
		.sort(function (a, b) { return b.wins - a.wins; })
		.slice(0, limit || 10);
}


/* --------------------------------------------------------- sign-message auth */

function authMessage(nonce) {
	return "TrenchLine login\nProve you own this wallet.\nnonce: " + nonce;
}

function verifySignature(wallet, nonce, signature) {
	try {
		const msg = new TextEncoder().encode(authMessage(nonce));
		const sig = Uint8Array.from(signature);
		const pub = bs58.decode(wallet);
		return nacl.sign.detached.verify(msg, sig, pub);
	} catch (e) {
		return false;
	}
}


/* ----------------------------------------------------------------- rooms */

const rooms = new Map();

function makeRoomId() {
	let id;
	do { id = Math.random().toString(36).slice(2, 6).toUpperCase(); }
	while (rooms.has(id));
	return id;
}

function roomSummary(room) {
	return { id: room.id, name: room.name, count: room.players.size, max: MAX_PLAYERS, started: room.started };
}

function openRoomList() {
	const list = [];
	for (const room of rooms.values()) {
		if (!room.started && room.players.size < MAX_PLAYERS) list.push(roomSummary(room));
	}
	return list;
}

function playerList(room) {
	const arr = [];
	for (const p of room.players.values()) {
		arr.push({
			id: p.id, wallet: p.wallet, name: p.name, seat: p.seat,
			color: p.color, isHost: p.id === room.hostId, wins: walletWins(p.wallet)
		});
	}
	return arr;
}

function broadcastRoom(room) {
	io.to(room.id).emit("roomUpdate", {
		id: room.id, name: room.name, hostId: room.hostId, players: playerList(room)
	});
}

function spawnList(room) {
	const arr = [];
	for (const p of room.players.values()) {
		const slot = SLOTS[p.seat % SLOTS.length];
		arr.push({
			id: p.id, wallet: p.wallet, name: p.name,
			color: (typeof p.color === "number") ? p.color : slot.color,
			engineType: slot.engineType,
			x: slot.x, z: slot.z, dir: slot.dir, seat: p.seat
		});
	}
	return arr;
}

function scoreboard(room) {
	const arr = [];
	for (const p of room.players.values()) {
		arr.push({
			id: p.id, name: p.name, wallet: p.wallet, color: p.color,
			seat: p.seat, sessionWins: p.sessionWins, wins: walletWins(p.wallet), alive: p.alive
		});
	}
	return arr.sort(function (a, b) { return b.sessionWins - a.sessionWins; });
}


function startRound(room) {
	for (const p of room.players.values()) p.alive = true;
	room.roundEnding = false;
	io.to(room.id).emit("roundStart", { round: room.round, players: spawnList(room) });
}

function checkRoundEnd(room) {
	if (!room.started || room.roundEnding) return;

	const alive = [];
	for (const p of room.players.values()) if (p.alive) alive.push(p);

	// round only resolves once at most one cycle remains
	if (alive.length > 1) return;
	if (room.players.size < 2 && alive.length > 0) return; // solo practice: don't end

	room.roundEnding = true;

	let winner = null;
	if (alive.length === 1 && room.players.size >= 2) {
		const w = alive[0];
		w.sessionWins += 1;
		const total = addWin(w.wallet, w.name);
		winner = { id: w.id, name: w.name, wallet: w.wallet, wins: total };
	}

	io.to(room.id).emit("roundOver", {
		round: room.round,
		winner: winner,
		scores: scoreboard(room),
		nextIn: ROUND_INTERMISSION
	});

	setTimeout(function () {
		if (!rooms.has(room.id) || !room.started) return;
		if (room.players.size === 0) return;
		room.round += 1;
		startRound(room);
	}, ROUND_INTERMISSION);
}


/* -------------------------------------------------------------- connection */

io.on("connection", (socket) => {

	socket.data.wallet = null;
	socket.data.name = null;
	socket.data.roomId = null;
	socket.data.authed = false;
	socket.data.nonce = null;

	socket.on("hello", (profile) => {
		socket.data.name = (profile && profile.name) || "guest";
		if (profile && typeof profile.color === "number") socket.data.color = profile.color;
	});

	// chosen cycle colour ("character")
	socket.on("setCharacter", (data) => {
		if (!data || typeof data.color !== "number") return;
		socket.data.color = data.color;
		const room = rooms.get(socket.data.roomId);
		if (room && !room.started) {
			const p = room.players.get(socket.id);
			if (p) { p.color = data.color; broadcastRoom(room); }
		}
	});

	// sign-message handshake
	socket.on("requestNonce", (cb) => {
		socket.data.nonce = Math.random().toString(36).slice(2) + Date.now().toString(36);
		if (typeof cb === "function") cb(socket.data.nonce);
	});

	socket.on("auth", (data, cb) => {
		const ok = data && data.wallet && socket.data.nonce &&
			verifySignature(data.wallet, socket.data.nonce, data.signature);
		socket.data.authed = !!ok;
		if (ok) {
			socket.data.wallet = data.wallet;
			if (data.name) socket.data.name = data.name;
		}
		if (typeof cb === "function") cb({ verified: !!ok, wins: ok ? walletWins(data.wallet) : 0 });
	});

	function requireAuth(cb) {
		if (socket.data.authed) return true;
		if (typeof cb === "function") cb({ ok: false, error: "verify your wallet first" });
		return false;
	}

	socket.on("listRooms", (cb) => { if (typeof cb === "function") cb(openRoomList()); });

	socket.on("leaderboard", (cb) => { if (typeof cb === "function") cb(leaderboard(10)); });

	socket.on("createRoom", (data, cb) => {
		if (!requireAuth(cb)) return;
		const id = makeRoomId();
		const room = {
			id,
			name: (data && data.name && String(data.name).slice(0, 20)) || ("room " + id),
			hostId: socket.id,
			started: false,
			round: 0,
			roundEnding: false,
			players: new Map()
		};
		rooms.set(id, room);
		joinRoom(socket, room, cb);
	});

	socket.on("joinRoom", (data, cb) => {
		if (!requireAuth(cb)) return;
		const room = rooms.get(data && data.roomId);
		if (!room) return cb && cb({ ok: false, error: "room not found" });
		if (room.started) return cb && cb({ ok: false, error: "race already started" });
		if (room.players.size >= MAX_PLAYERS) return cb && cb({ ok: false, error: "room full" });
		joinRoom(socket, room, cb);
	});

	socket.on("leaveRoom", () => leaveRoom(socket));

	socket.on("start", () => {
		const room = rooms.get(socket.data.roomId);
		if (!room || room.hostId !== socket.id || room.started) return;
		room.started = true;
		room.round = 1;
		for (const p of room.players.values()) { p.alive = true; p.sessionWins = 0; }
		io.to(room.id).emit("started", { roomId: room.id, round: room.round, players: spawnList(room) });
	});

	// crash is authoritative for round outcome
	socket.on("crash", (payload) => {
		const room = rooms.get(socket.data.roomId);
		if (!room) return;
		payload = payload || {};
		payload.id = socket.id;
		socket.to(room.id).emit("peerCrash", payload);

		const p = room.players.get(socket.id);
		if (p && p.alive) {
			p.alive = false;
			checkRoundEnd(room);
		}
	});

	// pure relays
	const relay = (event) => (payload) => {
		const room = rooms.get(socket.data.roomId);
		if (!room) return;
		payload = payload || {};
		payload.id = socket.id;
		socket.to(room.id).emit(event, payload);
	};
	socket.on("state", relay("peerState"));
	socket.on("turn", relay("peerTurn"));

	socket.on("disconnect", () => leaveRoom(socket));


	function joinRoom(sock, room, cb) {
		room.players.set(sock.id, {
			id: sock.id, wallet: sock.data.wallet, name: sock.data.name,
			color: sock.data.color, seat: room.players.size, alive: true, sessionWins: 0
		});
		sock.data.roomId = room.id;
		sock.join(room.id);
		if (typeof cb === "function") {
			cb({ ok: true, roomId: room.id, name: room.name, hostId: room.hostId, players: playerList(room) });
		}
		broadcastRoom(room);
	}
});


function leaveRoom(socket) {
	const room = rooms.get(socket.data.roomId);
	if (!room) return;

	room.players.delete(socket.id);
	socket.leave(room.id);
	socket.to(room.id).emit("peerLeft", { id: socket.id });
	socket.data.roomId = null;

	if (room.players.size === 0) {
		rooms.delete(room.id);
		return;
	}
	if (room.hostId === socket.id) {
		room.hostId = room.players.keys().next().value;
	}
	broadcastRoom(room);

	if (room.started) checkRoundEnd(room);
}


server.listen(PORT, () => {
	console.log("TrenchLine server running:  http://localhost:" + PORT);
});
