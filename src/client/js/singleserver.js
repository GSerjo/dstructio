/*
 Single Server module.

 This module is for running a 'server' on the client end, which allows for
 offline/single-player mode. This is not currently enabled.
 This demonstrates how to convert the client/server game into a single player
 game running entirely in the browser.

 A similar approach could also make it possible to set up a multiplayer server
 in one browser and allow other browsers to connect as clients. A future
 exercise perhaps.
*/

/*******************************************************************************
 *
 * MY IMPORTS.
 *
 ******************************************************************************/
import Player from '../../common/player';
import Mob from '../../common/mob';
import Bomb from '../../common/bomb';
import Explosion from '../../common/explosion';
import World from '../../common/world';
import GameConfig from '../../common/config';

/* IMPORTANT: We need to put everything in a class, to avoid namespace
   clashes with the client. */

class InternalServer {
    constructor() {
        this.GAME_DEBUG = false;
        this.targetFPS = 30;

        this.playerList = [];
        this.bombList = [];
        this.explosionList = [];
        this.killList = [];
        this.nextPlayerID = 1;
        this.inputQueue = {};
        this.nextBombID = 1;
        this.nextExplosionID = 1;
        this.gameConfig = new GameConfig();

        // Single map is 50x50.
        var ww = 50;
        var wh = 50;
        this.world = new World(ww, wh, this.gameConfig);
        this.createWorld();

        this.mobList = [];
        this.maxMobs = Math.floor((ww * wh) * 0.002);
        this.mobSpawners = [];
        this.nextMobID = 0;
        // Spawn mobs any time up to every 30 seconds.
        this.mobTimer = Math.random() * 30;

        this.addMobSpawners();
        this.populateBlocks();

        /***********************************************************************
         *
         * SINGLE MODE VARS
         *
         **********************************************************************/

        this.socket_cb = null;
        this.client_id = null;

        this.blockInterval = 10; // Add blocks every 10 seconds.
        this.blockTimer = this.blockInterval;
    }

    /***************************************************************************
     *
     * SIMULATE SOCKETS LOCALLY.
     *
     **************************************************************************/

    socket_emit(cmd, data) {
        switch(cmd) {
            case 'create player':
                this.createNewPlayer(data);
                break;
            case 'player input':
                this.playerInput(data);
                break;
            case 'pingme':
                // We really don't care about this.
                break;
            case 'get data':
                // Not implemented in offline mode.
                break;
            default:
                break;
        }
    }

    // func is a client-side function that does the equivalent of socket_emit()
    // above. It takes (cmd, data) and routes the string command to the
    // relevant function, passing the data object through.
    socket_set_cb(func) {
        this.socket_cb = func;
    }

    socket_emit_client(cmd, data) {
        if (this.socket_cb) {
            this.socket_cb(cmd, data);
        }
        else {
            this.log("ERROR: no client connected");
        }
    }

    disconnect() {
        // Remove from array if it exists.
        this.removePlayerByID(this.client_id);
        this.log("Socket ID '" + this.client_id + "' disconnected");
    }

    log(m) {
        console.log(m);
    }

    /***************************************************************************
     *
     * MISC PLAYER UTILS.
     *
     **************************************************************************/

    playerInput(action) {
        if (!(this.client_id in this.inputQueue)) {
            this.inputQueue[this.client_id] = [];
        }

        // Prevent cheating. In case this is set on the client.
        // Currently it is hard-coded. Perhaps it could be variable later,
        // But we'd need to cap it to prevent cheating.
        action.deltaTime = 1 / this.targetFPS;

        this.inputQueue[this.client_id].push(action);
    }

