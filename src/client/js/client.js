import Action from '../../common/action';
import Player from '../../common/player';
import Mob from '../../common/mob';
import World from '../../common/world';
import GameConfig from '../../common/config';
import InternalServer from './singleserver';

var GAME_DEBUG = false;
var IMG_PREFIX = '/assets/';

// Frontend and server vars.
var playerName;
var playerNameInput;
var serverAddress;
var connectTries = 0;
var maxConnectTries = 10;
var socket;
var game;

// Offline Mode. This is only normally available on Android/iOS but can be
// easily enabled for desktop as well.
var offlineMode;
var internalServer;
var internalServerUpdater;

// GAME VARS
var KEY_ENTER = 13;
var gameInProgress = false;
var blockBackButton = false;
var skipAd = false;

//prevent startGame() from being called multiple times.
var spawnPressed = false;
var gameStarted = false;
var serverRequested = false;

var gameConfig = new GameConfig();
var screenX = gameConfig.screenX;
var screenY = gameConfig.screenY;

// Lag measurement.
var curLag = 0;
var lagCounter = 0;
var pingSent = false;

var inputCounter = 0;
var inputThreshold = 1;

var world = new World(); // use defaults.
var worldSprites;
var lastTX, lastTY;

var cameraset = false;
var mykeys;
var fireflag = false;
var lastAction;
var curAction;
var curPlayer;
var totalPlayers;

var curClientMS;
var lastClientMS; // uses game.time.now;
var clientElapsedMS;
var targetFPS = 30; // MUST BE SAME AS SERVER.
var minMS = 1000 / targetFPS;

// Client-side prediction.
var showGhost = false;
var tmpPlayer;
var tmpPlayerAction;
var nextActionID;
var actionList;

// Display groups.
var worldGroup;
var playerGroup;
var curPlayerGroup;
var mobGroup;
var bombGroup;
var explosionGroup;
var powerupGroup;
var shadeGroup;
var controlsGroup;

// Sprites.
var controlSprites = {};
var playerSprites = {};
var mobSprites = {};
var bombSprites = {};
var explosionEmitters = {};
var powerupSprites = [];

var playerNames = {};
var playerSpriteServer;

var knownPlayers = {};
var knownMobs = {};
var knownBombs = {};
var knownExplosions = {};

var flickerToggle = false;
var flickerTimeout = 2;
var flickerCount = 0;

var deadSprite;
var deadCounter;
var isDead;
var quitFlag;
var deadReason;

// Touchscreen.
var touchEnabled;
var playerStatsDisplayed;
var iconDisplayed;
var touchActions;
var leaderboardNames = [];
var leaderboardScores = [];
var leaderboardShade;

var scoreShade;
var scoreText;

window.onload = function() {
    'use strict';

    gameInProgress = false;
    spawnPressed = false;
    gameStarted = false;
    serverRequested = false;
    offlineMode = false;

    var btn = document.getElementById('startButton'),
        nickErrorText = document.querySelector('#startMenu .input-error');

    playerNameInput = document.getElementById('playerNameInput');

    btn.onclick = function () {
        // Check if the nickname is valid.
        if (validNick()) {
            offlineMode = false;

            startGame();
        } else {
            nickErrorText.style.display = 'inline';
        }
    };


    playerNameInput.addEventListener('keypress', function (e) {
        var key = e.which || e.keyCode;

        if (key === KEY_ENTER) {
            if (validNick()) {
                startGame();
            } else {
                nickErrorText.style.display = 'inline';
            }
        }
    });

    var respawnBtn = document.getElementById('respawnBtn');
    respawnBtn.onclick = function() {
        if (!spawnPressed) {
            spawnPressed = true;

            // Actually respawn.
            startGame();
        }
    };

    var ep = document.getElementById('exitpopup');
    if (ep) {
        ep.style.display = 'none';
        var btnYes = document.getElementById('exityes');
        btnYes.onclick = function() {
            quitGame({ backToMain: true});
        };

        var btnNo = document.getElementById('exitno');
        btnNo.onclick = function() {
            hideExitPopup();
        };
    }

    if (isMobile()) {
        document.getElementById('instructions').style.display = 'none';
    }
    else {
        document.getElementById('instructions').style.display = 'block';
    }
};

