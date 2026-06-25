"use strict";

var startGame = function(e) {

	var inputEl = document.getElementById('usernameInput');
	var underline = document.getElementById('underline');
	var welcome = document.getElementById('welcome-msg');
	var countDown = document.getElementById('count-down');
	var username = inputEl.value.trim();

	if (!username) {

		inputEl.style.color = '#f55';
		underline.style.background = '#f55';
		return;
		
	} else {

		inputEl.style.color = '#8f8';
		underline.style.background = '#5f5';

		if (e.keyCode === 13) {

			inputEl.style.transition = ".3s ease";
			inputEl.style.color = '#9f9';
			underline.style.background = '#7f7';
			inputEl.style.textShadow = "0px 0px 10px rgba(140,255,250,0.7)";
			inputEl.blur();



			player1.name = username;
			player1.textLabel = username;
			player1.color = 0x0066dd;


			player1 = spawnCycle(player1, -330, 6, 1, false);
			
			changeViewTargetTo(0);
			
			
			setTimeout( function () {
				
				hideElement(welcome, inputEl);
				
				document.removeEventListener('keyup', startGame);
				document.addEventListener('keydown', handleKeyDown, false);
				document.addEventListener('keyup', handleKeyUp, false);
				THREEx.FullScreen.bindKey();

				otherPlayers[2] = spawnCycle(otherPlayers[2], 330, -12, 3, true);
				otherPlayers[0] = spawnCycle(otherPlayers[0], 320, 0, 3, true);
				otherPlayers[1] = spawnCycle(otherPlayers[1], 320, 12, 3, true);
				otherPlayers[3] = spawnCycle(otherPlayers[3], 330, 24, 3, true);
				
				pause();

			}, 370);
		}
	}
};


var initGame = function() {

	createGrid();

	camera.lookAt(player1.position);

	gauge.rubber.max.innerHTML = gauge.rubber.maxVal;
	gauge.speed.max.innerHTML = gauge.speed.maxVal;
	gauge.brakes.max.innerHTML = gauge.brakes.maxVal;

	// the welcome screen + its keyboard handler are revealed by the Web3 gate
	// via enterWelcome(), only after the player connects a wallet or picks
	// demo mode. See scripts/web3.js
	animate();
};


// Called by the Web3 gate once the player has connected a wallet or chosen
// demo mode. Reveals the existing username / instructions screen.
var enterWelcome = function(suggestedName) {

	var welcome = document.getElementById('welcome-msg');
	welcome.style.display = '';
	welcome.style.visibility = 'visible';
	welcome.style.opacity = 1;

	var inputEl = document.getElementById('usernameInput');
	if (suggestedName && !inputEl.value) {
		inputEl.value = suggestedName;
	}
	inputEl.focus();

	document.addEventListener('keyup', startGame);
};

window.onload = function() {

	initGame();
};
