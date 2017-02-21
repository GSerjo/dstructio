class Effect {
    constructor(player, etype, duration) {
        this.effectType = etype;
        this.remaining = duration || 5; // Remaining seconds.
        this.name = '';

        this.createEffect(player);
    }

    toJSON() {
        return {
            effectType: this.effectType,
            remaining: this.remaining
        };
    }

    fromJSON(data) {
        this.effectType = data.effectType;
        this.remaining = data.remaining;
    }

    createEffect(player) {

        var reset = false;

        // create effect.
        switch(this.effectType) {
            case 0: // Speed up.
                player.speed += 50;
                this.name = '>>';
                break;
            case 1: // Slow down.
                player.speed -= 50;
                this.name = '<<';
                break;
            case 100: // Invincible.
                player.addFlag(2);
                break;
            default:
                // Unknown effect - just kill it immediately.
                reset = true;
        }

        if (reset) {
            // Invalid effect for this player - just kill it.
            this.remaining = 0;
            this.effectType = -1;
        }
    }

    destroyEffect(player) {
        // Undo the effect that was added in createEffect().
        switch(this.effectType) {
            case 0: // Speed up finished.
                player.speed -= 50;
                break;
            case 1: // Slow down finished.
                player.speed += 50;
                break;
            case 100: // End invincibility
                player.delFlag(2);
                break;
            default:
                // Unknown effect - just kill it immediately.
                this.remaining = 0;
                this.effectType = -1;
        }
    }

    update(deltaTime, player) {
        if (this.remaining <= 0) {
            // Already finished. Ignore it.
            return;
        }

        this.remaining -= deltaTime;

        if (this.remaining <= 0) {
            this.remaining = 0;

            this.destroyEffect(player);
        }
    }
}

export default Effect;