// Check if nickname contains invalid characters.
// Returns true if valid, otherwise false.
function validNick() {
    var regex = /^[\w\s\,\.\_\:\'\!\^\*\(\)\=\-]+$/;

    if (playerNameInput.value.length > 20) {
        return false;
    }

    return regex.exec(playerNameInput.value) !== null;
}

function goBack() {
    if (blockBackButton) {
        return;
    }

    // Go back to main menu, unless already there, in which case the
    // app can exit.
    if (gameInProgress) {
        quitGame({ backToMain: true});
    }
    else {
        navigator.app.exitApp();
    }
}

function makep(text) {
    return '<p>' + text + '</p>';
}

function showModal() {
    var content = "<table border='0' width='80%' style='margin:auto'>"
    content += "<tr><td><img src='" + IMG_PREFIX;
    content += "dsicon200.png' width='100px' height='100px'></td><td>";
    if (deadReason) {
        content += makep(deadReason);
    }
    else {
        content += makep('You were disconnected. Connectivity issue?');
        content += makep('We apologize for any inconvenience.');
    }

    if (curPlayer) {
        content += makep("Your final score: " + curPlayer.score);
    }

    content += "</td></tr></table>";

    document.getElementById('deadReason').innerHTML = content;

    spawnPressed = false;

    document.getElementById('gameAreaWrapper').style.display = 'none';
    document.getElementById('startMenuWrapper').style.display = 'none';
    document.getElementById('postGameWrapper').style.display = 'block';
}

function isMobile() {
    if (/Android|webOS|iPhone|iPad|iPod|BlackBerry|BB|PlayBook|IEMobile|Windows Phone|Kindle|Silk|Opera Mini/i.test(navigator.userAgent)) {
        // Take the user to a different screen here.
        return true;
    }

    return false;
}

function isAndroid() {
    if (/Android/i.test(navigator.userAgent)) {
        return true;
    }

    return false;
}

function isApple() {
    if (/(iPhone|iPad)/i.test(navigator.userAgent)) {
        return true;
    }

    return false;
}

function isChrome() {
    return /Chrome/.test(navigator.userAgent) &&
        /Google Inc/.test(navigator.vendor);
}

function showLoadingScreen(message) {
    if (!message) {
        message = "Loading...";
    }

    document.getElementById('loadingText').innerHTML = makep(message);
    document.getElementById('gameAreaWrapper').style.display = 'none';
    document.getElementById('startMenuWrapper').style.display = 'none';
    document.getElementById('postGameWrapper').style.display = 'none';
    document.getElementById('loadingWrapper').style.display = 'block';
}

function showGame() {
    document.getElementById('gameAreaWrapper').style.display = 'block';
    document.getElementById('startMenuWrapper').style.display = 'none';
    document.getElementById('postGameWrapper').style.display = 'none';
    document.getElementById('loadingWrapper').style.display = 'none';
}

function requestServer() {
    if (serverAddress) {
        return;
    }

    if (serverRequested) {
        return;
    }

    serverRequested = true;

    var sock = io();
    sock.on('server', function(data) {
        sock.disconnect();

        if (serverAddress) {
            // Already done. Ignore all future requests.
            return;
        }

        connectTries = maxConnectTries;
        serverAddress = data.ip;
        if (!serverAddress) {
            deadReason = 'Unable to find server to connect to.<br />';
            deadReason += 'Please try again';
            showModal();
            return;
        }

        // Now start a new game using this server.
        window.setTimeout(startGame, 1);
    });

    connectTries++;
    if (connectTries < maxConnectTries) {
        sock.emit('get server');
        window.setTimeout(requestServer, 1000);
        return;
    }

    sock.disconnect();
    connectTries = 0;
    deadReason = 'Unable to find server to connect to.<br />Please try again';
    serverRequested = false;
    showModal();
}

function startGame() {
    if (gameStarted) {
        // Prevent re-entry, say if the user clicks the start button twice.
        return;
    }

    gameStarted = true;

    if (GAME_DEBUG) {
        console.log("Game started");
    }

    playerName = playerNameInput.value.replace(/(<([^>]+)>)/ig, '');

    if (offlineMode) {
        internalServer = new InternalServer();
        internalServerUpdater = window.setInterval(function() {
            if (internalServer) {
                internalServer.gameLoop();
            }
        }, 1000 / internalServer.targetFPS);
    }
    else {
        showLoadingScreen('Connecting to server...');

        // Show loading screen.
        if (!serverAddress) {
            gameStarted = false;
            requestServer();
            return;
        }
    }

    hideExitPopup();

    gameInProgress = true;
    blockBackButton = false;
    spawnPressed = false;

    // Phaser.CANVAS is faster on firefox, AUTO is faster on chrome.
    // It seems that Chrome is the only browser that actually works well with
    // webGL (at least with Phaser.io) - so use canvas for all others.
    var canvasType = Phaser.CANVAS;

    if (isChrome()) {
        canvasType = Phaser.AUTO;
    }

    if (isMobile()) {
        // Adjust screen size to fit aspect ratio.
        var aspect = window.screen.width / window.screen.height;

        if (aspect < 1) {
            // Device is in portrait mode.
            aspect = window.screen.height / window.screen.width;
        }

        if (aspect > 1.33) {
            // Reduce screenY to fit actual screen aspect.
            screenX = gameConfig.screenX;
            screenY = screenX * (1 / aspect);
        }
        else {
            // Reduce screenX to fit actual screen aspect.
            screenY = gameConfig.screenY;
            screenX = screenY * aspect;
        }
    }

    // Remove all child elements of gameCanvas - phaser bug!
    var canvas = document.getElementById('gameCanvas');
    while (canvas.hasChildNodes()) {
        canvas.removeChild(canvas.lastChild);
    }

    game = new Phaser.Game(screenX, screenY,
                           canvasType, 'gameCanvas',
                           { preload: preload,
                             create: create,
                             update: update });

    cameraset = false;
    curPlayer = null;

    isDead = false;
    // Wait for 2 seconds before exiting game.
    // This gives the player time to see how they died, and also to display
    // the 'death' animation.
    deadCounter = targetFPS * 3;
    quitFlag = false;
    deadSprite = null;
    actionList = [];
    nextActionID = 0;
    lastClientMS = 0;
    curClientMS = 0;
    deadReason = '';
    touchActions = {up: false,
                    down: false,
                    left: false,
                    right: false,
                    bomb: false
                   };
    leaderboardNames = [];
    leaderboardScores = [];
}

function quitGame(data) {
    gameStarted = false;

    hideExitPopup();

    if (socket) {
        socket.disconnect();
        socket = null;
    }

    cleanup();

    if (game) {
        game.destroy();
        game = null;
    }

    // Only allow respawn screen in online mode.
    if (data && data.backToMain) {
        document.getElementById('gameAreaWrapper').style.display = 'none';
        document.getElementById('startMenuWrapper').style.display = 'none';
        document.getElementById('postGameWrapper').style.display = 'none';
        document.getElementById('loadingWrapper').style.display = 'none';
        gameInProgress = false;
        spawnPressed = false;

        // Reload.
        window.location.reload(true);
    }
    else {
        window.setTimeout(showModal, 1000);
    }
}

function cleanup() {
    cameraset = false;
    mykeys = null;
    lastAction = null;
    curAction = null;
    curPlayer = null;

    if (worldGroup) {
        worldGroup.destroy(true);
        worldGroup = null;
    }

    if (playerGroup) {
        playerGroup.destroy(true);
        playerGroup = null;
    }

    if (curPlayerGroup) {
        curPlayerGroup.destroy(true);
        curPlayerGroup = null;
    }

    if (mobGroup) {
        mobGroup.destroy(true);
        mobGroup = null;
    }

    if (bombGroup) {
        bombGroup.destroy(true);
        bombGroup = null;
    }

    if (explosionGroup) {
        explosionGroup.destroy(true);
        explosionGroup = null;
    }

    if (powerupGroup) {
        powerupGroup.destroy(true);
        powerupGroup = null;
    }

    if (controlsGroup) {
        controlsGroup.destroy(true);
        controlsGroup = null;
    }

    if (shadeGroup) {
        shadeGroup.destroy(true);
        shadeGroup = null;
    }

    knownPlayers = {};
    knownMobs = {};
    playerSprites = {};
    mobSprites = {};
    controlSprites = {};
    knownBombs = {};
    bombSprites = {};
    knownExplosions = {};
    explosionEmitters = {};
    worldSprites = null;
    playerSpriteServer = null;
    leaderboardShade = null;
    scoreShade = null;
    scoreText = null;
    leaderboardNames = [];
    leaderboardScores = [];

    if (internalServerUpdater) {
        clearInterval(internalServerUpdater);
        internalServerUpdater = null;
    }

    // Destroy internal server.
    internalServer = null;
}

// The Google WebFont Loader will look for this object,
// so create it before loading the script.
var WebFontConfig = {
    //  'active' means all requested fonts have finished loading
    //  We set a 1 second delay before calling 'createText'.
    //  For some reason if we don't the browser cannot render the text the
    //  first time it's created.
    active: function() {
        game.time.events.add(Phaser.Timer.SECOND, createText, this);
    },

    //  The Google Fonts we want to load
    //  (specify as many as you like in the array).
    google: {
      families: ['Raleway']
    }
};

function preload() {
    if (GAME_DEBUG) {
        console.log("Preload()");
    }

    var prefix = IMG_PREFIX;
    game.load.spritesheet('p1', prefix + 'p1.png', 32, 32);
    game.load.spritesheet('p2', prefix + 'p2.png', 32, 32);
    game.load.spritesheet('p3', prefix + 'p3.png', 32, 32);
    game.load.spritesheet('p4', prefix + 'p4.png', 32, 32);
    game.load.spritesheet('mob1', prefix + 'mob1.png', 32, 32);
    game.load.spritesheet('tiles', prefix + 'tileset1.png', 32, 32);
    game.load.spritesheet('explode', prefix + 'explode.png', 32, 32);
    game.load.spritesheet('bombs', prefix + 'bombtiles.png', 32, 32);
    game.load.spritesheet('controls', prefix + 'controls.png', 32, 32);
    game.load.image('shade', prefix + 'shade.png');

    game.load.script('webfont',
        'http://ajax.googleapis.com/ajax/libs/webfont/1.4.7/webfont.js');
}

function create() {
    if (GAME_DEBUG) {
        console.log("create()");
    }

    if (offlineMode) {
        socket = null;

        // Let the internal server know about our simulated socket router.
        internalServer.socket_set_cb(socket_offline);
        socket_wrapper('create player', {name: playerName});
    }
    else {
        // Init socket.
        socket = io('ws://' + serverAddress);

        setupSocket(socket);
        socket.emit('create player', {name: playerName});
        sendPing();
    }

    game.time.advancedTiming = true;

    // Set up input keys.
    mykeys = game.input.keyboard.addKeys({'up': Phaser.KeyCode.UP,
                                          'down': Phaser.KeyCode.DOWN,
                                          'left': Phaser.KeyCode.LEFT,
                                          'right': Phaser.KeyCode.RIGHT,
                                          'fire': Phaser.KeyCode.SPACEBAR,
                                          'special': Phaser.KeyCode.A});
    lastAction = new Action();
    curAction = new Action();

    // Phaser groups. This is how we do Z-ordering.
    worldGroup = game.add.group();
    worldGroup.z = -100;

    bombGroup = game.add.group();
    bombGroup.z = 10;

    playerGroup = game.add.group();
    playerGroup.z = 20;

    curPlayerGroup = game.add.group();
    curPlayerGroup.z = 30;

    mobGroup = game.add.group();
    mobGroup.z = 35;

    explosionGroup = game.add.group();
    explosionGroup.z = 40;

    powerupGroup = game.add.group();
    powerupGroup.z = 50;

    shadeGroup = game.add.group();
    shadeGroup.z = 90;

    controlsGroup = game.add.group();
    controlsGroup.z = 100;

    // Init display.
    game.scale.scaleMode = Phaser.ScaleManager.SHOW_ALL;
    game.scale.fullScreenScaleMode = Phaser.ScaleManager.SHOW_ALL;
    game.scale.windowConstraints.bottom = "visual";
    game.stage.smoothed = false;
    game.stage.backgroundColor = '#000000';
    game.stage.disableVisibilityChange = true;

    if (game.device.desktop) {
        touchEnabled = false;
        iconDisplayed = true;
        document.getElementById('iconarea').style.display = 'block';
        document.getElementById('player').style.display = 'block';

        if (offlineMode) {
            document.getElementById('leaderboard').style.display = 'none';
        }
        else {
            document.getElementById('leaderboard').style.display = 'block';
        }

        game.scale.stopFullScreen();
        playerStatsDisplayed = true;
    }
    else {
        touchEnabled = true;
        game.scale.forceOrientation(true, false);
        game.scale.enterIncorrectOrientation.add(handleIncorrect);
        game.scale.leaveIncorrectOrientation.add(handleCorrect);

        iconDisplayed = false;
        document.getElementById('iconarea').style.display = 'none';
        document.getElementById('player').style.display = 'none';
        document.getElementById('leaderboard').style.display = 'none';
        playerStatsDisplayed = false;

        addTouchControls();
        leaderboardShade = null;
        scoreShade = null;
    }

    showGame();
}

function handleIncorrect() {
    if (!game.device.desktop) {
        document.getElementById('orientwarning').style.display = 'block';
    }
}

function handleCorrect() {
    if (!game.device.desktop) {
        document.getElementById('orientwarning').style.display = 'none';
    }
}


function update() {
    if (quitFlag) {
        if (offlineMode) {
            window.setTimeout(quitGame, 1);
        }

        return;
    }

    curClientMS = game.time.now;
    if (lastClientMS === 0) {
        lastClientMS = curClientMS - (1000/targetFPS);
    }

    clientElapsedMS = curClientMS - lastClientMS;

    if (!offlineMode) {
        if (lagCounter++ > 60) {
            lagCounter = 0;
            if (!pingSent) {
                sendPing();
            }
            lagCounter = 0;
        }
    }

    if (!cameraset && curPlayer && curPlayer.id in playerSprites) {
        game.camera.follow(playerSprites[curPlayer.id]);
        cameraset = true;
    }

    if (!isDead) {
        clientSidePrediction();
    }

    handleTouch();

    // Limit frame rate on client.
    if (clientElapsedMS >= minMS) {
        lastClientMS = curClientMS;
        curAction.set(0, 0, false);
        curAction.deltaTime = 1 / targetFPS;
        if (mykeys.left.isDown || touchActions['left']) {
            curAction.x -= 1;
        }
        if (mykeys.right.isDown || touchActions['right']) {
            curAction.x += 1;
        }
        if (mykeys.up.isDown || touchActions['up']) {
            curAction.y -= 1;
        }
        if (mykeys.down.isDown || touchActions['down']) {
            curAction.y += 1;
        }
        if (mykeys.fire.isDown || touchActions['bomb']) {
            if (!fireflag) {
                curAction.fire = true;

                // Force separate presses each time.
                fireflag = true;
            }
        }
        else {
            // not pressing fire.
            fireflag = false;
        }

        // Only send command to server if we're still alive.
        if (!isDead) {
            // If we're lagging badly - don't send any input :(
            // Maximum 30 frames behind.
            // This prevents the server from lagging too far behind the client.
            if (actionList.length < 30) {
                curAction.id = nextActionID++;
                socket_wrapper('player input', curAction.toJSON());
                actionList.push(curAction.toJSON());
            }
        }
    }

    if (isDead) {
        // We're dead - so do the countdown.
        if (!deadSprite) {
            if (curPlayer) {
                if (curPlayer.id in playerSprites) {
                    deadSprite = playerSprites[curPlayer.id];
                }
                else {
                    deadSprite = game.add.sprite(curPlayer.x,
                                                 curPlayer.y,
                                                 curPlayer.image,
                                                 1);
                    deadSprite.anchor.set(0.5);
                    curPlayerGroup.add(deadSprite);
                }
            }
        }

        // Grow bigger.
        if (deadSprite) {
            deadSprite.y -= 0.5;
            deadSprite.alpha -= 0.01;
            if (deadSprite.alpha <= 0) {
                deadSprite.alpha = 0;
            }
            deadSprite.scale.x *= 1.05;
            deadSprite.scale.y *= 1.05;
        }

        deadCounter--;
        if (deadCounter <= 0) {
            quitFlag = true;

        }
    }
}

function handleTouch(pointer) {
    // This is done by manually checking for touches on the various screen
    // regions because the way Phaser processes input events is horrible.
    // Phaser does not trigger touch in/out events correctly if you tap and
    // hold, and drag your finger onto another control.
    // So we have to do it manually ourselves.

    touchActions = {up: false,
                    down: false,
                    left: false,
                    right: false,
                    bomb: false
                   };
    checkPointer(game.input.pointer1);
    checkPointer(game.input.pointer2);
}

function checkPointer(pointer) {
    if (!pointer.isDown) {
        return;
    }

    var controls = ['up', 'down', 'left', 'right', 'bomb'];
    for (var i = 0; i < controls.length; i++) {
        var actionlabel = controls[i];
        var sprite = controlSprites[actionlabel];
        if (sprite && spriteContains(sprite, pointer.x, pointer.y)) {
            touchActions[actionlabel] = true;
        }
    }
}

function spriteContains(sprite, x, y) {
    var sx = sprite.x - game.camera.x;
    var sy = sprite.y - game.camera.y;

    if (x >= sx && x < (sx + sprite.width) &&
        y >= sy && y < (sy + sprite.height)) {
        return true;
    }

    return false;
}

function goFull() {
    if (touchEnabled) {
        if (!game.scale.isFullScreen) {
            game.scale.startFullScreen(false, true);
        }
        else {
            game.scale.stopFullScreen();
        }
    }
}

function showExitPopup() {
    var ep = document.getElementById('exitpopup');
    if (ep) {
        ep.style.display = 'block';
    }
}

function hideExitPopup() {
    var ep = document.getElementById('exitpopup');
    if (ep) {
        ep.style.display = 'none';
    }
}

function addTouchControls() {
    // Add controls.
    var bottom = screenY;
    var right = screenX;
    var gap = 0;
    var scale = 2.5;
    var size = 32 * scale;
    var controlsx = 10;
    var controlsy = bottom - (10 + size + gap + size + gap + size);

    // UP.
    var sprite = game.add.sprite(controlsx + size + gap, controlsy,
                                 'controls', 0);
    controlSprites['up'] = sprite;
    sprite.fixedToCamera = true;
    sprite.scale.x = scale;
    sprite.scale.y = scale;
    sprite.alpha = 0.8;
    controlsGroup.add(sprite);

    // DOWN.
    sprite = game.add.sprite(controlsx + size + gap, controlsy + size + gap +
                             size + gap , 'controls', 1);
    sprite.fixedToCamera = true;
    controlSprites['down'] = sprite;
    sprite.inputEnabled = true;
    sprite.scale.x = scale;
    sprite.scale.y = scale;
    sprite.alpha = 0.8;
    controlsGroup.add(sprite);

    // LEFT.
    sprite = game.add.sprite(controlsx, controlsy + size + gap,
                             'controls', 2);
    sprite.fixedToCamera = true;
    controlSprites['left'] = sprite;
    sprite.inputEnabled = true;
    sprite.scale.x = scale;
    sprite.scale.y = scale;
    sprite.alpha = 0.8;
    controlsGroup.add(sprite);

    // RIGHT.
    sprite = game.add.sprite(controlsx + size + gap + size + gap,
                             controlsy + size + gap, 'controls', 3);
    sprite.fixedToCamera = true;
    controlSprites['right'] = sprite;
    sprite.inputEnabled = true;
    sprite.scale.x = scale;
    sprite.scale.y = scale;
    sprite.alpha = 0.8;
    controlsGroup.add(sprite);

    // BOMB.
    sprite = game.add.sprite(right - (10 + size), bottom - (10 + size),
                             'controls', 4);
    sprite.fixedToCamera = true;
    controlSprites['bomb'] = sprite;
    sprite.inputEnabled = true;
    sprite.scale.x = scale;
    sprite.scale.y = scale;
    sprite.alpha = 0.8;
    controlsGroup.add(sprite);

    // Only show fullscreen button on Android. It doesn't work on iOS.
    // iOS supports fullscreen by saving the web shortcut to the home screen.
    if (isAndroid()) {
        // FULLSCREEN TOGGLE
        sprite = game.add.sprite(10, 10, 'controls', 5);
        sprite.fixedToCamera = true;
        controlSprites['fs'] = sprite;
        sprite.events.onInputDown.add(goFull, this);
        controlsGroup.add(sprite);
        sprite.scale.x = 2;
        sprite.scale.y = 2;
        sprite.alpha = 0.8;
        sprite.inputEnabled = true;
    }
    else if (isApple()) {
        // EXIT BUTTON.
        sprite = game.add.sprite(10, 10, 'controls', 6);
        sprite.fixedToCamera = true;
        controlSprites['exit'] = sprite;
        sprite.events.onInputDown.add(showExitPopup, this);
        controlsGroup.add(sprite);
        sprite.scale.x = 2;
        sprite.scale.y = 2;
        sprite.alpha = 0.8;
        sprite.inputEnabled = true;
    }
}

function socket_wrapper(cmd, data) {
    if (offlineMode) {
        internalServer.socket_emit(cmd, data);
    }
    else {
        socket.emit(cmd, data);
    }
}

function socket_offline(cmd, data) {
    switch(cmd) {
        case 'disconnect':
            quitGame();
            break;
        case 'spawn player':
            spawnPlayer(data);
            break;
        case 'update players':
            // This one is special because it uses multiple args.
            // We need to split them up manually here.
            updateVisiblePlayers(data.players,
                                 data.bombs,
                                 data.explosions,
                                 data.worlddata,
                                 data.stats,
                                 data.mobs);
            break;
        case 'create world':
            createWorld(data);
            break;
        case 'dead':
            playerDied(data);
            break;
        case 'powerup':
            emitPowerup(data);
            break;
        default:
            // Ignore any others.
    }
}

function setupSocket(socket) {
    socket.on('disconnect', quitGame);
    socket.on('spawn player', spawnPlayer);
    socket.on('update players', updateVisiblePlayers);
    socket.on('create world', createWorld);
    socket.on('dead', playerDied);
    socket.on('powerup', emitPowerup);
    socket.on('leaderboard', updateLeaderboard);
    socket.on('pongme', updateLag);
}

function updateLag(data) {
    if (pingSent) {
        curLag = game.time.now - data.ms;
        pingSent = false;
    }
}

function sendPing() {

    if (!pingSent) {
        var curMS = game.time.now;
        socket.emit('pingme', {ms: curMS});
        pingSent = true;
    }
}

function spawnPlayer(player) {
    if (GAME_DEBUG) {
        console.log("Spawn player");
    }

    tmpPlayer = new Player();
    tmpPlayerAction = new Action();
    curPlayer = new Player();
    curPlayer.fromJSON(player);
}

function playerDied(data) {
    var eid;

    // We died. Too bad so sad.
    isDead = true;
    deadReason = data.reason;
}

function updateStatus() {
    var status;

    if (!curPlayer) {
        return;
    }

    if (touchEnabled) {
        status = "SCORE: " + curPlayer.score;
        status += "   BOMBS: " + curPlayer.maxBombs;
        status += "   RANGE: " + curPlayer.range;
        if (curPlayer.rank && totalPlayers) {
            status += "   RANK: " + curPlayer.rank + " of " + totalPlayers;
        }

        // DEBUG: Show FPS and LAG timers.
        // status += "   FPS: " + game.time.fps;
        // status += "   LAG: " + curLag + "ms";

        if (!scoreText) {
            var text = game.add.text(310, screenY - 20, status);
            text.fixedToCamera = true;
            text.anchor.setTo(0);
            text.font = 'Raleway';
            text.fontSize = 12;
            text.fill = '#ffffff';
            text.alpha = 0.8;
            text.align='left';
            text.strokeThickness = 0;
            text.setShadow(1, 1, 'rgba(0, 0, 0, 0.5)', 0);
            controlsGroup.add(text);
            scoreText = text;
        }
        else {
            scoreText.text = status;
        }

        if (!scoreShade) {
            scoreShade = game.add.image(300, screenY - 25, 'shade');
            scoreShade.fixedToCamera = true;
            scoreShade.anchor.setTo(0);
            shadeGroup.add(scoreShade);
        }

        scoreShade.width = scoreText.width + 20;
        scoreShade.height = 20;

        return;
    }

    // Only display if the window is big enough.
    var w = Math.max(document.documentElement.clientWidth,
                     window.innerWidth || 0);
    var h = Math.max(document.documentElement.clientHeight,
                     window.innerHeight || 0);

    var threshold = 850;
    if (h < threshold && playerStatsDisplayed) {
        document.getElementById('player').style.display = 'none';
        playerStatsDisplayed = false;
    }
    else if (h > threshold && !playerStatsDisplayed) {
        document.getElementById('player').style.display = 'block';
        playerStatsDisplayed = true;
    }

    if (playerStatsDisplayed) {
        status = "<div class='heading'>" + curPlayer.name + "</div><hr />";
        status += "<table border='0' width='100%'><tr>";
        status += "<td width='50%'><b>SCORE:</b> " + curPlayer.score + "</td>";
        status += "<td><b>LOCATION:</b> "
        status += world.toMapX(curPlayer.x) + " , " + world.toMapY(curPlayer.y);
        status += "</td></tr><tr>";
        status += "<td><b>BOMBS:</b> " + curPlayer.maxBombs + "</td>";
        status += "<td>";
        if (curPlayer.rank && totalPlayers) {
            status += "<b>RANK:</b> " + curPlayer.rank + " of " + totalPlayers;
        }
        else {
            status += "&nbsp;";
        }
        status += "</td></tr><tr>";
        status += "<td colspan='2'><b>RANGE:</b> " + curPlayer.range
        status += "</td></tr>";
        status += "</table>";

        // DEBUG: Show FPS and LAG timers.
        // status += "<br /><br />FPS: " + game.time.fps;
        // status += "<br /><br />Lag: " + curLag + "ms";
        document.getElementById('player').innerHTML = status;
    }
}

function updateIcon() {
    var w = Math.max(document.documentElement.clientWidth,
                     window.innerWidth || 0);
    var h = Math.max(document.documentElement.clientHeight,
                     window.innerHeight || 0);
    var aspect = w / h;
    var minAspect = (screenX + 320) / screenY; // Allow 250 pixels for the icon.

    var threshold = 650;
    if ((h < threshold || aspect < minAspect) && iconDisplayed) {
        document.getElementById('iconarea').style.display = 'none';
        document.getElementById('leaderboard').style.top = '30px';
        document.getElementById('player').style.display = 'none';

        // Shrink font size.
        document.getElementById('leaderboard').style.fontSize = '8px';
        document.getElementById('leaderboard').style.width = '200px';

        iconDisplayed = false;
    }
    else if (h > threshold && aspect >= minAspect && !iconDisplayed) {
        document.getElementById('iconarea').style.display = 'block';
        document.getElementById('leaderboard').style.top = '300px';
        document.getElementById('leaderboard').style.width = '400px';
        document.getElementById('player').style.display = 'block';
        document.getElementById('player').style.top = '600px';
        iconDisplayed = true;
    }
}

function updateMobileLeaderboard(pList) {
    var namesText = '';
    var scoresText = '';
    var ypos;
    var color;
    var i;

    for (i = 0; i < pList.length; i++) {
        namesText += (i + 1) + ". " + pList[i].name + "\n";
        scoresText += pList[i].score + "\n";
    }

    ypos = 10;
    for (i = 0; i < pList.length; i++) {
        color = '#ffffff';
        if (curPlayer && pList[i].id === curPlayer.id) {
            color = '#ffff00';
        }
        if (!leaderboardNames[i]) {
            var text = game.add.text(screenX - 200, ypos, pList[i].name);
            text.fixedToCamera = true;
            text.anchor.setTo(0);
            text.font = 'Raleway';
            text.fontSize = 12;
            text.fill = color;
            text.alpha = 0.8;
            text.align='left';
            text.strokeThickness = 0;
            text.setShadow(1, 1, 'rgba(0, 0, 0, 0.5)', 0);

            text.scale.x = 1;
            text.scale.y = 1;
            if (text.width > 150) {
                text.width = 150;
            }
            controlsGroup.add(text);

            leaderboardNames[i] = text;
        }
        else {
            leaderboardNames[i].y = ypos;
            leaderboardNames[i].text = pList[i].name;
            leaderboardNames[i].fill = color;

            leaderboardNames[i].scale.x = 1;
            leaderboardNames[i].scale.y = 1;
            if (leaderboardNames[i].width > 150) {
                leaderboardNames[i].width = 150;
            }
        }

        if (!leaderboardScores[i]) {
            text = game.add.text(screenX - 20, ypos, pList[i].score);
            text.fixedToCamera = true;
            text.anchor.setTo(0);
            text.font = 'Raleway';
            text.fontSize = 12;
            text.fill = color;
            text.alpha = 0.8;
            text.align='left';

            text.scale.x = 1;
            text.scale.y = 1;
            if (text.width > 40) {
                text.width = 40;
            }
            text.strokeThickness = 0;
            text.setShadow(1, 1, 'rgba(0, 0, 0, 0.5)', 0);

            text.cameraOffset.x = screenX - (10 + text.width);
            controlsGroup.add(text);

            leaderboardScores[i] = text;
        }
        else {
            leaderboardScores[i].y = ypos;
            leaderboardScores[i].text = pList[i].score;
            leaderboardScores[i].fill = color;

            leaderboardScores[i].scale.x = 1;
            leaderboardScores[i].scale.y = 1;
            if (leaderboardScores[i].width > 40) {
                leaderboardScores[i].width = 40;
            }

            leaderboardScores[i].cameraOffset.x =
                screenX - (10 + leaderboardScores[i].width);
        }

        ypos += leaderboardNames[i].height;
    }

    // Delete extras.
    if (leaderboardNames.length > pList.length) {
        var extraNames = leaderboardNames.splice(pList.length);
        for (i = 0; i < extraNames.length; i++) {
            extraNames[i].destroy();
        }
    }

    if (leaderboardScores.length > pList.length) {
        var extraScores = leaderboardScores.splice(pList.length);
        for (i = 0; i < extraScores.length; i++) {
            extraScores[i].destroy();
        }
    }

    // Resize shade.
    if (!leaderboardShade) {
        leaderboardShade = game.add.image(screenX - 210, 5, 'shade');
        leaderboardShade.fixedToCamera = true;
        leaderboardShade.anchor.setTo(0);
        shadeGroup.add(leaderboardShade);
    }

    leaderboardShade.width = 205;
    leaderboardShade.height = ypos;
}

function updateLeaderboard(pList) {
    var i;

    if (touchEnabled) {
        updateMobileLeaderboard(pList);
        return;
    }

    updateIcon();

    var fontsize = '16px';

    var lb = "<div align='center' style='color:#ffff00;font-size:";
    lb += fontsize + "'>LEADERBOARD</div><hr />";
    lb += "<table border='0' style='table-layout: fixed; width: 100%'>";

    for (i = 0; i < pList.length; i++) {
        var color = '#ffffff';
        if (curPlayer && pList[i].id === curPlayer.id) {
            color = '#ffff00';
        }

        lb += "<tr>";
        lb += "<td width='90%' style='color:" + color + ";font-size:";
        lb += fontsize + ";word-wrap: break-word'>" + (i + 1) + ". ";
        lb += pList[i].name + "</td>";
        lb += "<td width='10%' align='right' style='color:" + color;
        lb += ";font-size:" + fontsize + "'>" + pList[i].score + "</td>";
        lb += "</tr>";
    }

    lb += "</table>";
    document.getElementById('leaderboard').innerHTML = lb;
}

function removePlayer(player) {
    if (GAME_DEBUG) {
        console.log("Remove player");
    }

    if (player.id in knownPlayers) {
        delete knownPlayers[player.id];
    }

    destroyPlayerSprite(player.id);
}

function destroyPlayerSprite(pid) {
    if (pid in playerSprites) {
        playerSprites[pid].kill();
        playerSprites[pid].destroy();
        delete playerSprites[pid];
    }
}

function destroyMobSprite(mid) {
    if (mid in mobSprites) {
        mobSprites[mid].kill();
        mobSprites[mid].destroy();
        delete mobSprites[mid];
    }
}

function destroyPlayerName(pid) {
    if (pid in playerNames) {
        playerNames[pid].kill();
        playerNames[pid].destroy();
        delete playerNames[pid];
    }
}

function destroyBombSprite(bid) {
    if (bid in bombSprites) {
        bombSprites[bid].kill();
        bombSprites[bid].destroy();
        delete bombSprites[bid];
    }
}

function destroyExplosion(eid) {
    if (eid in explosionEmitters) {
        explosionEmitters[eid].removeAll(true);
        explosionGroup.remove(explosionEmitters[eid], true);
        delete explosionEmitters[eid];
    }
}

function createWorld(data) {
    var t1 = Date.now();

    world.fromJSON(data);

    // Custom world using sprites.
    // NOTE: I tried using Phaser's TileMap and it was horribly slow!
    //       Also there was no easy way to update a chunk of the map without
    //       reloading the whole thing, or using putTile() which crashed
    //       the browser tab because it was so slow!
    worldSprites = [];
    for (var i = 0; i < (world.width * world.height); i++) {
        worldSprites.push(null);
    }

    // NOTE: The actual world data is populated in updateWorld().

    game.world.setBounds(0, 0, world.width * world.tilewidth,
                         world.height * world.tileheight);
}

function updateWorld(data) {
    var tx = data.tx;
    var ty = data.ty;
    var chunkwidth = data.chunkwidth;
    var chunkheight = data.chunkheight;
    var mapdata = data.data;
    var index;
    var realIndex;
    var val;
    var mx, my;
    var tile;

    // Kill sprites that are no longer visible.
    if (tx != lastTX) {
        var startx;
        var endx;
        if (tx < lastTX) {
            startx = tx + chunkwidth;
            endx = lastTX + chunkwidth;
        }
        else {
            startx = lastTX;
            endx = tx;
        }

        // Remove slice.
        for (mx = startx; mx < endx; mx++) {
            for (my = lastTY; my < lastTY + chunkheight; my++) {
                realIndex = (my * world.width) + mx;
                if (worldSprites[realIndex] != null) {
                    worldSprites[realIndex].kill();

                    // Now make it null. The group will keep track of the
                    // original object.
                    worldSprites[realIndex] = null;
                }
            }
        }
    }

    if (ty != lastTY) {
        var starty;
        var endy;
        if (ty < lastTY) {
            starty = ty + chunkheight;
            endy = lastTY + chunkheight;
        }
        else {
            starty = lastTY;
            endy = ty;
        }

        // Remove slice.
        for (my = starty; my < endy; my++) {
            realIndex = (my * world.width) + lastTX;
            for (mx = lastTX; mx < lastTX + chunkwidth; mx++) {
                if (worldSprites[realIndex] != null) {
                    worldSprites[realIndex].kill();

                    // Now make it null. The group will keep track of the
                    // original object.
                    worldSprites[realIndex] = null;
                }

                realIndex++;
            }
        }
    }

    lastTX = tx;
    lastTY = ty;


    index = 0;
    for (my = ty; my < ty + chunkheight; my++) {
        // Find the corresponding 'real' map index.
        realIndex = (my * world.width) + tx;

        for (mx = tx; mx < tx + chunkwidth; mx++) {
            val = mapdata[index++];

            // Update local world data.
            world.setcell(mx, my, val);

            // Update image.
            tile = worldSprites[realIndex];

            if (tile == null) {
                tile = worldGroup.getFirstExists(false, // not exists.
                                                 false, // don't create if null.
                                                 mx * world.tilewidth,
                                                 my * world.tileheight,
                                                 'tiles', val);

                if (tile == null) {
                    tile = game.add.image(mx * world.tilewidth,
                                          my * world.tileheight,
                                          'tiles', val);
                    tile.anchor.set(0, 0);
                    worldGroup.add(tile);
                }
                else {
                    tile.revive();
                }

                worldSprites[realIndex] = tile;
            }
            else {
                tile.frame = val;
            }

            realIndex++;
        }
    }
}

function emitPowerup(data) {
    if (!curPlayer) {
        return;
    }

    var text = game.add.text(curPlayer.x, curPlayer.y, data.text);
    text.anchor.setTo(0.5);
    text.font = 'Raleway';
    text.fontSize = 12;
    var first = data.text.charAt(0);
    if (first === '+') {
        text.fill = '#00ff00';
    }
    else if (first === '-') {
        text.fill = '#ff0000';
    }
    else {
        text.fill = '#ffffff';
    }
    text.alpha = 1.0;

    text.align='center';
    text.strokeThickness = 0;
    text.setShadow(1, 1, 'rgba(0,0,0,0.8)', 0);

    powerupGroup.add(text);
    powerupSprites.push(text);
}

function updateVisiblePlayers(players, bombs, explosions, worlddata, stats,
                              mobs) {
    var pid;
    var bid;
    var eid;
    var mid;
    var i;

    totalPlayers = stats['totalPlayers'];

    // Crude flicker counter - to easily make invincible players stand out.
    flickerCount++;
    if (flickerCount >= flickerTimeout) {
        flickerToggle = !flickerToggle;
        flickerCount = 0;
    }

    updateWorld(worlddata);

    // Blank slate.
    for (pid in knownPlayers) {
        if (knownPlayers.hasOwnProperty(pid)) {
            knownPlayers[pid].active = false;
        }
    }

    for (mid in knownMobs) {
        if (knownMobs.hasOwnProperty(mid)) {
            knownMobs[mid].active = false;
        }
    }

    for (bid in knownBombs) {
        if (knownBombs.hasOwnProperty(bid)) {
            knownBombs[bid].active = false;
        }
    }

    for (eid in knownExplosions) {
        if (knownExplosions.hasOwnProperty(eid)) {
            knownExplosions[eid].active = false;
        }
    }

    // Update all visible players.
    for (i = 0; i < players.length; i++) {
        if (!players[i].active) {
            continue;
        }

        pid = players[i].id;
        if (!(pid in knownPlayers)) {
            knownPlayers[pid] = new Player();
        }

        // Update details about this player.
        knownPlayers[pid].fromJSON(players[i]);

        if (pid in playerSprites) {
            // Update player data.
            if (curPlayer && pid === curPlayer.id) {
                curPlayer.fromJSON(players[i]);

                // NOTE: curPlayer sprite will be updated independently during
                //       update();
            }
            else {
                playerSprites[pid].x = knownPlayers[pid].x;
                playerSprites[pid].y = knownPlayers[pid].y;

                setSprite(playerSprites[pid], knownPlayers[pid].action);

                movePlayerName(knownPlayers[pid]);
            }

            // Invincibility?
            if (knownPlayers[pid].hasFlag(2) && flickerToggle) {
                playerSprites[pid].alpha = 0.1;
            }
            else {
                playerSprites[pid].alpha = 1;
            }
        }
        else {
            // Spawn new sprite for this player.
            if (!knownPlayers[pid].image) {
                // Default image.
                knownPlayers[pid].image = 'p1';
            }

            var sprite;

            if (curPlayer && pid === curPlayer.id) {
                curPlayer.fromJSON(players[i]);

                // DEBUG: Show server copy of sprite.
                //        This is very useful when debugging client-side
                //        prediction code.
                if (showGhost) {
                    playerSpriteServer =
                        game.add.sprite(knownPlayers[pid].x,
                                        knownPlayers[pid].y,
                                        knownPlayers[pid].image);
                    playerSpriteServer.anchor.set(0.5);

                    playerSpriteServer.animations.add('down', [0, 1, 2, 1]);
                    playerSpriteServer.animations.add('up', [3, 4, 5, 4]);

                    // Even though left and right are the same, we need a
                    // different label to differentiate between them.
                    playerSpriteServer.animations.add('left',
                                                      [6, 7, 9, 7, 6, 7, 8, 7]);
                    playerSpriteServer.animations.add('right',
                                                      [6, 7, 9, 7, 6, 7, 8, 7]);

                    curPlayerGroup.add(playerSpriteServer);
                }

                sprite = game.add.sprite(knownPlayers[pid].x,
                                         knownPlayers[pid].y,
                                         knownPlayers[pid].image);
                curPlayerGroup.add(sprite);

            }
            else {
                sprite = game.add.sprite(knownPlayers[pid].x,
                                         knownPlayers[pid].y,
                                         knownPlayers[pid].image);
                playerGroup.add(sprite);

                makePlayerName(knownPlayers[pid]);
            }

            sprite.anchor.set(0.5);
            sprite.animations.add('down', [0, 1, 2, 1]);
            sprite.animations.add('up', [3, 4, 5, 4]);

            // Even though left and right are the same, we need a different
            // label to differentiate between them.
            sprite.animations.add('left', [6, 7, 9, 7, 6, 7, 8, 7]);
            sprite.animations.add('right', [6, 7, 9, 7, 6, 7, 8, 7]);

            playerSprites[pid] = sprite;
        }
    }

    // Update all visible mobs.
    for (i = 0; i < mobs.length; i++) {
        if (!mobs[i].active) {
            continue;
        }

        mid = mobs[i].id;
        if (!(mid in knownMobs)) {
            knownMobs[mid] = new Mob();
        }

        // Update details about this mob.
        knownMobs[mid].fromJSON(mobs[i]);

        if (mid in mobSprites) {
            // Update mob data.
            var sprite = mobSprites[mid];

            sprite.x = knownMobs[mid].x;
            sprite.y = knownMobs[mid].y;

            // Set up sprite.
            var mobAction = mobs[i].action;
            var anim = 'updown';

            if (mobAction.x < 0) {
                anim = 'left';
                sprite.scale.x = -1;
            }
            else if (mobAction.x > 0) {
                anim = 'right';
                sprite.scale.x = 1;
            }
            else if (mobAction.y != 0) {
                anim = 'updown';
            }

            var curAnim = sprite.animations.currentAnim;
            if (!curAnim || curAnim != anim) {
                sprite.animations.play(anim, 10, true);
            }
        }
        else {
            // Spawn new sprite for this mob.
            if (!knownMobs[mid].image) {
                // Default image.
                knownMobs[mid].image = 'mob1';
            }

            var sprite = game.add.sprite(knownMobs[mid].x,
                                         knownMobs[mid].y,
                                         knownMobs[mid].image);
            mobGroup.add(sprite);

            sprite.anchor.set(0.5);
            sprite.animations.add('updown', [0, 1]);

            // Even though left and right are the same, we need a different
            // label to differentiate between them.
            sprite.animations.add('left', [2, 3]);
            sprite.animations.add('right', [2, 3]);

            mobSprites[mid] = sprite;
        }
    }

    // Update all visible bombs.
    for (i = 0; i < bombs.length; i++) {
        if (bombs[i].remaining <= 0 || !bombs[i].active) {
            continue;
        }

        bid = bombs[i].id;
        knownBombs[bid] = bombs[i];

        if (bid in bombSprites) {
            bombSprites[bid].x = bombs[i].x;
            bombSprites[bid].y = bombs[i].y;
        }
        else {
            // Spawn new sprite for this bomb.
            var bomb = game.add.image(bombs[i].x,
                                       bombs[i].y,
                                       'bombs');
            bombGroup.add(bomb);

            // Show less frames if bomb will explode quicker.
            var frames = [];
	        var secs_remaining = Math.floor(bombs[i].remaining);
            if (secs_remaining > 4) {
                secs_remaining = 4;
            }

            for (var n = 4 - secs_remaining; n < 4; n++) {
                frames.push(n);
            }

            bomb.animations.add('blow', frames);
            bomb.animations.play('blow', 1, false);
            bomb.anchor.set(0.5);
            bombSprites[bid] = bomb;
        }
    }

    // Update all visible explosions.
    for (i = 0; i < explosions.length; i++) {
        if (!explosions[i].active) {
            continue;
        }

        eid = explosions[i].id;
        knownExplosions[eid] = explosions[i];

        if (eid in explosionEmitters) {
            explosionEmitters[eid].emitX = explosions[i].x;
            explosionEmitters[eid].emitY = explosions[i].y;
        }
        else {
            // Spawn new emitter for explosion.
            var emitter = game.add.emitter(explosions[i].x,
                                           explosions[i].y,
                                           3); // Max particles.
            explosionGroup.add(emitter);

            emitter.makeParticles('explode', [0, 1, 2, 3, 4, 5]);
            emitter.gravity = 0;
            // Make these go a little bit longer.
            var ms = Math.floor(explosions[i].remaining * 1200);
            emitter.setAlpha(1, 0, ms);
            emitter.setScale(1.0, 0.5, 1.0, 0.5, ms);
            emitter.minParticleSpeed.setTo(-32,-32);
            emitter.maxParticleSpeed.setTo(32,32);
            emitter.setRotation(0, 100);
            emitter.start(true, ms, 25, 3);

            explosionEmitters[eid] = emitter;
        }
    }

    // Clean up.
    for (pid in knownPlayers) {
        if (knownPlayers.hasOwnProperty(pid)) {
            if (!curPlayer || pid != curPlayer.id) {
                if (!knownPlayers[pid].active) {
                    delete knownPlayers[pid];

                    // Also delete the sprite if one exists.
                    destroyPlayerSprite(pid);
                    destroyPlayerName(pid);
                }
            }
        }
    }

    for (mid in knownMobs) {
        if (knownMobs.hasOwnProperty(mid)) {
            if (!knownMobs[mid].active) {
                delete knownMobs[mid];

                destroyMobSprite(mid);
            }
        }
    }

    for (bid in knownBombs) {
        if (knownBombs.hasOwnProperty(bid)) {
            if (!knownBombs[bid].active) {
                delete knownBombs[bid];

                destroyBombSprite(bid);
            }
        }
    }

    for (eid in knownExplosions) {
        if (knownExplosions.hasOwnProperty(eid)) {
            if (!knownExplosions[eid].active) {
                delete knownExplosions[eid];

                destroyExplosion(eid);
            }
        }
    }

    // Update powerup sprites.
    for (i = 0; i < powerupSprites.length; i++) {
        powerupSprites[i].y -= 0.5;
        powerupSprites[i].alpha -= 0.02;
    }

    // Clean up spent powerup sprites.
    powerupSprites = powerupSprites.filter(function(f) {
        if (f.alpha < 0.1) {
            f.destroy();
            return false;
        }

        return true;
    });


    updateStatus();
}

function clientSidePrediction() {
    if (!curPlayer || !tmpPlayer) {
        return;
    }

    /*
    Client-side prediction.

    curPlayer represents the Player object last received from the server.
    playerSprites[pid] is the current and up-to-date sprite object (client).

    Replay all player inputs on top of server object to obtain current
    client object position.
    */

    var pid = curPlayer.id;

    if (!(pid in playerSprites)) {
        return;
    }

    if (showGhost) {
        playerSpriteServer.visible = true;
        playerSpriteServer.x = curPlayer.x;
        playerSpriteServer.y = curPlayer.y;
        playerSpriteServer.alpha = 0.4;
        setSprite(playerSpriteServer, curPlayer.action);
    }
    else if (playerSpriteServer) {
        playerSpriteServer.visible = 0;
    }

    // Start with last known player position from the server.
    tmpPlayer.fromJSON(curPlayer.toJSON());

    // Remove actions that have already been processed.
    actionList = actionList.filter(function(f) {
        return f.id > curPlayer.action.id;
    });

    // Replay client-side actions.
    for (var i = 0; i < actionList.length; i++) {
        tmpPlayer.action.fromJSON(actionList[i]);
        movePlayer(tmpPlayer);
    }

    playerSprites[pid].x = tmpPlayer.x;
    playerSprites[pid].y = tmpPlayer.y;

    // Play animation according to direction.
    setSprite(playerSprites[pid], tmpPlayer.action);
}

// NOTE: movePlayer() must use exactly the same logic as the server.
//       This simulates the player movements on the client in the same way
//       that the server will, in order to reduce the effects of latency.
function movePlayer(player) {
    var deltaTime = 1/targetFPS;

    // Move player.
    var mx = world.toMapX(player.x);
    var my = world.toMapY(player.y);
    var targetX = world.toScreenX(mx);
    var targetY = world.toScreenY(my);
    if (world.getcell(mx, my) === 1) {
        // ERROR: we're inside a wall - give up and wait for the server to
        //        reposition us.
        return;
    }

    // Prevent illegal moves.
    var tmpaction = {
        x: player.action.x,
        y: player.action.y,
        deltaTime: player.action.deltaTime
    };

    if (tmpaction.x != 0 &&
        !player.canPass(world.getcell(mx + tmpaction.x, my))) {
        if (tmpaction.x < 0 && player.x <= targetX) {
            tmpaction.x = 0;
            player.x = targetX;
        }
        else if (tmpaction.x > 0 && player.x >= targetX) {
            tmpaction.x = 0;
            player.x = targetX;
        }
    }
    if (tmpaction.y != 0 &&
        !player.canPass(world.getcell(mx, my + tmpaction.y))) {
        if (tmpaction.y < 0 && player.y <= targetY) {
            tmpaction.y = 0;
            player.y = targetY;
        }
        else if (tmpaction.y > 0 && player.y >= targetY) {
            tmpaction.y = 0;
            player.y = targetY;
        }
    }

    // Lock to gridlines.
    var tolerance = player.speed / targetFPS;
    if (tmpaction.x != 0) {
        if (targetY > (player.y + tolerance)) {
            tmpaction.x = 0;
            tmpaction.y = 1;
        }
        else if (targetY < (player.y - tolerance)) {
            tmpaction.x = 0;
            tmpaction.y = -1;
        }
        else {
            player.y = targetY;
            tmpaction.y = 0;
        }
    }
    else if (tmpaction.y != 0) {
        if (targetX > (player.x + tolerance)) {
            tmpaction.y = 0;
            tmpaction.x = 1;
        }
        else if (targetX < (player.x - tolerance)) {
            tmpaction.y = 0;
            tmpaction.x = -1;
        }
        else {
            player.x = targetX;
            tmpaction.x = 0;
        }
    }

    player.updateWithTempAction(tmpaction, deltaTime);
}

function setSprite(sprite, action) {
    if (action.x != 0 || action.y != 0) {
        var anim;

        if (action.x < 0) {
            anim = 'left';
            sprite.scale.x = -1;
        }
        else if (action.x > 0) {
            anim = 'right';
            sprite.scale.x = 1;
        }
        else if (action.y < 0) {
            anim = 'up';
        }
        else if (action.y > 0) {
            anim = 'down';
        }

        var curAnim = sprite.animations.currentAnim;
        if (!curAnim || curAnim != anim) {
            sprite.animations.play(anim, 10, true);
        }
    }
    else {
        sprite.animations.stop();
    }
}

function makePlayerName(player) {
    if (player.id in playerNames) {
        return false;
    }

    if (!player.name) {
        return false;
    }

    var text = game.add.text(player.x, player.y - 20, player.name);
    text.anchor.setTo(0.5);
    text.font = 'Raleway';
    text.fontSize = 12;
    text.fill = '#ffffff';
    text.alpha = 0.8;
    text.align='center';
    text.strokeThickness = 0;
    text.setShadow(1, 1, 'rgba(0,0,0,0.5)', 0);

    playerGroup.add(text);
    playerNames[player.id] = text;

    return true;
}

function movePlayerName(player) {
    if (!(player.id in playerNames)) {
        if (!makePlayerName(player)) {
            return;
        }
    }

    playerNames[player.id].x = player.x;
    playerNames[player.id].y = player.y - 20;
}
