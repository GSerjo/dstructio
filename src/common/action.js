class Action {
    constructor() {
        this.x = 0;
        this.y = 0;
        this.fire = false;
        this.id = 0;
        this.deltaTime = 0;
    }

    toJSON() {
        return {
            x: this.x,
            y: this.y,
            fire: this.fire,
            id: this.id,
            deltaTime: this.deltaTime
        };
    }

    fromJSON(data) {
        this.x = data.x;
        this.y = data.y;
        this.fire = data.fire;
        this.id = data.id;
        this.deltaTime = data.deltaTime;
    }

    clear() {
        this.x = 0;
        this.y = 0;
        this.fire = false;
        this.deltaTime = 0;
    }

    set(x, y, fire) {
        this.x = x;
        this.y = y;
        this.fire = fire;
    }

    equals(obj) {
        if (this.x === obj.x && this.y === obj.y && this.fire === obj.fire) {
            return true;
        }

        return false;
    }
}

export default Action;

