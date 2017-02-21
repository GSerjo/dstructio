import Action from './action';

class Mob {
    constructor() {
        this.id = 0;
        this.active = true;
        this.x = 0;
        this.y = 0;
        this.action = new Action();
        this.speed = 60;     // speed (in pixels per second).
        this.image = 'mob1'; // Image label.
        this.flags = 0;      // Mob flags.
        this.name = '';

        // Server only.

        // Use various target modes to navigate.
        // 0: pick a nearby spot and try to reach it.
        // 1: pick a nearby player and try to follow them.
        // 2: always try moves in clockwise direction, starting with current
        //    dir.
        // 3: always try moves in counter-clockwise direction, starting with
        //    current dir.
        // 4: same as 2, but start at direction after current.
        // 5: same as 3, but start at direction after current.
        this.targetMode = 0;
        this.targetRemaining = 0; // seconds until new target mode.

        // position of current target. Used by target mode 0.
        this.targetmx = 0;
        this.targetmy = 0;

        // Position when we switched direction.
        // This is needed to stop the mob going in circles on the spot for
        // target modes 4 & 5.
        this.oldmx = 0;
        this.oldmy = 0;

        this.targetPlayer; // Target player object - used by target mode 1.
        // Used by target modes 2-5. 0 = up, 1 = right, 2 = down, 3 = left.
        this.targetDir = 0;

        this.range = 8; // how far they can see in each direction.

        // Some bomb/explosion avoidance...
        this.smart = false;
        if (Math.random() > 0.7) {
            this.smart = true;
        }
        // Tell smart mob if they need to get the hell outa there.
        this.danger = false;
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
            flags: this.flags,
            name: this.name
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
        this.flags = data.flags;
        this.name = data.name;
    }

    canPass(cellValue) {
        if (cellValue === 0) {
            return true;
        }
        else if (cellValue >= 3 && cellValue <= 10) {
            return true;
        }
        // NOTE: mobs cannot pass through bombs!

        return false;
    }

    update(deltaTime) {
        this.updateWithTempAction(this.action);
    }

    updateWithTempAction(tmpaction, deltaTime) {
        if (tmpaction) {
            var effectiveSpeed = this.speed;
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
}

export default Mob;