    createNewPlayer(data) {
        var player = new Player();
        player.id = this.nextPlayerID++;
        this.client_id = player.id;
        player.name = data.name;

        // Remove invalid chars - because the initial check is on the client so
        // cannot be trusted.
        player.name =
            player.name.replace(/^[^\w\s\,\.\_\:\'\!\^\*\(\)\=\-]+$/ig, '');
        player.name = player.name.substring(0, 30);

        this.log("Player joined >> { name: '" + player.name + "', id: " +
                 player.id + " }");

        player.setInvincible();

        var spawnPoint = this.world.getSpawnPoint();
        player.setxy((spawnPoint.x * this.world.tilewidth) +
                     Math.floor(this.world.tilewidth / 2),
                     (spawnPoint.y * this.world.tilewidth) +
                     Math.floor(this.world.tileheight / 2));

        var availableImages = ['p1', 'p2', 'p3', 'p4'];
        var rIndex = Math.floor(Math.random() * availableImages.length);
        player.image = availableImages[rIndex];
        this.playerList.push(player);

        if (this.GAME_DEBUG) {
            player.range = 8;
            player.maxBombs = 8;
        }

        this.socket_emit_client('spawn player', player.toJSON());
        this.socket_emit_client('create world', this.world.toJSON());
    }

    killPlayer(id) {
        this.removePlayerByID(id);
        if (id === this.client_id) {
            this.socket_emit_client('disconnect');
        }
    }

    findPlayerObj(id) {
        if (id) {
            var index = this.findPlayerID(id);
            if (index >= 0) {
                return this.playerList[index];
            }
        }

        return;
    }

    findPlayerID(id) {
        for (var i = 0; i < this.playerList.length; i++) {
            if (this.playerList[i].id === id) {
                return i;
            }
        }

        return -1;
    }

    removePlayerByID(id) {
        var index = this.findPlayerID(id);
        if (index >= 0) {
            this.playerList.splice(index, 1);
        }
    }

    createBomb(player) {
        if (player.curBombs < player.maxBombs) {
            var mx = this.world.toMapX(player.x);
            var my = this.world.toMapY(player.y);

            if (this.world.getcell(mx, my) != 0) {
                return;
            }

            var bomb = new Bomb(this.nextBombID++, player);
            bomb.x = this.world.toScreenX(mx);
            bomb.y = this.world.toScreenY(my);
            this.world.setcell(mx, my, 100); // 100 = bomb ID.
            this.world.setBomb(mx, my, bomb);

            this.world.setMobCell(mx, my, bomb.ts);
            this.updateBombPath(bomb);

            this.bombList.push(bomb);
            player.curBombs++;
        }
    }

    // Let smart mobs know there's a bomb in this vicinity.
    updateBombPath(bomb) {
        var mx = this.world.toMapX(bomb.x);
        var my = this.world.toMapY(bomb.y);

        var cx = mx;
        var cy = my;
        var i;
        var cell;
        var ts = bomb.ts;

        // UP.
        for (i = 0; i < bomb.range; i++) {
            cy -= 1;

            cell = this.world.getcell(cx, cy);
            if (cell === 1 || cell === 2 || cell === 100) {
                break;
            }

            this.world.setMobCell(cx, cy, ts);
        }
        cy = my;

        // DOWN.
        for (i = 0; i < bomb.range; i++) {
            cy += 1;

            cell = this.world.getcell(cx, cy);
            if (cell === 1 || cell === 2 || cell === 100) {
                break;
            }

            this.world.setMobCell(cx, cy, ts);
        }
        cy = my;

        // LEFT.
        for (i = 0; i < bomb.range; i++) {
            cx -= 1;

            cell = this.world.getcell(cx, cy);
            if (cell === 1 || cell === 2 || cell === 100) {
                break;
            }

            this.world.setMobCell(cx, cy, ts);
        }
        cx = mx;

        // RIGHT.
        for (i = 0; i < bomb.range; i++) {
            cx += 1;

            cell = this.world.getcell(cx, cy);
            if (cell === 1 || cell === 2 || cell === 100) {
                break;
            }

            this.world.setMobCell(cx, cy, ts);
        }
    }

    explodeBomb(bomb) {
        var mx = this.world.toMapX(bomb.x);
        var my = this.world.toMapY(bomb.y);

        if (this.world.getcell(mx, my) === 100) {
            this.world.setcell(mx, my, 0);
            this.world.clearInternalCell(mx, my);
        }
        else {
            log("ERROR: bomb exploded but no bomb in map!?");
        }

        // Create explosions.
        var cx = mx;
        var cy = my;
        this.createExplosion(bomb, cx, cy);

        // UP.
        for (var i = 0; i < bomb.range; i++) {
            cy -= 1;

            if (!this.processExplosion(bomb, cx, cy)) {
                break;
            }
        }
        cy = my;

        // DOWN.
        for (var i = 0; i < bomb.range; i++) {
            cy += 1;

            if (!this.processExplosion(bomb, cx, cy)) {
                break;
            }
        }
        cy = my;

        // LEFT.
        for (var i = 0; i < bomb.range; i++) {
            cx -= 1;

            if (!this.processExplosion(bomb, cx, cy)) {
                break;
            }
        }
        cx = mx;

        // RIGHT.
        for (var i = 0; i < bomb.range; i++) {
            cx += 1;

            if (!this.processExplosion(bomb, cx, cy)) {
                break;
            }
        }

        bomb.active = false;

        // Now remove the bomb from this player.
        var player = this.findPlayerObj(bomb.pid);
        if (player) {
            player.curBombs -= 1;
            if (player.curBombs < 0) {
                this.log("ERROR: player has -1 bombs!");
                player.curBombs = 0;
            }
        }
    }

    processExplosion(bomb, cx, cy) {
        var cell = this.world.getcell(cx, cy);

        if (cell === 1) {
            return false;
        }
        else if (cell === 100) {
            var testbomb = this.world.getBomb(cx, cy);
            if (testbomb != null) {
                testbomb.remaining = 0;
                this.explodeBomb(testbomb);

                // We're done here.
                return false;
            }
            else {
                this.log("OOPS - we thought there was a bomb here, " +
                         "but it's gone.");
                this.world.setcell(cx, cy, 0);
            }
        }

        this.createExplosion(bomb, cx, cy);

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
                this.world.setcell(cx, cy, item);
            }
            else {
                // Track how many blocks are left in this chunk.
                this.delBlockAt(cx, cy);
            }

            return false;
        }
        else if (cell >= 3 && cell <= 5) {
            // Blow up item...
            this.delBlockAt(cx, cy);
        }
        // NOTE: cannot blow up item 6 (mob spawner).

        return true;
    }

