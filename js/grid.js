// A linear congruential generator for deterministic pseudo-random numbers
class PRNG {
    constructor(seed) {
        this.seed = seed % 2147483647;
        if (this.seed <= 0) this.seed += 2147483646;
    }
    next() {
        return this.seed = this.seed * 16807 % 2147483647;
    }
    nextFloat() {
        return (this.next() - 1) / 2147483646;
    }
}

class InfiniteGrid {
    constructor(seed = Math.random() * 1000000 | 0, difficulty = 0.15) {
        this.seed = seed;
        this.difficulty = difficulty; // probability of a mine

        // key is "x,y", value is state object { isMine, isRevealed, isFlagged, adjacentMines }
        this.cells = new Map();

        this.exploredCount = 0;
        this.flaggedCount = 0;
        this.lives = 3;
        this.gameOver = false;

        // Ensure the first click and its neighbors are safe
        this.safeZoneMinX = 0;
        this.safeZoneMaxX = 0;
        this.safeZoneMinY = 0;
        this.safeZoneMaxY = 0;
        this.hasFirstClick = false;
    }

    getKey(x, y) {
        return `${x},${y}`;
    }

    // Generates or retrieves a cell
    getCell(x, y) {
        const key = this.getKey(x, y);
        if (this.cells.has(key)) {
            return this.cells.get(key);
        }

        // Determine if it's a mine using coordinates and seed
        let isMine = false;
        if (this.hasFirstClick) {
            // Check if in safe zone
            if (!(x >= this.safeZoneMinX && x <= this.safeZoneMaxX && y >= this.safeZoneMinY && y <= this.safeZoneMaxY)) {
                // Procedural generation: hash the coordinates + seed
                // Create a deterministic hash for this coordinate
                let hash = (x * 73856093 ^ y * 19349663 ^ this.seed);
                hash = (hash ^ (hash >>> 16)) * 0x85ebca6b;
                hash = (hash ^ (hash >>> 13)) * 0xc2b2ae35;
                hash = hash ^ (hash >>> 16);

                // Convert to float 0-1
                // JS bitwise operations are 32-bit signed, use >>> 0 for unsigned
                const rand = (hash >>> 0) / 4294967296;
                isMine = rand < this.difficulty;
            }
        }

        const cell = {
            isMine: isMine,
            isRevealed: false,
            isFlagged: false,
            adjacentMines: -1 // -1 means uncalculated
        };
        this.cells.set(key, cell);
        return cell;
    }

    calculateAdjacent(cx, cy) {
        let count = 0;
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                if (dx === 0 && dy === 0) continue;
                if (this.getCell(cx + dx, cy + dy).isMine) {
                    count++;
                }
            }
        }
        return count;
    }

    reveal(x, y) {
        if (this.gameOver) return false;

        if (!this.hasFirstClick) {
            this.safeZoneMinX = x - 2;
            this.safeZoneMaxX = x + 2;
            this.safeZoneMinY = y - 2;
            this.safeZoneMaxY = y + 2;
            this.hasFirstClick = true;
        }

        const cell = this.getCell(x, y);
        if (cell.isRevealed || cell.isFlagged) return true;

        if (cell.isMine) {
            cell.isRevealed = true;
            this.lives--;
            if (this.lives <= 0) {
                this.gameOver = true;
            }
            return false; // Hit a mine
        }

        // Iterative flood fill to prevent stack overflow
        const stack = [[x, y]];

        while (stack.length > 0) {
            const [cx, cy] = stack.pop();
            const currCell = this.getCell(cx, cy);

            if (currCell.isRevealed || currCell.isFlagged || currCell.isMine) continue;

            currCell.isRevealed = true;
            this.exploredCount++;

            if (currCell.adjacentMines === -1) {
                currCell.adjacentMines = this.calculateAdjacent(cx, cy);
            }

            if (currCell.adjacentMines === 0) {
                for (let dx = -1; dx <= 1; dx++) {
                    for (let dy = -1; dy <= 1; dy++) {
                        if (dx !== 0 || dy !== 0) {
                            stack.push([cx + dx, cy + dy]);
                        }
                    }
                }
            }
        }
        return true;
    }

    toggleFlag(x, y) {
        if (this.gameOver) return;
        const cell = this.getCell(x, y);
        if (cell.isRevealed) return;

        cell.isFlagged = !cell.isFlagged;
        if (cell.isFlagged) {
            this.flaggedCount++;
        } else {
            this.flaggedCount--;
        }
    }

    // Helper to reveal neighbors if chords are met (chord feature)
    chord(x, y) {
        if (this.gameOver) return false;
        const cell = this.getCell(x, y);
        if (!cell.isRevealed || cell.adjacentMines <= 0) return true;

        let flagCount = 0;
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                if (dx === 0 && dy === 0) continue;
                if (this.getCell(x + dx, y + dy).isFlagged) flagCount++;
            }
        }

        let survived = true;
        if (flagCount === cell.adjacentMines) {
            for (let dx = -1; dx <= 1; dx++) {
                for (let dy = -1; dy <= 1; dy++) {
                    if (dx === 0 && dy === 0) continue;
                    let nx = x + dx;
                    let ny = y + dy;
                    let nCell = this.getCell(nx, ny);
                    if (!nCell.isRevealed && !nCell.isFlagged) {
                        if (!this.reveal(nx, ny)) {
                            survived = false;
                        }
                    }
                }
            }
        }
        return survived;
    }

    serialize() {
        const revealed = [];
        const flagged = [];

        for (const [key, cell] of this.cells.entries()) {
            if (cell.isRevealed) {
                revealed.push(key);
            } else if (cell.isFlagged) {
                flagged.push(key);
            }
        }

        return {
            seed: this.seed,
            difficulty: this.difficulty,
            exploredCount: this.exploredCount,
            flaggedCount: this.flaggedCount,
            lives: this.lives,
            gameOver: this.gameOver,
            safeZoneMinX: this.safeZoneMinX,
            safeZoneMaxX: this.safeZoneMaxX,
            safeZoneMinY: this.safeZoneMinY,
            safeZoneMaxY: this.safeZoneMaxY,
            hasFirstClick: this.hasFirstClick,
            revealed: revealed,
            flagged: flagged
        };
    }

    deserialize(data) {
        this.seed = data.seed;
        this.difficulty = data.difficulty;
        this.exploredCount = data.exploredCount;
        this.flaggedCount = data.flaggedCount;
        this.lives = data.lives;
        this.gameOver = data.gameOver;
        this.safeZoneMinX = data.safeZoneMinX;
        this.safeZoneMaxX = data.safeZoneMaxX;
        this.safeZoneMinY = data.safeZoneMinY;
        this.safeZoneMaxY = data.safeZoneMaxY;
        this.hasFirstClick = data.hasFirstClick;

        this.cells.clear();

        for (const key of data.revealed) {
            const [x, y] = key.split(',').map(Number);
            const cell = this.getCell(x, y);
            cell.isRevealed = true;
            if (cell.adjacentMines === -1) {
                cell.adjacentMines = this.calculateAdjacent(x, y);
            }
        }

        for (const key of data.flagged) {
            const [x, y] = key.split(',').map(Number);
            const cell = this.getCell(x, y);
            cell.isFlagged = true;
        }
    }
}