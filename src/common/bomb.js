class Bomb {
    constructor(id, player) {
        this.id = id;
        this.pid = player.id;
        this.pname = player.name;
        this.active = true;
        this.x = player.x;
        this.y = player.y;
        this.remaining = player.bombTime;
        this.range = player.range;

        // Server only

        // The timestamp helps mobs to know which ones to avoid first.
        this.ts = Date.now();
    }

    toJSON() {
        return {
            id: this.id,
            pid: this.pid,
            pname: this.pname,
            active: this.active,
            x: this.x,
            y: this.y,
            remaining: this.remaining,
            range: this.range
        };
    }

    fromJSON(data) {
        this.id = data.id;
        this.pid = data.pid;
        this.pname = data.pname;
        this.active = data.active;
        this.x = data.x;
        this.y = data.y;
        this.remaining = data.remaining;
        this.range = data.range;
    }

    update(deltaTime) {
        this.remaining -= deltaTime;
        if (this.remaining <= 0) {
            this.remaining = 0;
        }
    }
}

export default Bomb;
