class Explosion {
    constructor(id, bomb, ex, ey) {
        this.id = id;
        this.pid = null;
        this.pname = null;
        if (bomb) {
            this.pid = bomb.pid;
            this.pname = bomb.pname;
        }

        this.active = true;
        this.x = ex;
        this.y = ey;
        this.remaining = 0.5;
        // Allow explosions to only be harmful at the start.
        this.harmful = true;


        // Internal. We store the timestamp from when the bomb was placed, so
        // that if a later bomb overlaps, mobs don't pretend its safe when
        // this one goes off.
        this.ts = 0;
        if (bomb) {
            this.ts = bomb.ts;
        }
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
            harmful: this.harmful
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
        this.harmful = data.harmful;
    }

    update(deltaTime) {
        this.remaining -= deltaTime;
        if (this.remaining < 0.3) {
            this.harmful = false;
        }

        if (this.remaining <= 0) {
            this.remaining = 0;
        }
    }
}

export default Explosion;
