#!/usr/bin/env nodejs
var express = require('express');
var app     = express();
var http    = require('http').Server(app);
var io      = require('socket.io')(http);
var timestamp = require('console-timestamp');
var fs      = require('fs');

/*******************************************************************************
 *
 * MY IMPORTS.
 *
 ******************************************************************************/
import Player from '../common/player';
import Mob from '../common/mob';
import Bomb from '../common/bomb';
import Explosion from '../common/explosion';
import World from '../common/world';
import GameConfig from '../common/config';


/*******************************************************************************
 *
 * MY VARS.
 *
 ******************************************************************************/

var GAME_DEBUG = false;

// usersAverage is the average high watermark updated every 5 minutes.
// usersCurrentWatermark is the high watermark for the last 5 minutes.
var usersAverage = 0;
var usersCurrentWatermark = 0;

var targetFPS = 30;
var lastMS = 0;
var curMS = 0;
var counter = 0;
var frameCount = 0;
var secondCounter = 0;
var showFPS = true;
var avgFPS = 0;
var sessionTimeout = 5 * 60 * 1000; // Timeout after 5 mins of no ping.

var playerList = [];
var bombList = [];
var explosionList = [];
var killList = [];
var rankByID = {};

var inputQueue = {};

var nextBombID = 1;
var nextExplosionID = 1;

var gameConfig = new GameConfig();

// Set map size to 100x100 tiles. Smaller maps run the risk of players
// clearing the map faster than it replenishes, and also preventing map from
// replenishing if there are players currently in every zone.
// For best gameplay and interaction between players, the map size should be
// the smallest possible size while still large enough to avoid being cleared
// too quickly.
var ww = 100;
var wh = 100;
var world = new World(ww, wh, gameConfig);
createWorld();

var mobList = [];
var mobCount = 0;
var maxMobs = Math.floor((ww * wh) * 0.002);
var mobSpawners = [];
var nextMobID = 0;
// Spawn mobs at random intervals up to every 30 seconds.
var mobTimer = Math.random() * 30;

addMobSpawners();
populateBlocks();

/*
 TILE INDEXES:
 0: Empty space.
 1: solid wall
 2: mystery block (can be exploded)
 3: bomb powerup
 4: range powerup
 5: mystery powerup
 6: mob spawner
*/

/*******************************************************************************
 *
 * socket.io setup.
 *
 ******************************************************************************/

io.on('connection', function (socket) {
    socket.on('connect', function() {
        log("Socket ID '" + this.id + "' connected");
    });

    socket.on('disconnect', disconnect);
    socket.on('create player', createNewPlayer);
    socket.on('player input', playerInput);
    socket.on('pingme', function(data) {
        curMS = data.ms;

        var player = findPlayerObj(this.id);
        if (player) {
            player.lastTime = Date.now();
        }

        socket.emit('pongme', {ms: curMS});
    });

    socket.on('get data', function(data) {
        data.users = usersAverage;
        socket.emit('server data', data);
    });
});

function disconnect() {
    // Remove from array if it exists.
    removePlayerByID(this.id);
    log("Socket ID '" + this.id + "' disconnected");
}

function log(m) {
    console.log('YYYY-MM-DD hh:mm:ss'.timestamp + " :: " + m);
}