    createExplosion(bomb, mx, my) {
        var explosion = new Explosion(this.nextExplosionID++, bomb,
                                      this.world.toScreenX(mx),
                                      this.world.toScreenY(my));
        this.world.setExplosion(mx, my, explosion);
        this.explosionList.push(explosion);
    }

    // NOTE: this explosion is visual only and uses screen coords.
    // For bomb explosions - use the above one.
    createSingleExplosion(x, y) {
        var explosion = new Explosion(this.nextExplosionID++, null,
                                      x, y);
        this.explosionList.push(explosion);
    }

    removeExplosion(explosion) {
        var mx = this.world.toMapX(explosion.x);
        var my = this.world.toMapY(explosion.y);
        this.world.clearInternalCell(mx, my);

        // Also let mobs know it's "safe" here now...
        var ts = this.world.getMobCell(mx, my);
        if (!ts || ts <= explosion.ts) {
            this.world.clearMobCell(mx, my);
        }
    }

    playerGotItem(player, item) {
        // Return true if player picked up the item, otherwise false.

        if (item === 3) { // Bomb.
            player.maxBombs += 1;
            this.sendPowerup(player.id, '+B');
            return true;
        }
        else if (item === 4) { // Range.
            player.range += 1;
            this.sendPowerup(player.id, '+R');
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
                        player.score -=
                            (Math.floor(Math.random() * 9) + 1) * 10;
                        powerupName = '-$';
                        break;
                    }
                case 8:
                    // Increase score by up to 100 points.
                    player.score += (Math.floor(Math.random() * 9) + 1) * 10;
                    powerupName = '+$';
                    break;
                default:
                    // Temporary effect.
                    powerupName = player.addRandomEffect();
            }

            if (powerupName) {
                this.sendPowerup(player.id, powerupName);
            }

