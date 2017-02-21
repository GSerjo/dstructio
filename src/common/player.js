import Action from './action';
import Effect from './effect';

// FLAGS. NOTE: MUST BE POWERS OF 2!!!
const FLAG_NONE = 0;
const FLAG_WALK_THROUGH_BOMBS = 1;
const FLAG_INVINCIBLE = 2;

class Player {
    constructor() {
        this.id = '';
        this.active = true;
        this.x = 0;
        this.y = 0;
        this.action = new Action();
        this.speed = 200;  // Speed (in pixels per second).
        this.image = 'p1'; // Image label.
        this.range = 1;    // Default bomb range (in each direction).
        this.bombTime = 3; // Seconds until bomb explodes. Max: 4, Min: 1.
        this.maxBombs = 1; // Bomb limit.
        this.curBombs = 0; // Number of bombs currently deployed.
        this.flags = 0;    // Player flags.
        this.score = 0;
        this.name = '';
        this.rank = 0;

        // SERVER ONLY

        // Effects currently acting on this player.
        // NOTE: effects are server-side only and don't need to be converted
        //       to/from JSON.
        this.effects = [];
        // Last time (in milliseconds since epoch) that client contacted server.
        this.lastTime = 0;
        this.ip = '';
    }

    toJSON() {
        return {
            id: this.id,
            active: this.active,
            x: this.x,
            y: this.y,
            action: this.action.toJSON(),
            speed: this.speed,
            image: this.image,
            range: this.range,
            bombTime: this.bombTime,
            maxBombs: this.maxBombs,
            curBombs: this.curBombs,
            flags: this.flags,
            score: this.score,
            name: this.name,
            rank: this.rank
        };
    }

    fromJSON(data) {
        this.id = data.id;
        this.active = data.active;
        this.x = data.x;
        this.y = data.y;
        this.action.fromJSON(data.action);
        this.speed = data.speed;
        this.image = data.image;
        this.range = data.range;
        this.bombTime = data.bombTime;
        this.maxBombs = data.maxBombs;
        this.curBombs = data.curBombs;
        this.flags = data.flags;
        this.score = data.score;
        this.name = data.name;
        this.rank = data.rank;
    }

    setxy(x, y) {
        this.x = x;
        this.y = y;
    }

    setAction(action) {
        this.action.fromJSON(action);
    }

    update(deltaTime) {
        this.updateWithTempAction(this.action);
    }

    updateWithTempAction(tmpaction, deltaTime) {
        // Process effects.
        if (this.effects.length > 0) {
            for (var i = 0; i < this.effects.length; i++) {
                this.effects[i].update(deltaTime, this);
            }

            // Remove finished effects.
            this.effects = this.effects.filter(function(f) {
                return (f.remaining > 0);
            });
        }

        if (tmpaction) {
            var effectiveSpeed = this.speed;
            // NOTE: some effects may adjust speed outside safe limits.
            // Correct the speed here to be on the safe side.
            if (effectiveSpeed < 50) {
                effectiveSpeed = 50;
            }
            else if (effectiveSpeed > 300) {
                effectiveSpeed = 300;
            }
            this.x += tmpaction.x * tmpaction.deltaTime * effectiveSpeed;
            this.y += tmpaction.y * tmpaction.deltaTime * effectiveSpeed;
        }
    }

    canPass(cellValue) {
        if (cellValue === 0) {
            return true;
        }
        else if (cellValue >= 3 && cellValue <= 10) {
            return true;
        }
        else if (cellValue === 100 && this.hasFlag(FLAG_WALK_THROUGH_BOMBS)) {
            // Player can pass through bombs.
            return true;
        }

        return false;
    }

    addRandomEffect() {
        // Duration = minimum 3 seconds, max 10 seconds.
        // Note it is floating point.
        var duration = (Math.random() * 7) + 3;
        var etype = Math.floor(Math.random() * 2);
        var effect = new Effect(this, etype, duration);

        // Only add it if it's a valid effect.
        if (effect.effectType >= 0) {
            this.effects.push(effect);
            return effect.name;
        }

        return;
    }

    setInvincible() {
        var effect = new Effect(this, 100, 5);
        this.effects.push(effect);
    }

    addFlag(flag) {
        this.flags |= flag;
    }

    delFlag(flag) {
        this.flags &= ~flag;
    }

    hasFlag(flag) {
        if (this.flags & flag) {
            return true;
        }

        return false;
    }
}

export default Player;