function createNewPlayer(data) {
    var player = new Player();
    player.id = this.id;
    player.name = data.name;

    // Remove invalid chars here because the initial check is on the client so
    // cannot be trusted.
    player.name = player.name.replace(/^[^\w\s\,\.\_\:\'\!\^\*\(\)\=\-]+$/ig,
                                      '');
    player.name = player.name.substring(0, 30);

    log("Player joined >> { name: '" + player.name + "', id: " + player.id +
        "}");

    // All players start off invincible for 10 seconds.
    player.setInvincible();

    // Spawn player.
    var spawnPoint = world.getSpawnPoint();
    player.setxy((spawnPoint.x * world.tilewidth) + Math.floor(world.tilewidth / 2),
                 (spawnPoint.y * world.tilewidth) + Math.floor(world.tileheight / 2));

    var availableImages = ['p1', 'p2', 'p3', 'p4'];
    var rIndex = Math.floor(Math.random() * availableImages.length);
    player.image = availableImages[rIndex];

    player.lastTime = Date.now();
    playerList.push(player);

    // Avoid having to find bombs and range while testing.
    if (GAME_DEBUG) {
        player.range = 8;
        player.maxBombs = 8;
    }

    io.to(this.id).emit('spawn player', player.toJSON());
    io.to(this.id).emit('create world', world.toJSON());

    // Update current high watermark if necessary.
    if (playerList.length > usersCurrentWatermark) {
        usersCurrentWatermark = playerList.length;
    }
}

function playerInput(action) {
    if (!(this.id in inputQueue)) {
        inputQueue[this.id] = [];
    }

    // Prevent cheating. In case this is set on the client.
    // Currently it is hard-coded. Perhaps it could be variable later,
    // But we'd need to cap it to prevent cheating.
    action.deltaTime = 1 / targetFPS;
    inputQueue[this.id].push(action);
}

/*******************************************************************************
 *
 * MISC PLAYER UTILS.
 *
 ******************************************************************************/

function killPlayer(id) {
    removePlayerByID(id);
    if (io.sockets.sockets[id]) {
        io.sockets.sockets[id].disconnect();
    }
}

function findPlayerObj(id) {
    if (id) {
        var index = findPlayerID(id);
        if (index >= 0) {
            return playerList[index];
        }
    }

    return;
}

function findPlayerID(id) {
    for (var i = 0; i < playerList.length; i++) {
        if (playerList[i].id === id) {
            return i;
        }
    }

    return -1;
}

function removePlayerByID(id) {
    var index = findPlayerID(id);
    if (index >= 0) {
        playerList.splice(index, 1);
    }
}

function createBomb(player) {
    if (player.curBombs < player.maxBombs) {
        var mx = world.toMapX(player.x);
        var my = world.toMapY(player.y);

        if (world.getcell(mx, my) != 0) {
            return;
        }

        var bomb = new Bomb(nextBombID++, player);
        bomb.x = world.toScreenX(mx);
        bomb.y = world.toScreenY(my);
        world.setcell(mx, my, 100); // 100 = bomb ID.
        world.setBomb(mx, my, bomb);

        world.setMobCell(mx, my, bomb.ts);
        updateBombPath(bomb);

        bombList.push(bomb);
        player.curBombs++;
    }
}

// Let smart mobs know there's a bomb in this vicinity.
function updateBombPath(bomb) {
    var mx = world.toMapX(bomb.x);
    var my = world.toMapY(bomb.y);

    var cx = mx;
    var cy = my;
    var i;
    var cell;
    var ts = bomb.ts;

    // UP
    for (i = 0; i < bomb.range; i++) {
        cy -= 1;

        cell = world.getcell(cx, cy);
        if (cell === 1 || cell === 2 || cell === 100) {
            break;
        }

        world.setMobCell(cx, cy, ts);
    }
    cy = my;

    // DOWN
    for (i = 0; i < bomb.range; i++) {
        cy += 1;

        cell = world.getcell(cx, cy);
        if (cell === 1 || cell === 2 || cell === 100) {
            break;
        }

        world.setMobCell(cx, cy, ts);
    }
    cy = my;

    // LEFT
    for (i = 0; i < bomb.range; i++) {
        cx -= 1;

        cell = world.getcell(cx, cy);
        if (cell === 1 || cell === 2 || cell === 100) {
            break;
        }

        world.setMobCell(cx, cy, ts);
    }
    cx = mx;

    // RIGHT
    for (i = 0; i < bomb.range; i++) {
        cx += 1;

        cell = world.getcell(cx, cy);
        if (cell === 1 || cell === 2 || cell === 100) {
            break;
        }

        world.setMobCell(cx, cy, ts);
    }
}

function explodeBomb(bomb) {
    var mx = world.toMapX(bomb.x);
    var my = world.toMapY(bomb.y);

    if (world.getcell(mx, my) === 100) {
        world.setcell(mx, my, 0);
        world.clearInternalCell(mx, my);
    }
    else {
        log("ERROR: bomb exploded but no bomb in map!?");
    }

    // Create explosions.
    var cx = mx;
    var cy = my;
    createExplosion(bomb, cx, cy);

    // UP
    for (var i = 0; i < bomb.range; i++) {
        cy -= 1;

        if (!processExplosion(bomb, cx, cy)) {
            break;
        }
    }
    cy = my;

    // DOWN
    for (var i = 0; i < bomb.range; i++) {
        cy += 1;

        if (!processExplosion(bomb, cx, cy)) {
            break;
        }
    }
    cy = my;

    // LEFT
    for (var i = 0; i < bomb.range; i++) {
        cx -= 1;

        if (!processExplosion(bomb, cx, cy)) {
            break;
        }
    }
    cx = mx;

    // RIGHT
    for (var i = 0; i < bomb.range; i++) {
        cx += 1;

        if (!processExplosion(bomb, cx, cy)) {
            break;
        }
    }

    bomb.active = false;

    // Now remove the bomb from this player.
    var player = findPlayerObj(bomb.pid);
    if (player) {
        player.curBombs -= 1;
        if (player.curBombs < 0) {
            log("ERROR: player has -1 bombs!");
            player.curBombs = 0;
        }
    }
}

function processExplosion(bomb, cx, cy) {
    var cell = world.getcell(cx, cy);

    if (cell === 1) {
        return false;
    }
    else if (cell === 100) {
        var testbomb = world.getBomb(cx, cy);
        if (testbomb != null) {
            testbomb.remaining = 0;
            explodeBomb(testbomb);

            // We're done here.
            return false;
        }
        else {
            log("OOPS - we thought there was a bomb here, but it's gone.");
            world.setcell(cx, cy, 0);
        }
    }

    createExplosion(bomb, cx, cy);

    if (cell === 2) {
        // Destroy block and return false.
        var item = 0;

        var r = Math.random();
        if (r > 0.9) { // 10% chance.
            // Bomb
            item = 3;
        }
        else if (r > 0.8) { // 10% chance.
            // Range
            item = 4;
        }
        else if (r > 0.5) { // 30% chance.
            // Mystery item. Contents are determined at random when
            // player picks it up.
            item = 5;
        }

        if (item > 0) {
            world.setcell(cx, cy, item);
        }
        else {
            // Track how many blocks are left in this zone.
            delBlockAt(cx, cy);
        }

        return false;
    }
    else if (cell >= 3 && cell <= 5) {
        // Blow up item...
        delBlockAt(cx, cy);
    }
    // NOTE: cannot blow up item 6 (mob spawner).

    return true;
}

function createExplosion(bomb, mx, my) {
    var explosion = new Explosion(nextExplosionID++, bomb,
                                  world.toScreenX(mx),
                                  world.toScreenY(my));
    world.setExplosion(mx, my, explosion);
    explosionList.push(explosion);
}

// NOTE: this explosion is visual only and uses screen coords.
// This is used when players touch either a mob or mob spawner.
// For bomb explosions - use the above one.
function createSingleExplosion(x, y) {
    var explosion = new Explosion(nextExplosionID++, null, x, y);
    explosionList.push(explosion);
}

function removeExplosion(explosion) {
    var mx = world.toMapX(explosion.x);
    var my = world.toMapY(explosion.y);
    world.clearInternalCell(mx, my);

    // Also let mobs know it's potentially "safe" here now.
    // Note that we use a timestamp because another newer bomb may overlap the
    // same cell which would mean this cell is not yet completely safe.
    var ts = world.getMobCell(mx, my);
    if (!ts || ts <= explosion.ts) {
        world.clearMobCell(mx, my);
    }
}

function playerGotItem(player, item) {
    // Return true if player picked up the item, otherwise false.

    if (item === 3) { // Bomb.
        player.maxBombs += 1;
        sendPowerup(player.id, '+B');
        return true;
    }
    else if (item === 4) { // Range.
        player.range += 1;
        sendPowerup(player.id, '+R');
        return true;
    }
    else if (item === 5) { // Mystery.
        var r = Math.floor(Math.random() * 10);

        var powerupName;

        // Choose between permanent or temporary effects.
        switch(r) {
            case 0:
                if (player.maxBombs < 6) {
                    player.maxBombs += 1;
                    powerupName = '+B';
                    break;
                }
            case 1:
                if (player.maxBombs > 1) {
                    player.maxBombs -= 1;
                    powerupName = '-B';
                    break;
                }
            case 2:
                if (player.range < 8) {
                    player.range += 1;
                    powerupName = '+R';
                    break;
                }
            case 3:
                if (player.range > 1) {
                    player.range -= 1;
                    powerupName = '-R';
                    break;
                }
            case 4:
                // Walk through bombs toggle.
                if (!player.hasFlag(1)) {
                    player.addFlag(1);
                    powerupName = '+TB';
                }
                else {
                    player.delFlag(1);
                    powerupName = '-TB';
                }
                break;
            case 5:
                // Increase bomb explode time.
                if (player.bombTime < 4) {
                    player.bombTime++;
                    powerupName = 'SB';
                    break;
                }
            case 6:
                // Decrease bomb explode time.
                if (player.bombTime > 2) {
                    player.bombTime--;
                    powerupName = 'FB';
                    break;
                }
            case 7:
                if (player.score > 100) {
                    // Decrease score by up to 100 points.
                    var pwrup = (Math.floor(Math.random() * 9) + 1) * 10;
                    player.score -= pwrup;
                    powerupName = '-$';
                    break;
                }
            case 8:
                // Increase score by up to 100 points.
                var pwrup = (Math.floor(Math.random() * 9) + 1) * 10;
                player.score += pwrup;
                powerupName = '+$';
                break;
            default:
                // Temporary effect.
                powerupName = player.addRandomEffect();
        }

        if (powerupName) {
            sendPowerup(player.id, powerupName);
        }

        return true;
    }
    else if (item === 6) { // mob spawner
        // Player is now officially dead. handled in movePlayer() instead.
        return false;
    }

    return false;
}

function sendPowerup(pid, text) {
    io.to(pid).emit('powerup', { text: text });
}

function addBlocks() {
    // Add blocks to one zone that is empty of players.
    replenishOneZone();
}

/*******************************************************************************
 *
 * World functions - moved here because world.js is public and I want to
 * hide this code on the server end.
 *
 ******************************************************************************/

function createWorld() {
    var i;

    // NOTE: Width and height must be odd numbers.
    if (world.width % 2 === 0) {
        world.width += 1;
    }

    if (world.height % 2 === 0) {
        world.height += 1;
    }

    // Blank the world.
    world.data = [];
    world.dataInternal = [];
    for (i = 0; i < world.width * world.height; i++) {
        world.data[i] = 0;
        world.dataInternal[i] = 0;
    }

    // Create walls.
    for (i = 0; i < world.width; i++) {
        world.setcell(i, 0, 1);
        world.setcell(i, world.height - 1, 1);
    }

    for (var my = 0; my < world.height; my ++) {
        world.setcell(0, my, 1);
        world.setcell(world.width - 1, my, 1);

        if ((my > 0) && (my < (world.height - 2)) && (my % 2 === 0)) {
            for (var mx = 2; mx < world.width; mx += 2) {
                world.setcell(mx, my, 1);
            }
        }
    }

    // Create zone array.
    for (i = 0; i < world.zonesAcross * world.zonesDown; i++) {
        world.blocksPerZone[i] = 0;
        world.zoneQuota[i] = 0;
    }

    clearPlayerZones();
}

function populateBlocks() {
    for (var zoney = 0; zoney < world.zonesDown; zoney++) {
        for (var zonex = 0; zonex < world.zonesAcross; zonex++) {
            // Calculate quota.
            var effectiveZoneWidth = getEffectiveZoneWidth(zonex);
            var effectiveZoneHeight = getEffectiveZoneHeight(zoney);

            var quota = Math.floor((effectiveZoneWidth * effectiveZoneHeight) *
                                   0.2);
            var zoneIndex = world.getZoneIndex(zonex, zoney);
            world.zoneQuota[zoneIndex] = quota;

            // Add blocks to this zone, up to the quota.
            replenishZone(zonex, zoney);
        }
    }
}

function addMobSpawners() {
    mobSpawners = [];
    var numx = 2;
    var numy = 2;
    for (var py = 0; py < numy; py++) {
        for (var px = 0; px < numx; px++) {
            var mx = Math.floor(((world.width / numx) * px) +
                                ((world.width / numx) / 2));
            var my = Math.floor(((world.height / numy) * py) +
                                ((world.height / numy) / 2));

            var blank = world.findNearestBlank(mx, my);
            if (blank.x === 1 && blank.y === 1) {
                // Try a random location.
                var bx = Math.floor(Math.random() * (world.width - 2)) + 1;
                var by = Math.floor(Math.random() * (world.height- 2)) + 1;

                blank = world.findNearestBlank(bx, by);

                if (blank.x === 1 && blank.y === 1) {
                    // Give up :(
                    // Note that mob spawners are added prior to mystery
                    // blocks, so this should never happen.
                    log("Unable to add mob spawner!");
                    continue;
                }
            }

            // Add mob spawner.
            var spawner = {x: blank.x, y: blank.y };
            mobSpawners.push(spawner);
            world.setcell(spawner.x, spawner.y, 6);
        }
    }
}

function replenishZone(zonex, zoney, count) {
    var effectiveZoneWidth = getEffectiveZoneWidth(zonex);
    var effectiveZoneHeight = getEffectiveZoneHeight(zoney);
    var zoneIndex = world.getZoneIndex(zonex, zoney);
    var quota = world.zoneQuota[zoneIndex];

    var zoneLeft = zonex * world.zonewidth;
    var zoneTop = zoney * world.zoneheight;

    // Exclude top row and left side.
    if (zoneLeft === 0) {
        zoneLeft = 1;
        effectiveZoneWidth--;
    }

    if (zoneTop === 0) {
        zoneTop = 1;
        effectiveZoneHeight--;
    }

    var blocksAdded = 0;

    while (world.blocksPerZone[zoneIndex] < quota) {
        var bx = Math.floor(Math.random() * effectiveZoneWidth) + zoneLeft;
        var by = Math.floor(Math.random() * effectiveZoneHeight) + zoneTop;

        var blank = world.findNearestBlank(bx, by);

        // Avoid top left corner - it's the safe space for spawning
        // players if no blank spaces were found.
        if (blank.x != 1 || blank.y != 1) {
            // Mystery block. Make sure no mobs or players nearby.
            if (!isNearbyPlayers(blank.x, blank.y) &&
                !isNearbyMobs(blank.x, blank.y) &&
                !isNearbyMobSpawner(blank.x, blank.y)) {
                addBlockAt(blank.x, blank.y);
                blocksAdded++;
            }
        }

        if (count && blocksAdded >= count) {
            break;
        }
    }
}

function isNearbyPlayers(mx, my) {
    return getNumNearbyPlayers(mx, my, true);
}

function getNumNearbyPlayers(mx, my, stopAtOne) {
    var sx = world.toScreenX(mx);
    var sy = world.toScreenY(my);

    var num = 0;
    var xrange = 4 * world.tilewidth;
    var yrange = 4 * world.tileheight;
    for (var i = 0; i < playerList.length; i++) {
        var player = playerList[i];
        if (player.x > (sx - xrange) && player.x < (sx + xrange) &&
            player.y > (sy - yrange) && player.y < (sy + yrange)) {
            num++;

            if (stopAtOne) {
                return 1;
            }
        }
    }

    return num;
}

function isNearbyMobs(mx, my) {
    return getNumNearbyMobs(mx, my, true);
}

function getNumNearbyMobs(mx, my, stopAtOne) {
    var sx = world.toScreenX(mx);
    var sy = world.toScreenY(my);

    var num = 0;
    var xrange = 3 * world.tilewidth;
    var yrange = 3 * world.tileheight;
    for (var i = 0; i < mobList.length; i++) {
        var mob = mobList[i];
        if (mob.x > (sx - xrange) && mob.x < (sx + xrange) &&
            mob.y > (sy - yrange) && mob.y < (sy + yrange)) {
            num++;

            if (stopAtOne) {
                return 1;
            }
        }
    }

    return num;
}

function isNearbyMobSpawner(mx, my) {
    var range = 3;
    for (var i = 0; i < mobSpawners.length; i++) {
        var ms = mobSpawners[i];
        if (ms.x > (mx - range) && ms.x < (mx + range) &&
            ms.y > (my - range) && ms.y < (my + range)) {
            return true;
        }
    }

    return false;
}

function replenishOneZone() {
    // This is called once a minute, to add blocks to a zone with no players in
    // it, and the fewest blocks (relative to the quota for that zone).
    var i;
    var emptyZones = [];
    for (i = 0; i < world.playersPerZone.length; i++) {
        var quota = world.zoneQuota[i];
        if (world.playersPerZone[i] === 0 &&
            world.blocksPerZone[i] < quota) {
            emptyZones.push({ index: i,
                              shortfall: quota - world.blocksPerZone[i] });
        }
    }

    if (emptyZones.length > 0) {
        emptyZones.sort(function(a, b) {
            return b.shortfall - a.shortfall;
        });

        var zoneIndex = emptyZones[0].index;
        var shortfall = emptyZones[0].shortfall;

        var zoney = Math.floor(zoneIndex / world.zonesAcross);
        var zonex = zoneIndex % world.zonesAcross;
        replenishZone(zonex, zoney, Math.floor(shortfall / 3) + 1);
    }
}

function getEffectiveZoneWidth(zonex) {
    var zoneLeft = zonex * world.zonewidth;
    if (world.width - zoneLeft <= world.zonewidth) {
        // NOTE: right hand side is excluded.
        return (world.width - zoneLeft) - 1;
    }

    return world.zonewidth;
}

function getEffectiveZoneHeight(zoney) {
    var zoneTop = zoney * world.zoneheight;
    if (world.height - zoneTop <= world.zoneheight) {
        // NOTE: bottom is excluded.
        return (world.height - zoneTop) - 1;
    }

    return world.zoneheight;
}

function addBlockAt(x, y) {
    world.setcell(x, y, 2);
    var zoneIndex = world.mapToZoneIndex(x, y);
    world.blocksPerZone[zoneIndex]++;
}

function delBlockAt(x, y) {
    world.setcell(x, y, 0);
    var zoneIndex = world.mapToZoneIndex(x, y);
    world.blocksPerZone[zoneIndex]--;
    if (world.blocksPerZone[zoneIndex] < 0) {
        world.blocksPerZone[zoneIndex] = 0;
    }
}

function clearPlayerZones() {
    world.playersPerZone = [];
    for (var i = 0; i < world.zonesAcross * world.zonesDown; i++) {
        world.playersPerZone[i] = 0;
    }
}

function addPlayerAt(mx, my) {
    world.playersPerZone[world.mapToZoneIndex(mx, my)]++;
}

/*******************************************************************************
 *
 * MOBS (MONSTERS)
 *
 ******************************************************************************/

function spawnMob() {
    var shuffledSpawners = shuffleCopy(mobSpawners);
    var i;

    for (i = 0; i < shuffledSpawners.length; i++) {
        var spawner = shuffledSpawners[i];
        if (!isNearbyMob(spawner.x, spawner.y, 3)) {
            // Yay, spawn new mob here.
            var sx = world.toScreenX(spawner.x);
            var sy = world.toScreenY(spawner.y);

            var mob = new Mob();
            mob.id = nextMobID++;
            mob.x = sx;
            mob.y = sy;
            chooseNewTarget(mob);
            mobList.push(mob);
            break;
        }
    }
}

// This will return a shuffled copy, not shuffle in place.
function shuffleCopy(array) {
    var i, j, temp;

    var arrayCopy = array.concat();
    for (i = arrayCopy.length - 1; i > 0; i--) {
        j = Math.floor(Math.random() * (i + 1))
        temp = arrayCopy[i]
        arrayCopy[i] = arrayCopy[j]
        arrayCopy[j] = temp
    }

    return arrayCopy;
}

function isNearbyMob(mx, my, range) {
    for (var i = 0; i < mobList.length; i++) {
        var mobmx = world.toMapX(mobList[i].x);
        var mobmy = world.toMapY(mobList[i].y);

        if (mobmx > (mx - range) && mobmx < (mx + range) &&
            mobmy > (my - range) && mobmy < (my + range)) {
            return true;
        }
    }

    return false;
}

function updateMobs(deltaTime) {
    for (var i = 0; i < mobList.length; i++) {
        getActionForMob(mobList[i], deltaTime);
        moveMob(mobList[i], deltaTime);
    }

    // Clean up up dead mobs.
    mobList = mobList.filter(function(f) {
        return f.active;
    });

    // Spawn new mob?
    mobTimer -= deltaTime;
    if (mobTimer <= 0) {
        mobTimer = Math.random() * 30;

        if (mobList.length < maxMobs) {
            spawnMob();
        }
    }
}

function addPossibleMoves(element, openList, closedList, mob) {
    var mx = element.mx;
    var my = element.my;
    var travelled = element.travelled + 1;
    var actions = [[0, -1], [1, 0], [0, 1], [-1, 0]];
    var added = false;

    for (var i = 0; i < actions.length; i++) {
        var xaction = actions[i][0];
        var yaction = actions[i][1];

        var cx = mx + xaction;
        var cy = my + yaction;

        var found = false;
        for (var ci = 0; ci < closedList.length; ci++) {
            if (closedList[ci].mx === cx && closedList[ci].my === cy) {
                found = true;
                break;
            }
        }

        if (found) {
            continue;
        }

        if (mobCanPass(mob, cx, cy)) {
            var origax = element.actionx;
            var origay = element.actiony;
            if (element.first) {
                origax = xaction;
                origay = yaction;
            }

            openList.push({mx: cx,
                           my: cy,
                           travelled: travelled,
                           actionx: origax,
                           actiony: origay,
                           done: false});
            added = true;
        }
    }

    return added;
}

// A* algorithm.
function pathFind(mx, my, targetmx, targetmy, maxdist, mob) {
    if (mx === targetmx && my === targetmy) {
        return;
    }

    var openList = [];
    var closedList = [{mx: mx, my: my}];
    var best = {x: 0, y: 0};

    var initial = {mx: mx, my: my, travelled: 0, first: true};
    addPossibleMoves(initial, openList, closedList, mob);

    while (openList.length) {
        // Sort the list - the compare function uses only the tile distance
        // to target.
        openList.sort(function(a, b) {
            var dxa = targetmx > a.mx ? targetmx - a.mx : a.mx - targetmx;
            var dya = targetmy > a.my ? targetmy - a.my : a.my - targetmy;

            var dxb = targetmx > b.mx ? targetmx - b.mx : b.mx - targetmx;
            var dyb = targetmy > b.my ? targetmy - b.my : b.my - targetmy;

            var dista = dxa + dya;
            var distb = dxb + dyb;

            return dista - distb;
        });

        var element = openList[0];
        best = {x: element.actionx, y: element.actiony };

        var processed = 0;
        for (var i = 0; i < openList.length; i++) {
            // Are we there yet?
            element = openList[i];
            if (element.mx === targetmx && element.my === targetmy) {
                return { x: element.actionx, y: element.actiony };
            }

            // Add to closed list.
            closedList.push(element);

            processed = i;

            // If we've travelled too far, ignore it.
            if (element.travelled < maxdist) {
                // Process this one.
                if (addPossibleMoves(element, openList, closedList, mob)) {
                    // We added a move. sort the list again before going
                    // further.
                    break;
                }
            }
        }

        openList.splice(0, processed + 1);
    }

    // NOTE: can't get there.

    return;
}

function pathFindNearestSafeSpace(mx, my, maxdist, mob) {
    var ts = world.getMobCell(mx, my);
    if (!ts) {
        return {x: mx, y: my};
    }

    var openList = [];
    var closedList = [{mx: mx, my: my}];
    var safestTS = ts;
    var best = {x: mx, y: my};

    var initial = {mx: mx, my: my, travelled: 0, first: true};
    addPossibleMoves(initial, openList, closedList, mob);

    while (openList.length) {
        // Sort the list - this one just tries to find the shortest distance
        // to get the nearest safe space.
        openList.sort(function(a, b) {
            return a.travelled - b.travelled;
        });

        var element;

        var processed = 0;
        for (var i = 0; i < openList.length; i++) {
            // Are we there yet?
            element = openList[i];

            ts = world.getMobCell(element.mx, element.my);
            if (!ts) {
                // Can't do any better than this. Return now.
                return {x: element.mx, y: element.my};
            }
            else if (ts > safestTS) {
                safestTS = ts;
                best = {x: element.mx, y: element.my };
            }

            // Add to closed list.
            closedList.push(element);

            processed = i;

            // If we've travelled too far, ignore it.
            if (element.travelled < maxdist) {
                // Process this one.
                if (addPossibleMoves(element, openList, closedList, mob)) {
                    // We added a move. sort the list again before going
                    // further.
                    break;
                }
            }
        }

        openList.splice(0, processed + 1);
    }

    return best;
}

function chooseNewTarget(mob) {
    var mx = world.toMapX(mob.x);
    var my = world.toMapY(mob.y);

    if (mob.danger) {
        mob.targetMode = 6; // Get the hell out!
    }
    else {
        var curTargetMode = mob.targetMode;
        while (mob.targetMode == curTargetMode) {
            mob.targetMode = Math.floor(Math.random() * 6);
        }
    }
    switch(mob.targetMode) {
        case 0:
            mob.targetRemaining = (Math.random() * 20) + 5;
            var rx = mx + Math.floor((Math.random() * (mob.range * 2)) -
                                     mob.range);
            var ry = my + Math.floor((Math.random() * (mob.range * 2)) -
                                     mob.range);
            var blank = world.findNearestBlank(rx, ry);
            if (blank.x != 1 || blank.y != 1) {
                mob.targetmx = blank.x;
                mob.targetmy = blank.y;
                break;
            }
        case 1:
            // Find nearby player. Chase for up to 60 seconds.
            mob.targetRemaining = (Math.random() * 50) + 10;
            var xrange = world.tilewidth * mob.range;
            var yrange = world.tileheight * mob.range;

            for (var i = 0; i < playerList.length; i++) {
                var player = playerList[i];
                if (player.x > (mob.x - xrange) &&
                    player.x < (mob.x + xrange) &&
                    player.y > (mob.y - yrange) &&
                    player.y < (mob.y + yrange)) {
                    // chase this player.
                    mob.targetPlayer = player;
                    break;
                }
            }
        case 2:
        case 3:
            // Continue up to 10 seconds.
            mob.targetRemaining = (Math.random() * 5) + 1;
            break;
        case 4:
        case 5:
            mob.oldmx = mx;
            mob.oldmy = my;
            // Continue up to 10 seconds.
            mob.targetRemaining = (Math.random() * 5) + 1;
            break;
        case 6:
            // This one will persist until we're "safe" again.
            mob.targetRemaining = 99999;

            var safest = pathFindNearestSafeSpace(mx, my, 3, mob);
            if (safest) {
                mob.targetmx = safest.x;
                mob.targetmy = safest.y;
            }
        default:
            break;
    }
}

function getActionForDir(dir) {
    var action = {x: 0, y: 0 };

    if (dir > 3) {
        dir -= 4;
    }
    else if (dir < 0) {
        dir += 4;
    }

    switch(dir) {
        case 0:
            action = {x: 0, y: -1};
            break;
        case 1:
            action = {x: 1, y: 0};
            break;
        case 2:
            action = {x: 0, y: 1};
            break;
        case 3:
            action = {x: -1, y: 0};
            break;
    }

    return action;
}

function getActionForMob(mob, deltaTime) {
    // 0: pick a nearby spot and try to reach it.
    // 1: pick a nearby player and try to follow them.
    // 2: always try moves in clockwise direction, starting with current dir
    // 3: always try moves in counter-clockwise direction, starting with current
    // dir

    var mx = world.toMapX(mob.x);
    var my = world.toMapY(mob.y);
    var action = mob.action;
    action.clear();

    var newTarget = false;
    var dirAction = 0;
    var opportunistic = false;

    switch(mob.targetMode) {
        case 0:
            if (mx === mob.targetmx && my === mob.targetmy) {
                // We're there - choose a new one.
                newTarget = true;
            }
            else {
                var best = pathFind(mx, my, mob.targetmx, mob.targetmy, mob.range * 2, mob);
                if (best) {
                    action.x = best.x;
                    action.y = best.y;
                }
                else {
                    newTarget = true;
                }
            }

            break;
        case 1:
            if (!mob.targetPlayer || !mob.targetPlayer.active) {
                // Player is gone. Move on already.
                newTarget = true;
            }
            else {
                var player = mob.targetPlayer;
                var px = world.toMapX(player.x);
                var py = world.toMapY(player.y);

                if (mx === px && my === py) {
                    // So close - use actual x/y coords now.
                    if (mob.x > player.x) {
                        action.x = -1;
                    }
                    else if (mob.x < player.x) {
                        action.x = 1;
                    }
                    if (mob.y > player.y) {
                        action.y = -1;
                    }
                    else if (mob.y < player.y) {
                        action.y = 1;
                    }
                }
                else {

                    var best = pathFind(mx, my, px, py, mob.range * 2, mob);
                    if (best) {
                        action.x = best.x;
                        action.y = best.y;
                    }
                    else {
                        // Out of range :(
                        newTarget = true;
                    }
                }
            }
            break;
        case 2:
            dirAction = 1;
            break;
        case 3:
            dirAction = -1;
            break;
        case 4:
            dirAction = 1;
            opportunistic = true;
            break;
        case 5:
            dirAction = -1;
            opportunistic = true;
            break;
        case 6: // DANGER AVOIDANCE
            // Find nearest safe space and go there.
            // If the target is no longer safe, we need a new one.
            var ts = world.getMobCell(mob.targetmx, mob.targetmy)
            if (ts) {
                // Still not safe - get a new target.
                var safest = pathFindNearestSafeSpace(mx, my, 3, mob);
                if (safest) {
                    mob.targetmx = safest.x;
                    mob.targetmy = safest.y;
                }
            }

            // Go there.
            var best = pathFind(mx, my, mob.targetmx, mob.targetmy,
                                mob.range * 2, mob);
            if (best) {
                action.x = best.x;
                action.y = best.y;
            }
            // We have no other option here.

            break;
        default:
            break;
    }

    if (dirAction) {
        var done = false;
        if (opportunistic && (mx != mob.oldmx || my != mob.oldmy)) {
            var da = getActionForDir(mob.targetDir + dirAction);
            if (mobCanPass(mob, mx + da.x, my + da.y)) {
                mob.targetDir += dirAction;
                done = true;
                mob.oldmx = mx;
                mob.oldmy = my;
            }
        }

        if (!done) {
            var halfth = Math.floor(world.tileheight / 2) - 1;
            var halftw = Math.floor(world.tilewidth / 2) - 1;

            var cx = mx;
            var cy = my;
            switch(mob.targetDir) {
                case 0:
                    cy = world.toMapY(mob.y + halfth) - 1;
                    break;
                case 1:
                    cx = world.toMapX(mob.x - halftw) + 1;
                    break;
                case 2:
                    cy = world.toMapY(mob.y - halfth) + 1;
                    break;
                case 3:
                    cx = world.toMapX(mob.x + halftw) - 1;
                    break;
                default:
                    break;
            }

            if (mobCanPass(mob, cx, cy)) {
                var da = getActionForDir(mob.targetDir);
                action.x = da.x;
                action.y = da.y;
            }
            else {
                mob.targetDir += dirAction;
            }
        }

        if (mob.targetDir > 3) {
            mob.targetDir -= 4;
        }
        else if (mob.targetDir < 0) {
            mob.targetDir += 4;
        }
    }

    // And now for something (completely) different?
    mob.targetRemaining -= deltaTime;
    if (mob.targetRemaining <= 0) {
        newTarget = true;
    }

    if (newTarget) {
        chooseNewTarget(mob);
    }
}

function mobCanPass(mob, mx, my) {
    var canPass = mob.canPass(world.getcell(mx, my));

    if (!mob.smart) {
        return canPass;
    }

    if (canPass && !mob.danger) {
        if (world.getMobCell(mx, my)) {
            // Dangerous - don't go there.
            return false;
        }
    }

    return canPass;
}

function dangerModeEnable(mob) {
    mob.danger = true;
    if (mob.targetMode != 6) {
        chooseNewTarget(mob);
    }
}

function dangerModeDisable(mob) {
    mob.danger = false;
    if (mob.targetMode === 6) {
        chooseNewTarget(mob);
    }
}

function moveMob(mob, deltaTime) {
    var mx, my;
    var targetX, targetY;

    if (!mob.active) {
        return;
    }

    // Move mob.
    mx = world.toMapX(mob.x);
    my = world.toMapY(mob.y);
    targetX = world.toScreenX(mx);
    targetY = world.toScreenY(my);
    if (world.getcell(mx, my) === 1) {
        // ERROR: we're inside a wall - reposition mob to nearby blank space.
        var nb = world.findNearestBlank(mx, my);
        mob.x = world.toScreenX(nb.x);
        mob.y = world.toScreenY(nb.y);
    }

    // If we're in danger, do something about it!
    if (mob.smart && world.getMobCell(mx, my)) {
        dangerModeEnable(mob);
    }
    else {
        dangerModeDisable(mob);
    }

    // Prevent illegal moves.
    var tmpaction = {
        x: mob.action.x,
        y: mob.action.y,
        deltaTime: 1 / targetFPS
    };

    if (tmpaction.x != 0 &&
        !mobCanPass(mob, mx + tmpaction.x, my)) {
        if (tmpaction.x < 0 && mob.x <= targetX) {
            tmpaction.x = 0;
            mob.x = targetX;
        }
        else if (tmpaction.x > 0 && mob.x >= targetX) {
            tmpaction.x = 0;
            mob.x = targetX;
        }
    }
    if (tmpaction.y != 0 &&
        !mobCanPass(mob, mx, my + tmpaction.y)) {
        if (tmpaction.y < 0 && mob.y <= targetY) {
            tmpaction.y = 0;
            mob.y = targetY;
        }
        else if (tmpaction.y > 0 && mob.y >= targetY) {
            tmpaction.y = 0;
            mob.y = targetY;
        }
    }

    // Lock to gridlines.
    var tolerance = mob.speed / targetFPS;
    if (tmpaction.x != 0) {
        if (targetY > (mob.y + tolerance)) {
            tmpaction.x = 0;
            tmpaction.y = 1;
        }
        else if (targetY < (mob.y - tolerance)) {
            tmpaction.x = 0;
            tmpaction.y = -1;
        }
        else {
            mob.y = targetY;
            tmpaction.y = 0;
        }
    }
    else if (tmpaction.y != 0) {
        if (targetX > (mob.x + tolerance)) {
            tmpaction.y = 0;
            tmpaction.x = 1;
        }
        else if (targetX < (mob.x - tolerance)) {
            tmpaction.y = 0;
            tmpaction.x = -1;
        }
        else {
            mob.x = targetX;
            tmpaction.x = 0;
        }
    }

    mob.updateWithTempAction(tmpaction, deltaTime);

    // Check if mob is killed.
    var exp = world.getExplosion(mx, my);
    if (exp != null && exp.harmful) {
        var reason = '';

        // Award points to the player that killed them.
        var winPlayer = findPlayerObj(exp.pid);
        if (winPlayer) {
            if (mob.smart) {
                // These are REALLY tough to kill.
                winPlayer.score += 2000;
            }
            else {
                winPlayer.score += 500;
            }
        }
        // Else player has already died too.

        // Die!
        mob.active = false;
    }
}


/*******************************************************************************
 *
 * MAIN GAME LOOP.
 *
 ******************************************************************************/

function gameLoop() {
    var deltaTime = 1 / targetFPS;
    var i;
    var mx, my, tx, ty;
    var targetX, targetY;
    var curTime = Date.now();
    var cutoffTime = curTime - sessionTimeout;

    if (showFPS) {
        curMS = curTime;
        if (lastMS === 0) {
            lastMS = curMS;
        }
        counter += curMS - lastMS;
        if (counter > 1000) {
            avgFPS = (avgFPS + frameCount) / 2;
            frameCount = 0;
            counter -= 1000;
            secondCounter++;
            if (secondCounter > 900) {
                // log it every 15 mins.
                log('Average FPS: ' + Number(avgFPS).toFixed(1));
                secondCounter = 0;
            }
        }
        lastMS = curMS;
        frameCount++;
    }

    // Kill timed out players.
    for (i = 0; i < playerList.length; i++) {
        if (playerList[i].lastTime < cutoffTime) {
            // Die!
            io.to(playerList[i].id).emit('dead',
                                         {reason: 'You were disconnected due' +
                                                  ' to session timeout. Sorry!'
                                         });

            playerList[i].active = false;
            killList.push({id: playerList[i].id,
                           remaining: 2});
        }
    }

    // Update explosions.
    for (i = 0; i < explosionList.length; i++) {
        explosionList[i].update(deltaTime);

        if (explosionList[i].remaining <= 0) {
            removeExplosion(explosionList[i]);
        }
    }

    // Remove spent explosions.
    explosionList = explosionList.filter(function(f) {
        return (f.remaining > 0);
    });

    // Update bombs.
    for (i = 0; i < bombList.length; i++) {
        if (!bombList[i].active) {
            // NOTE: bombs can only be set inactive in explodeBomb().
            //       If this changes, there could be a race where
            //       explodeBomb() is not called, and players run out of bombs.
            bombList[i].remaining = 0;
            continue;
        }

        bombList[i].update(deltaTime);

        // Handle explosion.
        if (bombList[i].remaining <= 0) {
            explodeBomb(bombList[i]);
        }
    }

    // Remove exploded bombs from list.
    bombList = bombList.filter(function(f) {
        return (f.remaining > 0);
    });

    // Clear player chunks - this is how we determine where players are
    // in the world.
    clearPlayerZones();

    // Move all players.
    for (i = 0; i < playerList.length; i++) {
        // Ignore inactive players.
        if (!playerList[i].active) {
            continue;
        }

        // Get next action for this player.
        if (playerList[i].id in inputQueue &&
            inputQueue[playerList[i].id].length > 0) {
            // sort the input queue by action ID.
            inputQueue[playerList[i].id].sort(function(a, b) {
                return a.id - b.id;
            });

            playerList[i].setAction(inputQueue[playerList[i].id].shift());
        }
        else {
           playerList[i].action.deltaTime = 0;
        }

        movePlayer(playerList[i], deltaTime);
    }

    // Move mobs.
    updateMobs(deltaTime);

    // Now share the good news!
    for (i = 0; i < playerList.length; i++) {
        // Update world.
        mx = world.toMapX(playerList[i].x);
        my = world.toMapY(playerList[i].y);

        // Add player in world. This is how we keep track of which
        // sections / zones have no players in them.
        addPlayerAt(mx, my);

        tx = mx - Math.floor(world.chunkwidth / 2);
        ty = my - Math.floor(world.chunkheight / 2);

        if (tx < 0) {
            tx = 0;
        }
        else if (tx + world.chunkwidth > world.width) {
            tx = world.width - world.chunkwidth;
        }

        if (ty < 0) {
            ty = 0;
        }
        else if (ty + world.chunkheight > world.height) {
            ty = world.height - world.chunkheight;
        }

        var localPlayerList = playerList.map(function(f) {
            if (isLocalObject(tx, ty, f)) {
                return f;
            }
        }).filter(function(f) { return f; });

        var localBombList = bombList.map(function(f) {
            if (isLocalObject(tx, ty, f)) {
                return f;
            }
        }).filter(function(f) { return f; });

        var localExplosionList = explosionList.map(function(f) {
            if (isLocalObject(tx, ty, f)) {
                return f;
            }
        }).filter(function(f) { return f; });

        var localMobList = mobList.map(function(f) {
            if (isLocalObject(tx, ty, f)) {
                return f;
            }
        }).filter(function(f) { return f; });

        io.to(playerList[i].id).emit('update players',
                                     localPlayerList,
                                     localBombList,
                                     localExplosionList,
                                     world.getChunkData(tx, ty),
                                     { totalPlayers: playerList.length },
                                     localMobList);
    }

    // Remove dead players.
    playerList = playerList.filter(function(f) {
        return f.active;
    });


    // Send delayed kill signal to clients.
    for (i = 0; i < killList.length; i++) {
        killList[i].remaining -= deltaTime;
        if (killList[i].remaining <= 0) {
            killPlayer(killList[i].id);
        }
    }

    killList = killList.filter(function(f) {
        return f.remaining > 0;
    });
}

// NOTE: movePlayer is also duplicated in the client, for client-side prediction
//       so any changes here need to replicated there. Otherwise the
//       client-side prediction will differ from the server, resulting in
//       noticeable glitches.
function movePlayer(player, deltaTime) {
    var mx, my;
    var targetX, targetY;

    if (player.action.fire) {
        createBomb(player);

        // Prevent more bombs being released until player releases fire.
        player.action.fire = false;
    }

    // Move player.
    mx = world.toMapX(player.x);
    my = world.toMapY(player.y);
    targetX = world.toScreenX(mx);
    targetY = world.toScreenY(my);
    if (world.getcell(mx, my) === 1) {
        // ERROR: we're inside a wall - reposition player to nearby blank space.
        var nb = world.findNearestBlank(mx, my);
        player.x = world.toScreenX(nb.x);
        player.y = world.toScreenY(nb.y);
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

    var reason = '';
    var died = false;

    // Did we get anything?
    mx = world.toMapX(player.x);
    my = world.toMapY(player.y);

    var item = world.getcell(mx, my);
    if (item != 0) {
        if (item === 6) {
            // player is now dead.
            died = true;
            reason = 'You touched a robot spawner';

            createSingleExplosion(player.x, player.y);
        }
        else {
            if (playerGotItem(player, item)) {
                // blank the space.
                delBlockAt(mx, my);
            }
        }
    }

    // Check if player is killed.
    if (!player.hasFlag(2)) { // Not invincible?
        // Did we touch a mob?
        var range = 16; // Definitely touching.
        for (var i = 0; i < mobList.length; i++) {
            var mobx = mobList[i].x;
            var moby = mobList[i].y;

            var distx = mobx - player.x;
            var disty = moby - player.y;
            var d = Math.sqrt(distx * distx + disty * disty);
            if (d < range) {
                // Player is dead.
                reason = 'You were killed by a robot'
                if (mobList[i].smart) {
                    reason += ' overlord';
                }

                died = true;

                // Create explosion at player location.
                createSingleExplosion(player.x, player.y);
                break;
            }
        }

        if (!died) {
            var exp = world.getExplosion(mx, my);
            if (exp != null && exp.harmful) {
                died = true;

                // Award points to the player that killed them.
                if (exp.pid != player.id) {
                    var winPlayer = findPlayerObj(exp.pid);
                    if (winPlayer) {
                        winPlayer.score += 1000;
                        reason = "You were killed by '" + winPlayer.name + "'";
                    }
                    else {
                        var pname = "'" + exp.pname + "'";
                        if (!exp.pname) {
                            pname = "an unknown player";
                        }

                        reason = "You were killed by " + pname;
                        reason += ", who has already died since placing ";
                        reason += "that bomb";
                    }
                }
                else {
                    reason = "Oops! You were killed by your own bomb";
                }
            }
        }

    }

    if (died) {
        // Die!
        log("Player ID '" + player.id + "' (name: '" + player.name +
            "', score: " + player.score + ") killed: " + reason);
        io.to(player.id).emit('dead', {reason: reason});
        player.active = false;
        killList.push({id: player.id,
                       remaining: 2});
    }
}

function isLocalObject(tx, ty, obj) {
    var ox = world.toMapX(obj.x);
    var oy = world.toMapY(obj.y);

    if (ox >= tx && ox < (tx + world.chunkwidth) &&
        oy >= ty && oy < (ty + world.chunkheight)) {
        return true;
    }
}

function updateLeaderboard () {
    // Get sorted top 10.
    var lb = playerList.concat().sort(function f(a, b) {
        return b.score - a.score;
    });

    var i;

    rankByID = {};
    for (var i = 0; i < lb.length; i++) {
        rankByID[lb[i].id] = i + 1;
    }

    lb = lb.slice(0, 10);

    // Send leaderboard to all players.
    for (i = 0; i < playerList.length; i++) {
        playerList[i].rank = rankByID[playerList[i].id];
        io.to(playerList[i].id).emit('leaderboard', lb);
    }
}

function updateWatermark() {
    usersAverage = Math.ceil((usersAverage + usersCurrentWatermark) / 2);
    usersCurrentWatermark = 0;
}

/*******************************************************************************
 *
 * RUN THE SERVER LOOP.
 *
 ******************************************************************************/

setInterval(gameLoop, 1000 / targetFPS); // Run game loop at fixed fps.
setInterval(updateLeaderboard, 1000); // Update leaderboard only once every sec.
setInterval(addBlocks, 10000); // Add blocks back to world.
setInterval(updateWatermark, 300000); // Update users watermark every 5 mins.

/*******************************************************************************
 *
 * START SERVER.
 *
 ******************************************************************************/

var serverPort = 3001; // Use 3001 for servers.
http.listen(serverPort, function() {
  console.log(`Server port: ${serverPort}`);
});
