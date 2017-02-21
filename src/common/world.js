class World {
    constructor(width, height, config) {
        this.x = 0;
        this.y = 0;
        this.width = width || 0;
        this.height = height || 0;
        this.tilewidth = 32;
        this.tileheight = 32;
        if (config != null) {
            // Allow extra tiles either side because client-side prediction can
            // have the client several tiles ahead of the server.
            this.chunkwidth = Math.floor(config.screenX / this.tilewidth) + 10;
            this.chunkheight =
                Math.floor(config.screenY / this.tileheight) + 10;
        }
        else {
            this.chunkwidth = 32;
            this.chunkheight = 32;
        }

        this.data = [];

        // dataInternal is for things like items, explosions, and bombs.
        // It will contain either 0 (nothing), or an object, as follows:
        // { dataType: 'bomb' | 'explosion' | 'item',
        //   obj: the object
        // }
        this.dataInternal = [];

        // Internal data used by smart mobs to avoid bombs / explosions.
        this.mobInternal = [];

        // Zone data - used to replenish blocks.
        this.zonewidth = 16;
        this.zoneheight = 16;
        this.blocksPerZone = [];
        this.playersPerZone = [];
        this.zonesAcross = this.mapToZoneX(this.width - 1) + 1;
        this.zonesDown = this.mapToZoneY(this.height - 1) + 1;
        this.zoneQuota = [];
    }

    toJSON() {
        return {
            x: this.x,
            y: this.y,
            width: this.width,
            height: this.height,
            tilewidth: this.tilewidth,
            tileheight: this.tileheight,
            chunkwidth: this.chunkwidth,
            chunkheight: this.chunkheight,
            data: this.data
        };
    }

    fromJSON(data) {
        this.x = data.x;
        this.y = data.y;
        this.width = data.width;
        this.height = data.height;
        this.tilewidth = data.tilewidth;
        this.tileheight = data.tileheight;
        this.chunkwidth = data.chunkwidth;
        this.chunkheight = data.chunkheight;
        this.data = data.data;
    }

    toCSV() {
        var csv = '';

        var index = 0;
        for (var my = 0; my < this.height; my++) {
            csv += this.data.slice(index, index + this.width).join();
            csv += "\n";

            index += this.width;
        }

        return csv;
    }

    isValidCell(x, y) {
        if (x < 0 || x >= this.width || y < 0 || y >= this.height) {
            return false;
        }

        return true;
    }

    getIndex(x, y) {
        if (!this.isValidCell(x, y)) {
            return -1;
        }

        return (y * this.width) + x;
    }

    setcell(x, y, val) {
        if (!this.isValidCell(x, y)) {
            return;
        }

        this.data[(y * this.width) + x] = val;
    }

    getcell(x, y) {
        if (!this.isValidCell(x, y)) {
            return 1; // Default to wall.
        }

        return this.data[(y * this.width) + x];
    }

    setInternalCell(x, y, val) {
        if (!this.isValidCell(x, y)) {
            return;
        }

        this.dataInternal[(y * this.width) + x] = val;
    }

    getInternalCell(x, y) {
        if (!this.isValidCell(x, y)) {
            return 0; // Default to empty.
        }

        return this.dataInternal[(y * this.width) + x];
    }

    setDataObj(x, y, dataType, obj) {
        this.setInternalCell(x, y, { dataType: dataType,
                                     obj: obj
                                   });
    }

    setBomb(x, y, bomb) {
        this.setDataObj(x, y, 'bomb', bomb);
    }

    setItem(x, y, item) {
        this.setDataObj(x, y, 'item', item);
    }

    setExplosion(x, y, explosion) {
        this.setDataObj(x, y, 'explosion', explosion);
    }

    getDataObj(x, y, dataType) {
        var myobj = this.getInternalCell(x, y);
        if (myobj != null && typeof myobj == 'object') {
            if (myobj.dataType === dataType) {
                return myobj.obj;
            }
        }

        return null;
    }

    getExplosion(x, y) {
        return this.getDataObj(x, y, 'explosion');
    }

    getBomb(x, y) {
        return this.getDataObj(x, y, 'bomb');
    }

    getItem(x, y) {
        return this.getDataObj(x, y, 'item');
    }

    clearInternalCell(x, y) {
        this.setInternalCell(x, y, 0);
    }

    // Mobs.
    setMobCell(x, y, val) {
        if (!this.isValidCell(x, y)) {
            return;
        }

        this.mobInternal[(y * this.width) + x] = val;
    }

    getMobCell(x, y) {
        if (!this.isValidCell(x, y)) {
            return 0; // Default to empty.
        }

        return this.mobInternal[(y * this.width) + x];
    }

    clearMobCell(x, y) {
        this.setMobCell(x, y, 0);
    }

    getSpawnPoint() {
        while (true) {
            // Get random spawn point for player.
            var tx = Math.floor(Math.random() * this.width);
            var ty = Math.floor(Math.random() * this.height);
            var pos = this.findNearestBlank(tx, ty);

            var count = 0;
            if (this.getcell(pos.x - 1, pos.y) === 0) {
                count++;
            }
            if (this.getcell(pos.x + 1, pos.y) === 0) {
                count++;
            }
            if (this.getcell(pos.x, pos.y - 1) === 0) {
                count++;
            }
            if (this.getcell(pos.x, pos.y + 1) === 0) {
                count++;
            }

            if (count >= 2) {
                return pos;
            }
        }

        return
    }

    getFirstBlank(mx, my, length) {
        var start = 0;
        if (mx < 1) {
            start = 1 - mx;
            if (start >= length) {
                return -1;
            }
        }

        if (my < 1 || my >= this.height - 1) {
            return -1;
        }

        var index = this.getIndex(mx + start, my);
        for (var i = start; i < length; i++) {
            if (this.data[index++] === 0) {
                return mx + i;
            }
        }

        return -1;
    }

    findNearestBlank(mx, my) {
        if (this.getcell(mx, my) === 0) {
            return { x: mx, y: my };
        }

        var fallback = {x: 1, y: 1};

        for (var radius = 1; radius < 20; radius++) {
            var cx = mx - radius;
            var cy = my - radius;

            if (mx + radius <= 0 || my + radius <= 0) {
                return fallback;
            }
            else if (cx >= (this.width - 1) || cy >= (this.height - 1)) {
                return fallback;
            }

            var i;
            var testLength = (radius * 2) + 1;

            // Top.
            i = this.getFirstBlank(cx, cy, testLength);
            if (i >= 1) {
                return {x: i, y: cy};
            }

            i = this.getFirstBlank(cx, my + radius, testLength);
            if (i >= 1) {
                return {x: i, y: my + radius};
            }

            for (var ty = cy + 1; ty < my + radius; ty++) {
                if (cx > 0) {
                    i = this.getFirstBlank(cx, ty, 1);
                    if (i >= 1) {
                        return {x: i, y: ty};
                    }
                }

                if (mx + radius < (this.width - 1)) {
                    i = this.getFirstBlank(mx + radius, ty, 1);
                    if (i >= 1) {
                        return {x: i, y: ty};
                    }
                }
            }
        }

        return fallback;
    }

    toScreenX(mx) {
        return (mx * this.tilewidth) + (this.tilewidth / 2);
    }

    toScreenY(my) {
        return (my * this.tileheight) + (this.tileheight / 2);
    }

    toMapX(sx) {
        return Math.floor(sx / this.tilewidth);
    }

    toMapY(sy) {
        return Math.floor(sy / this.tileheight);
    }

    fixScreenX(sx) {
        return this.toScreenX(this.toMapX(sx));
    }

    fixScreenY(sy) {
        return this.toScreenY(this.toMapY(sy));
    }

    mapToChunkX(mx) {
        return Math.floor(mx / this.chunkwidth);
    }

    mapToChunkY(my) {
        return Math.floor(my / this.chunkheight);
    }

    screenToChunkX(sx) {
        return this.mapToChunkX(this.toMapX(sx));
    }

    screenToChunkY(sy) {
        return this.mapToChunkY(this.toMapY(sy));
    }

    getChunkData(tx, ty) {
        var chunkdata = [];

        var chunkheight = this.chunkheight;
        var chunkwidth = this.chunkwidth;

        var index;
        var i;
        for (var my = ty; my < ty + chunkheight; my++) {
            index = (my * this.width) + tx;

            // Apparently appending in a for loop is faster than push.apply().
            // http://stackoverflow.com/questions/1374126/how-to-extend-an-existing-javascript-array-with-another-array-without-creating/17368101#17368101
            var slice = this.data.slice(index, index + chunkwidth);
            for (i = 0; i < chunkwidth; i++) {
                chunkdata.push(slice[i]);
            }
        }

        return { tx: tx,
                 ty: ty,
                 chunkwidth: chunkwidth,
                 chunkheight: chunkheight,
                 data: chunkdata
                };
    }

    // ZONES.

    getZoneIndex(zonex, zoney) {
        return (zoney * this.zonesAcross) + zonex;
    }

    mapToZoneIndex(x, y) {
        var cx = this.mapToZoneX(x);
        var cy = this.mapToZoneY(y);
        return this.getZoneIndex(cx, cy);
    }

    mapToZoneX(mx) {
        return Math.floor(mx / this.zonewidth);
    }

    mapToZoneY(my) {
        return Math.floor(my / this.zoneheight);
    }
}

export default World;