            return true;
        }
        else if (item === 6) { // Mob spawner.
            // Player is now officially dead. handled in movePlayer() instead.
            return false;
        }

        return false;
    }

    sendPowerup(pid, text) {
        this.socket_emit_client('powerup', {text: text});
    }

    addBlocks() {
        // Add blocks to one zone that is empty of players.
        this.replenishOneZone();
    }

    /***************************************************************************
     *
     * World functions
     *
     **************************************************************************/

    createWorld() {
        var i;

        // NOTE: Width and height must be odd numbers.
        if (this.world.width % 2 === 0) {
            this.world.width += 1;
        }

        if (this.world.height % 2 === 0) {
            this.world.height += 1;
        }

        // Blank this.world.data.
        this.world.data = [];
        this.world.dataInternal = [];
        for (i = 0; i < this.world.width * this.world.height; i++) {
            this.world.data[i] = 0;
            this.world.dataInternal[i] = 0;
        }

        // Create walls.
        for (i = 0; i < this.world.width; i++) {
            this.world.setcell(i, 0, 1);
            this.world.setcell(i, this.world.height - 1, 1);
        }

        for (var my = 0; my < this.world.height; my ++) {
            this.world.setcell(0, my, 1);
            this.world.setcell(this.world.width - 1, my, 1);

            if ((my > 0) && (my < (this.world.height - 2)) && (my % 2 === 0)) {
                for (var mx = 2; mx < this.world.width; mx += 2) {
                    this.world.setcell(mx, my, 1);
                }
            }
        }

        // Create zone array.
        for (i = 0; i < this.world.zonesAcross * this.world.zonesDown; i++) {
            this.world.blocksPerZone[i] = 0;
            this.world.zoneQuota[i] = 0;
        }

        this.clearPlayerZones();
    }

    populateBlocks() {
        for (var zoney = 0; zoney < this.world.zonesDown; zoney++) {
            for (var zonex = 0; zonex < this.world.zonesAcross; zonex++) {
                // Calculate quota.
                var effectiveZoneWidth = this.getEffectiveZoneWidth(zonex);
                var effectiveZoneHeight = this.getEffectiveZoneHeight(zoney);

                var quota =
                    Math.floor((effectiveZoneWidth * effectiveZoneHeight) *
                               0.2);
                var zoneIndex = this.world.getZoneIndex(zonex, zoney);
                this.world.zoneQuota[zoneIndex] = quota;

                // Add blocks to this zone, up to the quota.
                this.replenishZone(zonex, zoney);
            }
        }
    }

    addMobSpawners() {
        this.mobSpawners = [];
        var numx = 2;
        var numy = 2;
        for (var py = 0; py < numy; py++) {
            for (var px = 0; px < numx; px++) {
                var mx = Math.floor(((this.world.width / numx) * px) +
                                    ((this.world.width / numx) / 2));
                var my = Math.floor(((this.world.height / numy) * py) +
                                    ((this.world.height / numy) / 2));

                var blank = this.world.findNearestBlank(mx, my);
                if (blank.x === 1 && blank.y === 1) {
                    // Try a random location.
                    var bx = Math.floor(Math.random() *
                                        (this.world.width - 2)) + 1;
                    var by = Math.floor(Math.random() *
                                        (this.world.height- 2)) + 1;

                    blank = this.world.findNearestBlank(bx, by);

                    if (blank.x === 1 && blank.y === 1) {
                        // Give up :(
                        continue;
                    }
                }

                // Add mob spawner.
                var spawner = { x: blank.x, y: blank.y };
                this.mobSpawners.push(spawner);
                this.world.setcell(spawner.x, spawner.y, 6);
            }
        }
    }

    replenishZone(zonex, zoney, count) {
        var effectiveZoneWidth = this.getEffectiveZoneWidth(zonex);
        var effectiveZoneHeight = this.getEffectiveZoneHeight(zoney);
        var zoneIndex = this.world.getZoneIndex(zonex, zoney);
        var quota = this.world.zoneQuota[zoneIndex];

        var zoneLeft = zonex * this.world.zonewidth;
        var zoneTop = zoney * this.world.zoneheight;

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

        while (this.world.blocksPerZone[zoneIndex] < quota) {
            var bx = Math.floor(Math.random() * effectiveZoneWidth) + zoneLeft;
            var by = Math.floor(Math.random() * effectiveZoneHeight) + zoneTop;

            var blank = this.world.findNearestBlank(bx, by);

            // Avoid top left corner - it's the safe space for spawning
            // players if no blank spaces were found.
            if (blank.x != 1 || blank.y != 1) {
                // Mystery block.
                // Make sure no mobs or players nearby.
                if (!this.isNearbyPlayers(blank.x, blank.y) &&
                    !this.isNearbyMobs(blank.x, blank.y) &&
                    !this.isNearbyMobSpawner(blank.x, blank.y)) {
                    this.addBlockAt(blank.x, blank.y);
                    blocksAdded++;
                }
            }

            if (count && blocksAdded >= count) {
                break;
            }
        }
    }

    isNearbyPlayers(mx, my) {
        return this.getNumNearbyPlayers(mx, my, true);
    }

    getNumNearbyPlayers(mx, my, stopAtOne) {
        var sx = this.world.toScreenX(mx);
        var sy = this.world.toScreenY(my);

        var num = 0;
        var xrange = 4 * this.world.tilewidth;
        var yrange = 4 * this.world.tileheight;
        for (var i = 0; i < this.playerList.length; i++) {
            var player = this.playerList[i];
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

    isNearbyMobs(mx, my) {
        return this.getNumNearbyMobs(mx, my, true);
    }

    getNumNearbyMobs(mx, my, stopAtOne) {
        var sx = this.world.toScreenX(mx);
        var sy = this.world.toScreenY(my);

        var num = 0;
        var xrange = 3 * this.world.tilewidth;
        var yrange = 3 * this.world.tileheight;
        for (var i = 0; i < this.mobList.length; i++) {
            var mob = this.mobList[i];
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

    isNearbyMobSpawner(mx, my) {
        var range = 3;
        for (var i = 0; i < this.mobSpawners.length; i++) {
            var ms = this.mobSpawners[i];
            if (ms.x > (mx - range) && ms.x < (mx + range) &&
                ms.y > (my - range) && ms.y < (my + range)) {
                return true;
            }
        }

        return false;
    }

    replenishOneZone() {
        // This is called once a minute, to add blocks to the zone with no
        // players in it, and the fewest blocks (relative to the quota for that
        // zone).
        var i;
        var emptyZones = [];
        for (i = 0; i < this.world.playersPerZone.length; i++) {
            var quota = this.world.zoneQuota[i];
            if (this.world.playersPerZone[i] === 0 &&
                this.world.blocksPerZone[i] < quota) {
                emptyZones.push({index: i,
                                 shortfall: quota -
                                    this.world.blocksPerZone[i]
                                });
            }
        }

        if (emptyZones.length > 0) {
            emptyZones.sort(function(a, b) {
                return b.shortfall - a.shortfall;
            });

            var zoneIndex = emptyZones[0].index;
            var shortfall = emptyZones[0].shortfall;

            var zoney = Math.floor(zoneIndex / this.world.zonesAcross);
            var zonex = zoneIndex % this.world.zonesAcross;
            this.replenishZone(zonex, zoney, Math.floor(shortfall / 3) + 1);
        }
    }

    getEffectiveZoneWidth(zonex) {
        var zoneLeft = zonex * this.world.zonewidth;
        if (this.world.width - zoneLeft <= this.world.zonewidth) {
            // NOTE: right side is excluded.
            return (this.world.width - zoneLeft) - 1;
        }

        return this.world.zonewidth;
    }

    getEffectiveZoneHeight(zoney) {
        var zoneTop = zoney * this.world.zoneheight;
        if (this.world.height - zoneTop <= this.world.zoneheight) {
            // NOTE: bottom is excluded.
            return (this.world.height - zoneTop) - 1;
        }

        return this.world.zoneheight;
    }

    addBlockAt(x, y) {
        this.world.setcell(x, y, 2);
        var zoneIndex = this.world.mapToZoneIndex(x, y);
        this.world.blocksPerZone[zoneIndex]++;
    }

    delBlockAt(x, y) {
        this.world.setcell(x, y, 0);
        var zoneIndex = this.world.mapToZoneIndex(x, y);
        this.world.blocksPerZone[zoneIndex]--;
        if (this.world.blocksPerZone[zoneIndex] < 0) {
            this.world.blocksPerZone[zoneIndex] = 0;
        }
    }

    clearPlayerZones() {
        var i;
        this.world.playersPerZone = [];
        for (i = 0; i < this.world.zonesAcross * this.world.zonesDown; i++) {
            this.world.playersPerZone[i] = 0;
        }
    }

    addPlayerAt(mx, my) {
        this.world.playersPerZone[this.world.mapToZoneIndex(mx, my)]++;
    }

    /***************************************************************************
     *
     * MOBS (MONSTERS)
     *
     **************************************************************************/

    spawnMob() {
        var shuffledSpawners = this.shuffleCopy(this.mobSpawners);
        var i;

        for (i = 0; i < shuffledSpawners.length; i++) {
            var spawner = shuffledSpawners[i];
            if (!this.isNearbyMob(spawner.x, spawner.y, 3)) {
                // Yay, spawn new mob here.
                var sx = this.world.toScreenX(spawner.x);
                var sy = this.world.toScreenY(spawner.y);

                var mob = new Mob();
                mob.id = this.nextMobID++;
                mob.x = sx;
                mob.y = sy;
                this.chooseNewTarget(mob);
                this.mobList.push(mob);
                break;
            }
        }
    }

    // This will return a shuffled copy, not shuffle in place.
    shuffleCopy(array) {
        var i, j, temp;

        var arrayCopy = array.concat();
        for (i = arrayCopy.length - 1; i > 0; i --) {
            j = Math.floor(Math.random() * (i + 1))
            temp = arrayCopy[i]
            arrayCopy[i] = arrayCopy[j]
            arrayCopy[j] = temp
        }

        return arrayCopy;
    }

    isNearbyMob(mx, my, range) {
        for (var i = 0; i < this.mobList.length; i++) {
            var mobmx = this.world.toMapX(this.mobList[i].x);
            var mobmy = this.world.toMapY(this.mobList[i].y);

            if (mobmx > (mx - range) && mobmx < (mx + range) &&
                mobmy > (my - range) && mobmy < (my + range)) {
                return true;
            }
        }

        return false;
    }

    updateMobs(deltaTime) {
        for (var i = 0; i < this.mobList.length; i++) {
            this.getActionForMob(this.mobList[i], deltaTime);
            this.moveMob(this.mobList[i], deltaTime);
        }

        // Clean up up dead mobs.
        this.mobList = this.mobList.filter(function(f) {
            return f.active;
        });

        // Spawn new mob?
        this.mobTimer -= deltaTime;
        if (this.mobTimer <= 0) {
            this.mobTimer = Math.random() * 30;

            if (this.mobList.length < this.maxMobs) {
                this.spawnMob();
            }
        }
    }

    addPossibleMoves(element, openList, closedList, mob) {
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

            if (this.mobCanPass(mob, cx, cy)) {
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
    pathFind(mx, my, targetmx, targetmy, maxdist, mob) {

        if (mx === targetmx && my === targetmy) {
            return;
        }

        var openList = [];
        var closedList = [{mx: mx, my: my}];
        var best = {x: 0, y: 0};

        var initial = {mx: mx, my: my, travelled: 0, first: true};
        this.addPossibleMoves(initial, openList, closedList, mob);

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
                    if (this.addPossibleMoves(element, openList, closedList,
                                              mob)) {
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

    pathFindNearestSafeSpace(mx, my, maxdist, mob) {
        var ts = this.world.getMobCell(mx, my);
        if (!ts) {
            return {x: mx, y: my};
        }

        var openList = [];
        var closedList = [{mx: mx, my: my}];
        var safestTS = ts;
        var best = {x: mx, y: my};

        var initial = {mx: mx, my: my, travelled: 0, first: true};
        this.addPossibleMoves(initial, openList, closedList, mob);

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

                ts = this.world.getMobCell(element.mx, element.my);
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
                    if (this.addPossibleMoves(element, openList, closedList,
                                              mob)) {
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

    chooseNewTarget(mob) {
        var mx = this.world.toMapX(mob.x);
        var my = this.world.toMapY(mob.y);

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
                var blank = this.world.findNearestBlank(rx, ry);
                if (blank.x != 1 || blank.y != 1) {
                    mob.targetmx = blank.x;
                    mob.targetmy = blank.y;
                    break;
                }
            case 1:
                // Find nearby player.
                // Chase for up to 60 seconds.
                mob.targetRemaining = (Math.random() * 50) + 10;
                var xrange = this.world.tilewidth * mob.range;
                var yrange = this.world.tileheight * mob.range;

                for (var i = 0; i < this.playerList.length; i++) {
                    var player = this.playerList[i];
                    if (player.x > (mob.x - xrange) &&
                        player.x < (mob.x + xrange) &&
                        player.y > (mob.y - yrange) &&
                        player.y < (mob.y + yrange)) {
                        // Chase this player.
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

                var safest = this.pathFindNearestSafeSpace(mx, my, 3, mob);
                if (safest) {
                    mob.targetmx = safest.x;
                    mob.targetmy = safest.y;
                }
            default:
                break;
        }
    }

    getActionForDir(dir) {
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

    getActionForMob(mob, deltaTime) {
        // 0: pick a nearby spot and try to reach it.
        // 1: pick a nearby player and try to follow them.
        // 2: always try moves in clockwise direction, starting with current
        //    dir.
        // 3: always try moves in counter-clockwise direction, starting with
        //    current dir.

        var mx = this.world.toMapX(mob.x);
        var my = this.world.toMapY(mob.y);
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
                    var best = this.pathFind(mx, my, mob.targetmx, mob.targetmy,
                                             mob.range * 2, mob);
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
                    var px = this.world.toMapX(player.x);
                    var py = this.world.toMapY(player.y);

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

                        var best = this.pathFind(mx, my, px, py, mob.range * 2,
                                                 mob);
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
                var ts = this.world.getMobCell(mob.targetmx, mob.targetmy)
                if (ts) {
                    // Still not safe - get a new target.
                    var safest = this.pathFindNearestSafeSpace(mx, my, 3, mob);
                    if (safest) {
                        mob.targetmx = safest.x;
                        mob.targetmy = safest.y;
                    }
                }

                // Go there.
                var best = this.pathFind(mx, my, mob.targetmx, mob.targetmy,
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
                var da = this.getActionForDir(mob.targetDir + dirAction);
                if (this.mobCanPass(mob, mx + da.x, my + da.y)) {
                    mob.targetDir += dirAction;
                    done = true;
                    mob.oldmx = mx;
                    mob.oldmy = my;
                }
            }

            if (!done) {
                var halfth = Math.floor(this.world.tileheight / 2) - 1;
                var halftw = Math.floor(this.world.tilewidth / 2) - 1;

                var cx = mx;
                var cy = my;
                switch(mob.targetDir) {
                    case 0:
                        cy = this.world.toMapY(mob.y + halfth) - 1;
                        break;
                    case 1:
                        cx = this.world.toMapX(mob.x - halftw) + 1;
                        break;
                    case 2:
                        cy = this.world.toMapY(mob.y - halfth) + 1;
                        break;
                    case 3:
                        cx = this.world.toMapX(mob.x + halftw) - 1;
                        break;
                    default:
                        break;
                }

                if (this.mobCanPass(mob, cx, cy)) {
                    var da = this.getActionForDir(mob.targetDir);
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
            this.chooseNewTarget(mob);
        }
    }

    mobCanPass(mob, mx, my) {
        var canPass = mob.canPass(this.world.getcell(mx, my));

        if (!mob.smart) {
            return canPass;
        }

        if (canPass && !mob.danger) {
            if (this.world.getMobCell(mx, my)) {
                // Dangerous - don't go there.
                return false;
            }
        }

        return canPass;
    }

    dangerModeEnable(mob) {
        mob.danger = true;
        if (mob.targetMode != 6) {
            this.chooseNewTarget(mob);
        }
    }

    dangerModeDisable(mob) {
        mob.danger = false;
        if (mob.targetMode === 6) {
            this.chooseNewTarget(mob);
        }
    }

    moveMob(mob, deltaTime) {
        var mx, my;
        var targetX, targetY;

        if (!mob.active) {
            return;
        }

        // Move mob.
        mx = this.world.toMapX(mob.x);
        my = this.world.toMapY(mob.y);
        targetX = this.world.toScreenX(mx);
        targetY = this.world.toScreenY(my);
        if (this.world.getcell(mx, my) === 1) {
            // ERROR: we're inside a wall - reposition mob to nearby blank
            //        space.
            var nb = this.world.findNearestBlank(mx, my);
            mob.x = this.world.toScreenX(nb.x);
            mob.y = this.world.toScreenY(nb.y);
        }

        // If we're in danger, do something about it!
        if (mob.smart && this.world.getMobCell(mx, my)) {
            this.dangerModeEnable(mob);
        }
        else {
            this.dangerModeDisable(mob);
        }

        // Prevent illegal moves.
        var tmpaction = {
            x: mob.action.x,
            y: mob.action.y,
            deltaTime: 1 / this.targetFPS
        };

        if (tmpaction.x != 0 &&
            !this.mobCanPass(mob, mx + tmpaction.x, my)) {
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
            !this.mobCanPass(mob, mx, my + tmpaction.y)) {
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
        var tolerance = mob.speed / this.targetFPS;
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
        var exp = this.world.getExplosion(mx, my);
        if (exp != null && exp.harmful) {
            var reason = '';

            // Award points to the player that killed them.
            var winPlayer = this.findPlayerObj(exp.pid);
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

    /***************************************************************************
     *
     * MAIN GAME LOOP.
     *
     **************************************************************************/

    gameLoop() {
        var deltaTime = 1 / this.targetFPS;
        var i;
        var mx, my, tx, ty;
        var targetX, targetY;

        // Update explosions.
        for (i = 0; i < this.explosionList.length; i++) {
            this.explosionList[i].update(deltaTime);

            if (this.explosionList[i].remaining <= 0) {
                this.removeExplosion(this.explosionList[i]);
            }
        }

        // Remove spent explosions.
        this.explosionList = this.explosionList.filter(function(f) {
            return (f.remaining > 0);
        });

        // Update bombs.
        for (i = 0; i < this.bombList.length; i++) {
            if (!this.bombList[i].active) {
                // NOTE: bombs can only be set inactive in explodeBomb().
                //       If this changes, there could be a race where
                //       explodeBomb() is not called, and players run out of
                //       bombs.
                this.bombList[i].remaining = 0;
                continue;
            }

            this.bombList[i].update(deltaTime);

            // Handle explosion.
            if (this.bombList[i].remaining <= 0) {
                this.explodeBomb(this.bombList[i]);
            }
        }

        // Remove exploded bombs from list.
        this.bombList = this.bombList.filter(function(f) {
            return (f.remaining > 0);
        });

        // Clear player chunks - this is how we determine where players are
        // in the world.
        this.clearPlayerZones();

        // Move all players.
        for (i = 0; i < this.playerList.length; i++) {
            // Ignore inactive players.
            if (!this.playerList[i].active) {
                continue;
            }

            // Get next action for this player.
            if (this.playerList[i].id in this.inputQueue &&
                this.inputQueue[this.playerList[i].id].length > 0) {
                // Sort the input queue by action ID.
                this.inputQueue[this.playerList[i].id].sort(function(a, b) {
                    return a.id - b.id;
                });

                this.playerList[i].setAction(
                    this.inputQueue[this.playerList[i].id].shift());
            }
            else {
               this.playerList[i].action.deltaTime = 0;
            }

            this.movePlayer(this.playerList[i], deltaTime);
        }

        // Move mobs.
        this.updateMobs(deltaTime);

        // Now share the good news!
        for (i = 0; i < this.playerList.length; i++) {
            // Update this.world.
            mx = this.world.toMapX(this.playerList[i].x);
            my = this.world.toMapY(this.playerList[i].y);

            // Add player in this.world. This is how we keep track of which
            // sections / zones have no players in them.
            this.addPlayerAt(mx, my);

            tx = mx - Math.floor(this.world.chunkwidth / 2);
            ty = my - Math.floor(this.world.chunkheight / 2);

            if (tx < 0) {
                tx = 0;
            }
            else if (tx + this.world.chunkwidth > this.world.width) {
                tx = this.world.width - this.world.chunkwidth;
            }

            if (ty < 0) {
                ty = 0;
            }
            else if (ty + this.world.chunkheight > this.world.height) {
                ty = this.world.height - this.world.chunkheight;
            }

            var cls = this;

            var localPlayerList = this.playerList.map(function(f) {
                if (cls.isLocalObject(tx, ty, f)) {
                    return f.toJSON();
                }
            }).filter(function(f) { return f; });

            var localBombList = this.bombList.map(function(f) {
                if (cls.isLocalObject(tx, ty, f)) {
                    return f.toJSON();
                }
            }).filter(function(f) { return f; });

            var localExplosionList = this.explosionList.map(function(f) {
                if (cls.isLocalObject(tx, ty, f)) {
                    return f.toJSON();
                }
            }).filter(function(f) { return f; });

            var localMobList = this.mobList.map(function(f) {
                if (cls.isLocalObject(tx, ty, f)) {
                    return f.toJSON();
                }
            }).filter(function(f) { return f; });

            this.socket_emit_client('update players',
                                    {players: localPlayerList,
                                     bombs: localBombList,
                                     explosions: localExplosionList,
                                     worlddata: this.world.getChunkData(tx, ty),
                                     stats: {
                                        totalPlayers: this.playerList.length
                                     },
                                     mobs: localMobList
                                    });
        }

        // Remove dead players.
        this.playerList = this.playerList.filter(function(f) {
            return f.active;
        });

        // Send delayed kill signal to clients.
        for (i = 0; i < this.killList.length; i++) {
            this.killList[i].remaining -= deltaTime;
            if (this.killList[i].remaining <= 0) {
                this.killPlayer(this.killList[i].id);
            }
        }

        this.killList = this.killList.filter(function(f) {
            return f.remaining > 0;
        });

        // Add blocks.
        this.blockTimer -= deltaTime;
        if (this.blockTimer <= 0) {
            this.blockTimer = this.blockInterval;
            this.addBlocks();
        }
    }

    movePlayer(player, deltaTime) {
        var mx, my;
        var targetX, targetY;

        if (player.action.fire) {
            this.createBomb(player);

            // Prevent more bombs being released until player releases fire.
            player.action.fire = false;
        }

        // Move player.
        mx = this.world.toMapX(player.x);
        my = this.world.toMapY(player.y);
        targetX = this.world.toScreenX(mx);
        targetY = this.world.toScreenY(my);
        if (this.world.getcell(mx, my) === 1) {
            // ERROR: we're inside a wall - reposition player to nearby blank
            //        space.
            var nb = this.world.findNearestBlank(mx, my);
            player.x = this.world.toScreenX(nb.x);
            player.y = this.world.toScreenY(nb.y);
        }

        // Prevent illegal moves.
        var tmpaction = {
            x: player.action.x,
            y: player.action.y,
            deltaTime: player.action.deltaTime
        };

        if (tmpaction.x != 0 &&
            !player.canPass(this.world.getcell(mx + tmpaction.x, my))) {
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
            !player.canPass(this.world.getcell(mx, my + tmpaction.y))) {
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
        var tolerance = player.speed / this.targetFPS;
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
        mx = this.world.toMapX(player.x);
        my = this.world.toMapY(player.y);

        var item = this.world.getcell(mx, my);
        if (item != 0) {
            if (item === 6) {
                // Player is now dead.
                died = true;
                reason = 'You touched a robot spawner';

                this.createSingleExplosion(player.x, player.y);
            }
            else {
                if (this.playerGotItem(player, item)) {
                    // Blank the space.
                    this.delBlockAt(mx, my);
                }
            }
        }

        // Check if player is killed.
        if (!player.hasFlag(2)) { // Not invincible?
            // Did we touch a mob?
            var range = 16; // Definitely touching.
            for (var i = 0; i < this.mobList.length; i++) {
                var mobx = this.mobList[i].x;
                var moby = this.mobList[i].y;

                var distx = mobx - player.x;
                var disty = moby - player.y;
                var d = Math.sqrt(distx * distx + disty * disty);
                if (d < range) {
                    // Player is dead.
                    reason = 'You were killed by a robot'
                    if (this.mobList[i].smart) {
                        reason += ' overlord';
                    }

                    died = true;

                    // Create explosion at player location.
                    this.createSingleExplosion(player.x, player.y);
                    break;
                }
            }

            if (!died) {
                var exp = this.world.getExplosion(mx, my);
                if (exp != null && exp.harmful) {
                    died = true;

                    // Award points to the player that killed them.
                    if (exp.pid != player.id) {
                        var winPlayer = this.findPlayerObj(exp.pid);
                        if (winPlayer) {
                            winPlayer.score += 1000;

                            reason = "You were killed by '";
                            reason += winPlayer.name + "'";
                        }
                        else {
                            var pname = "'" + exp.pname + "'";
                            if (!exp.pname) {
                                pname = "an unknown player";
                            }

                            reason = "You were killed by " + pname;
                            reason += ", who has already died since ";
                            reason += "placing that bomb";
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
            this.log("Player ID '" + player.id + "' (name: " + player.name +
                     ") killed: " + reason);
            this.socket_emit_client('dead', {reason: reason});
            player.active = false;
            this.killList.push({id: player.id,
                                remaining: 2});
        }
    }

    isLocalObject(tx, ty, obj) {
        var ox = this.world.toMapX(obj.x);
        var oy = this.world.toMapY(obj.y);

        if (ox >= tx && ox < (tx + this.world.chunkwidth) &&
            oy >= ty && oy < (ty + this.world.chunkheight)) {
            return true;
        }
    }
}

export default InternalServer;
